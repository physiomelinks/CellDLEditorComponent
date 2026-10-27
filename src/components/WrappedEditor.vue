<template lang="pug">
    .celldl-editor.flex.flex-col.h-full(:class="[arrowClass, { 'no-status-bar': props.chrome?.statusBar === false }]")
        ElementPalette(
            v-if="paletteLayout === 'top'"
            layout="top"
        )
        main.editor-pane.relative.flex.grow(:class="{ 'with-top-palette': paletteLayout === 'top' }")
            ElementPalette(
                v-if="paletteLayout === 'left'"
                layout="left"
            )
            EditorToolbar.editor-bar(
                v-if="shownToolButtons.length || shownActions.length"
                :buttons="shownToolButtons"
                :actions="shownActions"
                type="popover"
                @button-event="buttonEvent"
            )
            //- The canvas's own controls follow the diagram's container, so they aren't styled as its SVG
            .canvas-area(ref="canvasArea")
                div#svg-container(ref="svgContainer")
                    EditorContextMenu(
                        :contextMenuProps="contextMenuProps"
                    )
                    .armed-tool-chip(
                        v-if="armedTool"
                        role="status"
                    ) {{ armedTool }} · Esc to stop
                    <!-- context-menu(id="context-menu")  -->
                CanvasControls(
                    v-if="props.chrome?.zoom !== false"
                    :style="{ right: `${8 + panelInset}px` }"
                    :vertical="zoomVertical"
                    :scale="zoomScale"
                    @zoom-in="celldlEditor.zoomIn()"
                    @zoom-out="celldlEditor.zoomOut()"
                    @zoom-fit="celldlEditor.zoomToFit()"
                )
                ArrangeBar(
                    v-if="props.chrome?.arrange !== false && arrangeableCount >= 2"
                    :style="{ right: `${8 + panelInset}px`, maxWidth: `calc(100% - ${16 + panelInset}px)` }"
                    :count="arrangeableCount"
                    @arrange="(op) => celldlEditor.arrangeSelection(op)"
                )
            EditorToolbar.editor-bar(
                v-if="shownPanelButtons.length"
                :buttons="shownPanelButtons"
                type="panel"
                @button-event="buttonEvent"
            )
        AddElementPopover(
            v-if="addElementAt"
            :at="addElementAt.client"
            @pick="addElementPicked"
            @close="addElementAt = null"
        )
        footer.status-bar(v-show="props.chrome?.statusBar !== false")
            span#status-msg
            span#status-pos(v-show="props.chrome?.statusPosition !== false")
        //- Last, so that a host's `.celldl-editor svg` still finds the diagram first
        svg.celldl-display-arrows(aria-hidden="true" width="0" height="0" v-html="displayArrows")
</template>

<script setup lang="ts">
/** biome-ignore-all lint/correctness/noUnusedVariables: Vue components and properties arte in fact used */

import * as vue from 'vue'

import primeVueAuraTheme from '@primeuix/themes/aura'
import primeVueConfig from 'primevue/config'

import vueTippy from 'vue-tippy'
import 'tippy.js/dist/tippy.css'

//==============================================================================

import '#root/assets/style.css'
import '#root/assets/icons.css'

import * as vueCommon from '#root/utils/vueCommon'

import { CellDLDiagram } from '#editor/diagram'
import { CellDLEditor } from '#editor/editor'
import {
    CANVAS_EMPTY_CLICK_EVENT,
    DEFAULT_EDITOR_TOOL_ID,
    EDITOR_TOOL_IDS,
    SELECTION_CHANGED_EVENT,
    VIEW_CHANGED_EVENT
} from '#editor/editor'
import type { EditorMessage } from '#editor/editor'
import { editGuides } from '#editor/editor/editguides'
import { compartmentsKey, setCompartmentLocations } from '#editor/editor/locations'
import { HOVER_TOOLTIP_DELAY } from '#editor/editor/tooltips'
import { undoRedo, undoRedoState } from '#editor/diagram/undoredo'
import { isMacOs } from '#root/utils/common'
import { type ArrowStyle, arrowStyleClass, arrowStyleOrDefault, displayArrowDefinitions } from '#root/utils/arrows'

import {
    type Annotations,
    type EditorToolAction,
    type EditorToolButton,
    PANEL_ID,
    type SvgViewerOptions,
    type ViewerEvent
} from '#root/utils/editor-types'

import { componentLibraryPlugin } from '#root/plugins'

import {
    type DiagramElement,
    type ElementEdit,
    type ElementError,
    diagramUnitSystem,
    listElements,
    setElements,
    setUnitSystem
} from '#root/plugins/bondgraph/elements'

import { BondgraphPlugin, PLUGIN_ID as BONDGRAPH_PLUGIN_ID } from '#root/plugins/bondgraph'
import { isUnitSystemId, NEW_DIAGRAM_UNIT_SYSTEM, type UnitSystemId } from '#root/plugins/bondgraph/unitsystem'
import { VALUES_CHROME_KEY, type ValuesChrome, type ValuesMode } from '#root/plugins/bondgraph/values'
import BondgraphPopover from '#root/plugins/bondgraph/bondgraph.vue'
import type { PaletteDomain } from '#root/plugins/bondgraph/palette'

import { DrawingPlugin } from '#root/plugins/drawing'
import DrawingPopover from '#root/plugins/drawing/drawing.vue'

// WIP import { ElectricalPlugin } from '#root/plugins/electrical'
import type { PopoverEventData, ViewInfo, ViewState } from '#root/utils/editor-types'

//import { TestCellDLEditor, testEditor } from '../../tests/editor'

import PropertiesPanel from './panels/PropertiesPanel.vue'
import ReactionsPanel from './panels/ReactionsPanel.vue'
import VariablesPanel from './panels/VariablesPanel.vue'
import AnnotationsPanel from './panels/AnnotationsPanel.vue'
import StylingPanel from './panels/StylingPanel.vue'

import AddElementPopover from './palette/AddElementPopover.vue'
import ElementPalette from './palette/ElementPalette.vue'
import { paletteDomain } from './palette/paletteState'

import ArrangeBar from './controls/ArrangeBar.vue'
import CanvasControls from './controls/CanvasControls.vue'
import EditorToolbar from './toolbar/EditorToolbar.vue'
import { closeSelectionPanels } from './toolbar/selectionPanels'
import { isShownPanel, type PanelName } from './toolbar/shownPanels'
import EditorContextMenu from './widgets/EditorContextMenu.vue'
import type { ContextMenuProps } from './widgets/EditorContextMenu.vue'

//==============================================================================

export type Theme = 'light' | 'dark' | 'system';

//==============================================================================

export type EditorEditCommand = {
    command: 'edit'
    options: {
        action: string
    }
}

export type EditorExportCommand = {
    command: 'export'
    options: {
        action: string
    }
}

export type EditorFileCommand = {
    command: 'file'
    options: {
        action: string
        data?: string
        kind?: string   // export,
        name?: string
        type?: string   // For export: `cellml`, `omex`
    }
}

export type EditorSetStateCommand = {
    command: 'set-state'
    options: {
        action: string
    }
}

export type EditorViewCommand = {
    command: 'view'
    options: ViewState
}

/**
 * List, set or select the diagram's bond graph elements, as the Properties panel
 * shows them. `kind` is returned in the reply, to match it with the request.
 *
 * * `list` replies with `elements`.
 * * `set` makes its edits as one undoable step, as the Properties panel would,
 *   and replies with `element-result`. An edit that can't be made is skipped and
 *   reported in `errors`.
 * * `select` selects just the element (or, with `id: null`, nothing), with the
 *   usual `select` and `unselect` events, panning to it if asked (never zooming).
 */
export type EditorElementCommand = {
    command: 'element'
    options: {
        action: 'list'
        kind?: string
    } | {
        action: 'set'
        kind?: string
        edits: ElementEdit[]
    } | {
        action: 'select'
        kind?: string
        id: string | null
        /** Pan the element to the centre of the view: always, or only if it isn't wholly in view */
        centre?: boolean | 'if-hidden'
    }
}

/**
 * Read or set the diagram's unit system: `'si'` (mol, L, J, C) or `'cellular'`
 * (fmol, pL, fJ, fC). Both reply with `editor-data`, its `data` the diagram's
 * unit system after the command (`''` when the editor doesn't know it), and
 * `error` when it couldn't be set. `kind` (default `'unit-system'`) is returned
 * in the reply.
 *
 * * `unit-system` reads it. A diagram without one is SI.
 * * `set-unit-system` sets it as one undoable step, reported as an edit. New
 *   values are then stored in its units; with `convert`, stored values are
 *   converted into them as the same quantities, else they keep their units.
 */
export type EditorDocumentCommand = {
    command: 'document'
    options: {
        action: 'unit-system'
        kind?: string
    } | {
        action: 'set-unit-system'
        kind?: string
        id: UnitSystemId
        convert?: boolean
    }
}

export type CellDLEditorCommand = EditorDocumentCommand
                                | EditorEditCommand
                                | EditorElementCommand
                                | EditorExportCommand
                                | EditorFileCommand
                                | EditorSetStateCommand
                                | EditorViewCommand

//==============================================================================

/**
 * Which of the editor's own controls to show when embedded. All are shown
 * when a field is absent.
 */
export type EditorChrome = {
    /** The left toolbar's tools: `false` hides the toolbar, a list shows just those tools */
    tools?: boolean | EditorToolName[]
    /** The cursor's grid position at the right of the status bar */
    statusPosition?: boolean
    /**
     * The status bar below the canvas, with the hovered element's name and the
     * editor's alerts. Hidden, it takes no space; alerts still reach the host as
     * `message` events, which are emitted either way. Default `true`.
     */
    statusBar?: boolean
    /**
     * The Undo and Redo buttons below the left toolbar's tools. With `tools: []`
     * and `undo: false` the left toolbar takes no space. The keys undo and redo
     * either way. Hidden with the toolbar when `tools` is `false`.
     */
    undo?: boolean
    /**
     * Whether the Properties panel's values (an element's initial value,
     * parameters and variables) can be edited, or are only shown, for a host
     * that sets values itself. Type, species and location stay editable. The
     * `element` command's `set` accepts values in either mode. Default `'editable'`.
     */
    values?: ValuesMode
    /** A hint shown above read-only values, such as where to set them */
    valuesHint?: string
    /**
     * The right-hand panels: `false` hides the panel bar, a list shows just
     * those panels. When absent, or `true`, Properties, Metadata, Style and
     * Reactions are shown; Variables and Annotations are shown only when
     * listed.
     */
    panels?: boolean | EditorPanelName[]
    /**
     * The element palette: labelled tiles dragged onto the canvas or clicked to
     * arm. `'top'` (the default, or `true`) shows it above the canvas, `'left'`
     * beside it, and `false` hides it. The context menu's Add element picker
     * shows the same elements whatever this is.
     */
    palette?: boolean | 'top' | 'left'
    /**
     * The palette's initial filter: a physical domain's id (`'chemical'`, `'electrical'`, `'hydraulic'`,
     * `'mechanical'`, ...) or `'all'`. An unknown id shows `'chemical'`, the default.
     */
    paletteDomain?: PaletteDomain
    /**
     * The zoom controls at the bottom right of the canvas: zoom out, the zoom
     * level, zoom in and Fit. The `+`, `-` and Shift+1 keys work either way.
     * Default `true`.
     */
    zoom?: boolean
    /**
     * The align and distribute buttons at the top right of the canvas, shown
     * while two or more components are selected. Default `true`.
     */
    arrange?: boolean
    /**
     * How long, in milliseconds, the pointer stays on an element before its
     * tooltip (its law, or the `options.tooltip` annotation) shows. No tooltips
     * show while a bond is drawn. Default 600.
     */
    tooltipDelay?: number
    /**
     * Whether a labelled compartment or region gives the stores and sources
     * inside it its label as their location, and element lists carry the
     * `compartment` each is in. Off, compartments and regions are decorative,
     * as in CellDL: their label is plain text, and they set and check nothing
     * about what is inside them. Default `false`.
     */
    compartmentLocations?: boolean
}

export type EditorToolName = 'select' | 'bondgraph' | 'drawing'

export type EditorPanelName = PanelName

//==============================================================================

export interface CellDLEditorProps {
    annotations?: Annotations
    /**
     * How bonds' arrowheads are drawn, in every diagram whatever marker it was
     * saved with: `'bond'`, the editor's notched head, or `'classic'`, PhLynx's
     * closed arrow. Only the display changes, never the saved document.
     * Default `'bond'`.
     */
    arrowStyle?: ArrowStyle
    chrome?: EditorChrome
    editorCommand?: CellDLEditorCommand
    options?: SvgViewerOptions
    theme?: Theme
    /**
     * The unit system new diagrams are given. A diagram that is opened keeps
     * its own, and is SI without one. Default `'cellular'`.
     */
    unitSystem?: UnitSystemId
}
export type EditorData = {
    data: string
    kind?: string
    /** Why a command couldn't be done */
    error?: string
}

/**
 * The diagram's RDF (Turtle) after an edit that changed it. `revision`
 * increases with each change, so a host can drop stale conversions.
 */
export type DiagramChange = {
    revision: number
    rdf: string
}

/**
 * The diagram's bond graph elements, in reply to `list` and, with the
 * `elementList` option, with each `diagram-changed` (with the same `revision`).
 */
export type ElementsChange = {
    kind?: string
    revision: number
    elements: DiagramElement[]
    /** The diagram's unit system, which its values' new units are in (`null` when the editor doesn't know it) */
    unitSystem: UnitSystemId|null
}

/**
 * The view: in reply to a `view` command with a `kind`, once it's set, and,
 * without one, shortly after the view pans or zooms.
 */
export type ViewStateChange = ViewInfo & {
    kind?: string
}

/** The reply to an `element` command's `set` or `select` */
export type ElementResult = {
    kind?: string
    ok: boolean
    errors?: ElementError[]
}

//==============================================================================
//==============================================================================

// Setup PrimeVue's theme, vue-tippy, and our plugins

const crtInstance = vue.getCurrentInstance();

if (crtInstance) {
    const app = crtInstance.appContext.app

    if (!app.config.globalProperties.$primevue) {
        app.use(primeVueConfig as unknown as vue.Plugin, {
            theme: {
                preset: primeVueAuraTheme,
                options: {
                    darkModeSelector: '.celldl-dark-mode'
                }
            }
        })
    }

    app.use(vueTippy)

    // Install our component library manager with the Bondgraph plugin

    componentLibraryPlugin.install(app)
    componentLibraryPlugin.registerPlugin(new BondgraphPlugin())
    componentLibraryPlugin.registerPlugin(new DrawingPlugin())
// WIP    componentLibraryPlugin.registerPlugin(new ElectricalPlugin())
}

//==============================================================================
//==============================================================================

const svgContainer = vue.ref(null)

let celldlDiagram: CellDLDiagram|undefined

// Plugins need to be initialised before creating the editor

const celldlEditor: CellDLEditor = new CellDLEditor()
//const celldlEditor: TestCellDLEditor = new TestCellDLEditor()


//==============================================================================

const props = defineProps<CellDLEditorProps>()

// Bonds' arrowheads, drawn with display-only markers beside the diagram
const displayArrows = displayArrowDefinitions()
const arrowClass = vue.computed(() => arrowStyleClass(arrowStyleOrDefault(props.arrowStyle)))

// Whether compartments give locations, before a diagram is opened
vue.watch(() => props.chrome?.compartmentLocations === true, on => setCompartmentLocations(on), { immediate: true })

// How the Properties panel shows values
vue.provide(VALUES_CHROME_KEY, vue.computed<ValuesChrome>(() => ({
    mode: props.chrome?.values ?? 'editable',
    hint: props.chrome?.valuesHint ?? ''
})))

const emit = defineEmits<{
    'diagram-changed': [change: DiagramChange],
    'editor-data': [data: EditorData],
    'element-result': [result: ElementResult],
    'elements': [change: ElementsChange],
    'editor-state': [state: {
        error: string
    }],
    'event': [detail: ViewerEvent],
    'view-state': [state: ViewStateChange],
    'message': [message: EditorMessage]
}>()

//==============================================================================

vueCommon.useTheme().setTheme(props.theme)

vue.watch(
    () => props.theme,
    () => {
        vueCommon.useTheme().setTheme(props.theme)
    }
)

//==============================================================================

// Annotate diagram components and report pointer events, as `@celldl/viewer` does

celldlEditor.setViewerEventHandler((event: ViewerEvent) => {
    emit('event', event)
})

// The editor's alerts, for a host that shows them itself, e.g. with the status bar hidden
celldlEditor.setMessageHandler((message: EditorMessage) => {
    emit('message', message)
})

celldlEditor.setAnnotations(props.annotations, props.options)

vue.watch(
    () => [props.annotations, props.options],
    () => {
        celldlEditor.setAnnotations(props.annotations, props.options)
    }
)

vue.watch(
    () => props.chrome?.tooltipDelay,
    (delay) => {
        celldlEditor.tooltipDelay = (delay !== undefined && delay >= 0) ? delay : HOVER_TOOLTIP_DELAY
    },
    { immediate: true }
)

// A waiting hover tooltip, or a flashed message, mustn't outlive the editor
vue.onUnmounted(() => celldlEditor.clearTooltips())

//==============================================================================

// Report the diagram's RDF after each edit that changes it, without touching
// selection (unlike `serialise()`). Bursts of edits are coalesced, and nothing
// is read while dragging, since geometry is not part of the RDF.

let rdfRevision = 0
let lastRdf: string|undefined
// Which compartment each store and source is in, which a move changes without changing the RDF
let lastCompartments: string|undefined
let rdfQueued = false
let rdfReading = false
let rdfReadAgain = false
let rdfReadCount = 0
let rdfAfterDrag = false
let rdfDragReadCount = 0

function diagramEdited() {
    if (rdfReading) {
        rdfReadAgain = true
    } else if (!rdfQueued) {
        rdfQueued = true
        queueMicrotask(reportDiagramChange)
    }
}

function watchDragEnd(watch: boolean) {
    rdfAfterDrag = watch
    for (const event of ['pointerup', 'pointercancel']) {
        if (watch) {
            document.addEventListener(event, dragEnded)
        } else {
            document.removeEventListener(event, dragEnded)
        }
    }
}

function dragEnded() {
    watchDragEnd(false)
    // Read now, unless ending the drag has reported an edit itself
    if (rdfReadCount === rdfDragReadCount) {
        diagramEdited()
    }
}

async function reportDiagramChange() {
    rdfQueued = false
    const diagram = celldlDiagram
    if (!diagram) {
        return
    }
    if (celldlEditor.dragging) {
        if (!rdfAfterDrag) {
            rdfDragReadCount = rdfReadCount
            watchDragEnd(true)
        }
        return
    }
    rdfReadCount += 1
    rdfReading = true
    try {
        const rdf = await diagram.rdf()
        const compartments = compartmentsKey(diagram)
        if (diagram === celldlDiagram && rdf !== lastRdf) {
            lastRdf = rdf
            lastCompartments = compartments
            rdfRevision += 1
            emit('diagram-changed', { revision: rdfRevision, rdf })
            if (props.options?.elementList) {
                emit('elements', {
                    revision: rdfRevision,
                    elements: listElements(diagram),
                    unitSystem: diagramUnitSystem(diagram)
                })
            }
        } else if (diagram === celldlDiagram && compartments !== lastCompartments) {
            // Elements moved in or out of a compartment, so may now disagree with its location, or no longer
            lastCompartments = compartments
            if (props.options?.elementList) {
                emit('elements', { revision: rdfRevision, elements: listElements(diagram) })
            }
        }
    } catch (err) {
        console.error('Cannot read the diagram\'s RDF:', err)
    } finally {
        rdfReading = false
    }
    if (rdfReadAgain) {
        rdfReadAgain = false
        diagramEdited()
    }
}

async function setRdfBaseline() {
    lastRdf = await celldlDiagram?.rdf()
    lastCompartments = celldlDiagram ? compartmentsKey(celldlDiagram) : undefined
}

vue.onMounted(() => document.addEventListener('file-edited', diagramEdited))
vue.onUnmounted(() => {
    document.removeEventListener('file-edited', diagramEdited)
    watchDragEnd(false)
})

//==============================================================================

// Set the default component from the component library

// biome-ignore lint/style/noNonNullAssertion: some plugin has a selected template
const defaultComponent = componentLibraryPlugin.getSelectedTemplate()!

//==============================================================================

function despatchToolbarEvent(type: string, source: string, value: boolean|string) {
    document.dispatchEvent(
        new CustomEvent('toolbar-event', {
            detail: {
                type,
                source,
                value
            }
        })
    )
}

//==============================================================================

// Pass 'context-menu' events from the editor to the context menu's component

const contextMenuProps = vue.ref<ContextMenuProps>({
    state: new Set()
})

document.addEventListener('open-context-menu', (event: Event) => {
    contextMenuProps.value = (<CustomEvent>event).detail
})

//==============================================================================

// The element palette, and the context menu's Add element picker, which places its pick where the menu opened

const paletteLayout = vue.computed<'top' | 'left' | null>(() => {
    const palette = props.chrome?.palette
    return palette === false ? null : palette === 'left' ? 'left' : 'top'
})

vue.watch(
    () => props.chrome?.paletteDomain,
    (domain) => {
        paletteDomain.value = domain ?? 'chemical'
    },
    { immediate: true }
)

type AddElementPoint = { client: { x: number, y: number }, svg: { x: number, y: number } }

const addElementAt = vue.ref<AddElementPoint | null>(null)

function openAddElementEvent(event: Event) {
    addElementAt.value = (<CustomEvent>event).detail
}

async function addElementPicked(entryId: string) {
    const at = addElementAt.value
    addElementAt.value = null
    if (at) {
        await celldlEditor.addPaletteEntry(entryId, at.svg)
    }
}

vue.onMounted(() => document.addEventListener('open-add-element', openAddElementEvent))
vue.onUnmounted(() => document.removeEventListener('open-add-element', openAddElementEvent))

// The zoom level, and how many selected components can be aligned

const zoomScale = vue.ref(1)
const arrangeableCount = vue.ref(0)

/** How long the view must settle before `view-state` reports it */
const VIEW_STATE_DELAY = 250

let viewStateTimer: ReturnType<typeof setTimeout> | undefined

function viewChangedEvent(event: Event) {
    zoomScale.value = (<CustomEvent>event).detail.scale
    clearTimeout(viewStateTimer)
    viewStateTimer = setTimeout(() => {
        viewStateTimer = undefined
        emit('view-state', celldlEditor.viewState)
    }, VIEW_STATE_DELAY)
}

function selectionChangedEvent(event: Event) {
    arrangeableCount.value = (<CustomEvent>event).detail.arrangeable
}

vue.onMounted(() => {
    document.addEventListener(VIEW_CHANGED_EVENT, viewChangedEvent)
    document.addEventListener(SELECTION_CHANGED_EVENT, selectionChangedEvent)
})
vue.onUnmounted(() => {
    document.removeEventListener(VIEW_CHANGED_EVENT, viewChangedEvent)
    document.removeEventListener(SELECTION_CHANGED_EVENT, selectionChangedEvent)
    clearTimeout(viewStateTimer)
})

// The canvas's controls keep clear of an open right-hand panel, which lies over the canvas: they move left by
// the width it covers, and stand on end when the canvas left beside it is too narrow for them across

const ZOOM_CONTROLS_WIDTH = 160         // across, with a margin
const canvasArea = vue.ref<HTMLElement|null>(null)
const panelInset = vue.ref(0)
const zoomVertical = vue.ref(false)

function measurePanelInset() {
    const area = canvasArea.value
    if (!area) return
    const bounds = area.getBoundingClientRect()
    let inset = 0
    for (const panel of area.parentElement?.querySelectorAll<HTMLElement>('.panel') ?? []) {
        const rect = panel.getBoundingClientRect()
        if (rect.width > 0 && rect.left < bounds.right) {
            inset = Math.max(inset, Math.min(bounds.width, bounds.right - rect.left))
        }
    }
    panelInset.value = Math.round(inset)
    zoomVertical.value = bounds.width - inset < ZOOM_CONTROLS_WIDTH
}

// A panel's size changes as it opens (from none), closes, or is dragged wider, and the canvas's with the window
let panelObserver: ResizeObserver|null = null

function observePanels() {
    panelObserver?.disconnect()
    const area = canvasArea.value
    if (!area || typeof ResizeObserver === 'undefined') return
    panelObserver ??= new ResizeObserver(measurePanelInset)
    panelObserver.observe(area)
    for (const panel of area.parentElement?.querySelectorAll<HTMLElement>('.panel') ?? []) {
        panelObserver.observe(panel)
    }
    measurePanelInset()
}

vue.onMounted(observePanels)
vue.onUnmounted(() => panelObserver?.disconnect())

//==============================================================================
//==============================================================================

const toolButtons = vue.ref<EditorToolButton[]>([
    {
        toolId: EDITOR_TOOL_IDS.SelectTool,
        active: (DEFAULT_EDITOR_TOOL_ID as EDITOR_TOOL_IDS) === EDITOR_TOOL_IDS.SelectTool,
        prompt: 'Selection tool',
        icon: 'lucide-MousePointer'
    },
    {
        toolId: EDITOR_TOOL_IDS.BondgraphTool,
        active: (DEFAULT_EDITOR_TOOL_ID as EDITOR_TOOL_IDS) === EDITOR_TOOL_IDS.BondgraphTool,
        prompt: 'Bond graph tools',
        icon: 'lucide-Network',
        panel: vue.markRaw(BondgraphPopover)
    },
    {
        toolId: EDITOR_TOOL_IDS.DrawingTool,
        active: (DEFAULT_EDITOR_TOOL_ID as EDITOR_TOOL_IDS) === EDITOR_TOOL_IDS.DrawingTool,
        prompt: 'Drawing tools',
        icon: 'lucide-SquarePen',
        panel: vue.markRaw(DrawingPopover)
    }
])

const TOOL_NAMES: Record<string, EditorToolName> = {
    [EDITOR_TOOL_IDS.SelectTool]: 'select',
    [EDITOR_TOOL_IDS.BondgraphTool]: 'bondgraph',
    [EDITOR_TOOL_IDS.DrawingTool]: 'drawing'
}

const shownToolButtons = vue.computed(() => {
    const tools = props.chrome?.tools
    if (tools === false) {
        return []
    } else if (Array.isArray(tools)) {
        return toolButtons.value.filter(button => tools.includes(TOOL_NAMES[button.toolId] as EditorToolName))
    }
    return toolButtons.value
})

// Leave a tool's mode when its button is hidden, as it could not be left otherwise
vue.watch(shownToolButtons, (shown) => {
    const hiddenActive = toolButtons.value.some(button => button.active && !shown.includes(button))
    if (hiddenActive) {
        resetToolBars()
        despatchToolbarEvent('state', DEFAULT_EDITOR_TOOL_ID, true)
    }
})

//==============================================================================

// Undo and Redo, which work whichever tool is armed

const MOD_KEY = isMacOs() ? '⌘' : 'Ctrl+'

const shownActions = vue.computed<EditorToolAction[]>(() => {
    if (props.chrome?.tools === false || props.chrome?.undo === false) {
        return []
    }
    return [
        {
            actionId: 'editor-undo',
            prompt: `Undo (${MOD_KEY}Z)`,
            icon: 'lucide-Undo2',
            disabled: !undoRedoState.canUndo,
            run: () => celldlEditor.undo()
        },
        {
            actionId: 'editor-redo',
            prompt: isMacOs() ? 'Redo (⇧⌘Z)' : 'Redo (Ctrl+Y)',
            icon: 'lucide-Redo2',
            disabled: !undoRedoState.canRedo,
            run: () => celldlEditor.redo()
        }
    ]
})

//==============================================================================

// Show which tool is armed, as clicks on the canvas then add rather than select

const armedTool = vue.ref('')

function editorModeEvent(event: Event) {
    armedTool.value = (<CustomEvent>event).detail.label
}

// Escape has returned the editor to selecting, so show the Selection tool as active
function resetToolsEvent() {
    resetToolBars()
}

vue.onMounted(() => {
    document.addEventListener('editor-mode', editorModeEvent)
    document.addEventListener('editor-reset-tools', resetToolsEvent)
})
vue.onUnmounted(() => {
    document.removeEventListener('editor-mode', editorModeEvent)
    document.removeEventListener('editor-reset-tools', resetToolsEvent)
})

//==============================================================================

const panelButtons = vue.ref<EditorToolButton[]>([
    {
        toolId: PANEL_ID.PROPERTIES_PANEL,
        prompt: 'Properties',
        icon: 'lucide-Settings',
        panel: vue.markRaw(PropertiesPanel)
    },
    {
        toolId: PANEL_ID.METADATA_PANEL,
        prompt: 'Metadata',
        icon: 'lucide-FileCode',
        panel: vue.markRaw(PropertiesPanel)
    },
    {
        toolId: PANEL_ID.STYLE_PANEL,
        prompt: 'Style',
        icon: 'lucide-Paintbrush',
        panel: vue.markRaw(StylingPanel)
    },
    {
        toolId: PANEL_ID.REACTIONS_PANEL,
        prompt: 'Reactions',
        icon: 'lucide-FlaskConical',
        panel: vue.markRaw(ReactionsPanel)
    },
    {
        toolId: PANEL_ID.VARIABLES_PANEL,
        prompt: 'Variables',
        icon: 'lucide-Tags',
        panel: vue.markRaw(VariablesPanel)
    },
    {
        toolId: PANEL_ID.ANNOTATIONS_PANEL,
        prompt: 'Annotations',
        icon: 'lucide-BookMarked',
        panel: vue.markRaw(AnnotationsPanel)
    }
])

const shownPanelButtons = vue.computed(() => {
    return panelButtons.value.filter(button => isShownPanel(button.toolId, props.chrome?.panels))
})

// Close a panel whose button is hidden, as it could not be closed otherwise
vue.watch(shownPanelButtons, (shown) => {
    for (const button of panelButtons.value) {
        if (button.active && !shown.includes(button)) {
            button.active = false
            despatchToolbarEvent('state', button.toolId, false)
        }
    }
    vue.nextTick(observePanels)
})

// A plain click on empty canvas clears the selection, so closes the panels that show it (Properties and Style).
// Only the panel's display changes: nothing is undoable or edited
function canvasEmptyClickEvent() {
    for (const toolId of closeSelectionPanels(panelButtons.value)) {
        despatchToolbarEvent('state', toolId, false)
    }
}

vue.onMounted(() => document.addEventListener(CANVAS_EMPTY_CLICK_EVENT, canvasEmptyClickEvent))
vue.onUnmounted(() => document.removeEventListener(CANVAS_EMPTY_CLICK_EVENT, canvasEmptyClickEvent))

//==============================================================================

function resetToolBars() {
    // Set the toolbar to its default tool

    for (const toolButton of toolButtons.value) {
        toolButton.active = (DEFAULT_EDITOR_TOOL_ID as EDITOR_TOOL_IDS) === toolButton.toolId
    }

    // Hide any open panel
    // FUTURE: reset to default panel tool
}

//==============================================================================

function buttonEvent(toolId: PANEL_ID, active: boolean) {

    // Tell the editor that a tool has changed

    despatchToolbarEvent('state', toolId, active)
}

//==============================================================================
//==============================================================================

vue.watch(
    () => props.editorCommand,
    async () => {
        if (props.editorCommand?.command === 'file') {
            const command = props.editorCommand as EditorFileCommand
            const options = command.options
            if  (options.action === 'close') {
                resetToolBars()
                await opening(async () => {
                    celldlDiagram = new CellDLDiagram('', '', celldlEditor)
                    await celldlEditor.editDiagram(celldlDiagram)
                    await setRdfBaseline()
                })
            } else if (options.action === 'open') {
                resetToolBars()
                if (options.data !== undefined) {
                    await opening(async () => {
                        try {
                            celldlDiagram = new CellDLDiagram(options?.name || '', options.data!, celldlEditor)
                            await celldlEditor.editDiagram(celldlDiagram)
                            await setRdfBaseline()
                        } catch(err) {
                            emit('editor-state', {
                                error: `Cannot open ${options?.name} -- invalid CellDL file?\n\n${err}`
                            })
                        }
                    })
                }
            } else if (options.action === 'data') {
                const celldl = await celldlDiagram?.serialise()
                emit('editor-data', {
                    data: celldl,
                    kind: options.kind
                } as EditorData)
            } else if (options.action === 'rdf') {
                // The current RDF (Turtle), without changing selection
                emit('editor-data', {
                    data: await celldlDiagram?.rdf() ?? '',
                    kind: options.kind ?? 'rdf'
                })
            }
        } else if (props.editorCommand?.command === 'edit') {
            const command = props.editorCommand as EditorEditCommand
            const options = command.options
            if (options.action === 'clean') {
                undoRedo.clean()
            } else if (options.action === 'map-variables') {
                // open the Variables panel
                const button = document.getElementById(PANEL_ID.VARIABLES_PANEL)
                if (button && !button.classList.contains('active')) button.click()
            } else if (options.action === 'annotate') {
                // open the Annotations panel
                const button = document.getElementById(PANEL_ID.ANNOTATIONS_PANEL)
                if (button && !button.classList.contains('active')) button.click()
            }
        } else if (props.editorCommand?.command === 'element') {
            await elementCommand(props.editorCommand as EditorElementCommand)
        } else if (props.editorCommand?.command === 'document') {
            await documentCommand(props.editorCommand as EditorDocumentCommand)
        } else if (props.editorCommand?.command === 'set-state') {
            const command = props.editorCommand as EditorSetStateCommand
            const options = command.options
            if (options.action === 'reset-tools') {
                resetToolBars()
            }
        } else if (props.editorCommand?.command === 'view') {
            const command = props.editorCommand as EditorViewCommand
            const { zoom, maxScale, centre, kind, ...viewState } = command.options
            // After a diagram opening, which sets its own view as it finishes
            await diagramOpened
            // A zoom on its own leaves the grid and guides as they are
            if (Object.keys(viewState).length) {
                editGuides.setState(viewState)
            }
            if (zoom === 'in') {
                celldlEditor.zoomIn()
            } else if (zoom === 'out') {
                celldlEditor.zoomOut()
            } else if (zoom === 'fit') {
                celldlEditor.zoomToFit(maxScale)
            } else if (typeof zoom === 'number') {
                celldlEditor.zoomTo(zoom, centre ?? null)
            }
            if (kind !== undefined) {
                emit('view-state', { kind, ...celldlEditor.viewState })
            }
        }
    }
)

//==============================================================================

// Settles once the diagram being opened is ready, view and all, so a `view` command sent meanwhile isn't undone
let diagramOpened: Promise<void> = Promise.resolve()

async function opening(open: () => Promise<void>) {
    const opened = open()
    diagramOpened = opened.catch(() => {})
    await opened
}

//==============================================================================

async function elementCommand(command: EditorElementCommand) {
    const options = command.options
    const kind = options.kind
    if (options.action === 'list') {
        emit('elements', {
            kind,
            revision: rdfRevision,
            elements: listElements(celldlDiagram),
            unitSystem: diagramUnitSystem(celldlDiagram)
        })
    } else if (options.action === 'set') {
        const result = await setElements(celldlEditor, celldlDiagram, options.edits ?? [])
        emit('element-result', { kind, ...result })
    } else if (options.action === 'select') {
        const found = celldlEditor.selectObjectById(options.id ?? null, options.centre ?? false)
        emit('element-result', found ? { kind, ok: true } : {
            kind,
            ok: false,
            errors: [{ id: String(options.id), field: '', message: `No object has id '${options.id}'` }]
        })
    }
}

async function documentCommand(command: EditorDocumentCommand) {
    const options = command.options
    const kind = options.kind ?? 'unit-system'
    if (options.action === 'unit-system') {
        emit('editor-data', { kind, data: diagramUnitSystem(celldlDiagram) ?? '' })
    } else if (options.action === 'set-unit-system') {
        const result = await setUnitSystem(celldlEditor, celldlDiagram, options.id, options.convert ?? false)
        emit('editor-data', result.error ? { kind, data: result.unitSystem ?? '', error: result.error }
                                         : { kind, data: result.unitSystem ?? '' })
    }
}

// The unit system new diagrams are given
vue.watch(
    () => props.unitSystem,
    (id) => {
        const plugin = componentLibraryPlugin.getPlugin(BONDGRAPH_PLUGIN_ID) as BondgraphPlugin|undefined
        if (id !== undefined && !isUnitSystemId(id)) {
            console.warn(`Unknown unit system '${id}': new diagrams are '${NEW_DIAGRAM_UNIT_SYSTEM}'`)
        }
        if (plugin) {
            plugin.newDiagramUnitSystem = isUnitSystemId(id) ? id : NEW_DIAGRAM_UNIT_SYSTEM
        }
    },
    { immediate: true }
)

//==============================================================================

vue.onMounted(async () => {
    if (svgContainer.value) {
        const svgContainerElement: HTMLElement = svgContainer.value
        window.setTimeout(async () => {
            if (svgContainerElement.clientWidth === 0 || svgContainerElement.clientHeight === 0) {
                console.error('zero sized container!!')
            }
            celldlEditor.mount(svgContainerElement)

            // Create a new diagram in the editor's window
            await opening(async () => {
                celldlDiagram = new CellDLDiagram('', '', celldlEditor)
                await celldlDiagram.edit()
                await setRdfBaseline()
            })

//            testEditor(celldlEditor)
        })
    }
})

//==============================================================================
//==============================================================================
</script>

<style scoped>
.celldl-display-arrows {
    position: absolute;
    width: 0;
    height: 0;
    overflow: hidden;
    pointer-events: none;
}

.editor-pane {
    min-height: calc(100% - 1.6em);
}
.celldl-editor.no-status-bar .editor-pane:not(.with-top-palette) {
    min-height: 100%;
}
/* An open panel otherwise stops short of the bottom, where the status bar was */
.celldl-editor.no-status-bar :deep(.panel),
.celldl-editor.no-status-bar :deep(.panel-content) {
    bottom: 0;
}
.editor-pane.with-top-palette {
    /* the palette above takes its own height */
    min-height: 0;
}
.editor-bar {
    width: 40px;
    overflow: auto;
}
.canvas-area {
    flex: 1;
    display: flex;
    position: relative;
    min-width: 0;
}
#svg-container {
    margin:  0;
    border: 2px solid var(--editor-border-color);
    flex: 1;
    overflow: hidden;
    position: relative;
}
.armed-tool-chip {
    position: absolute;
    top: 6px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 10;
    white-space: nowrap;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 12px;
    pointer-events: none;
    color: #fff;
    background-color: #2f6fd6;
    opacity: 0.9;
}
.hidden {
    display: none;
}
.status-bar {
    min-height: 1.6em;
    border-top: 1px solid var(--editor-border-color);
    padding-left: 16px;
    padding-right: 16px;
    background-color: var(--editor-statusbar-background);
}
#status-msg.error {
    color: red;
}
#status-msg.warn {
   color: blue;
}
#status-pos {
    float: right;
}
</style>
