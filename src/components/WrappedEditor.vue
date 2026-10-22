<template lang="pug">
    .celldl-editor.flex.flex-col.h-full(:class="arrowClass")
        svg.celldl-display-arrows(aria-hidden="true" width="0" height="0" v-html="displayArrows")
        main.editor-pane.relative.flex.grow
            EditorToolbar.editor-bar(
                v-if="shownToolButtons.length || shownActions.length"
                :buttons="shownToolButtons"
                :actions="shownActions"
                type="popover"
                @button-event="buttonEvent"
            )
            div#svg-container(ref="svgContainer")
                EditorContextMenu(
                    :contextMenuProps="contextMenuProps"
                )
                .armed-tool-chip(
                    v-if="armedTool"
                    role="status"
                ) {{ armedTool }} · Esc to stop
                <!-- context-menu(id="context-menu")  -->
            EditorToolbar.editor-bar(
                v-if="shownPanelButtons.length"
                :buttons="shownPanelButtons"
                type="panel"
                @button-event="buttonEvent"
            )
        footer.status-bar
            span#status-msg
            span#status-pos(v-show="props.chrome?.statusPosition !== false")
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
import { DEFAULT_EDITOR_TOOL_ID, EDITOR_TOOL_IDS } from '#editor/editor'
import { editGuides } from '#editor/editor/editguides'
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
    listElements,
    setElements
} from '#root/plugins/bondgraph/elements'

import { BondgraphPlugin } from '#root/plugins/bondgraph'
import { VALUES_CHROME_KEY, type ValuesChrome, type ValuesMode } from '#root/plugins/bondgraph/values'
import BondgraphPopover from '#root/plugins/bondgraph/bondgraph.vue'

import { DrawingPlugin } from '#root/plugins/drawing'
import DrawingPopover from '#root/plugins/drawing/drawing.vue'

// WIP import { ElectricalPlugin } from '#root/plugins/electrical'
import type { PopoverEventData, ViewState } from '#root/utils/editor-types'

//import { TestCellDLEditor, testEditor } from '../../tests/editor'

import PropertiesPanel from './panels/PropertiesPanel.vue'
import ReactionsPanel from './panels/ReactionsPanel.vue'
import StylingPanel from './panels/StylingPanel.vue'

import EditorToolbar from './toolbar/EditorToolbar.vue'
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

export type CellDLEditorCommand = EditorEditCommand
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
    /** The Undo and Redo buttons below the left toolbar's tools (hidden with the toolbar when `tools` is `false`) */
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
     * Reactions are shown. `variables` and `annotations` are accepted for panels
     * still to come, which are only shown when listed.
     */
    panels?: boolean | EditorPanelName[]
}

export type EditorToolName = 'select' | 'bondgraph' | 'drawing'

export type EditorPanelName = 'properties' | 'metadata' | 'style' | 'reactions' | 'variables' | 'annotations'

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
}
export type EditorData = {
    data: string
    kind?: string
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
    'event': [detail: ViewerEvent]
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

celldlEditor.setAnnotations(props.annotations, props.options)

vue.watch(
    () => [props.annotations, props.options],
    () => {
        celldlEditor.setAnnotations(props.annotations, props.options)
    }
)

//==============================================================================

// Report the diagram's RDF after each edit that changes it, without touching
// selection (unlike `serialise()`). Bursts of edits are coalesced, and nothing
// is read while dragging, since geometry is not part of the RDF.

let rdfRevision = 0
let lastRdf: string|undefined
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
        if (diagram === celldlDiagram && rdf !== lastRdf) {
            lastRdf = rdf
            rdfRevision += 1
            emit('diagram-changed', { revision: rdfRevision, rdf })
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
    }
])

// The panels shown when `chrome.panels` is absent or `true`
const DEFAULT_EDITOR_PANELS: readonly EditorPanelName[] = ['properties', 'metadata', 'style', 'reactions']

const PANEL_NAMES: Record<string, EditorPanelName> = {
    [PANEL_ID.PROPERTIES_PANEL]: 'properties',
    [PANEL_ID.METADATA_PANEL]: 'metadata',
    [PANEL_ID.STYLE_PANEL]: 'style',
    [PANEL_ID.REACTIONS_PANEL]: 'reactions'
}

const shownPanelButtons = vue.computed(() => {
    const panels = props.chrome?.panels
    if (panels === false) {
        return []
    }
    const shown: readonly EditorPanelName[] = Array.isArray(panels) ? panels : DEFAULT_EDITOR_PANELS
    return panelButtons.value.filter(button => shown.includes(PANEL_NAMES[button.toolId] as EditorPanelName))
})

// Close a panel whose button is hidden, as it could not be closed otherwise
vue.watch(shownPanelButtons, (shown) => {
    for (const button of panelButtons.value) {
        if (button.active && !shown.includes(button)) {
            button.active = false
            despatchToolbarEvent('state', button.toolId, false)
        }
    }
})

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
                celldlDiagram = new CellDLDiagram('', '', celldlEditor)
                await celldlEditor.editDiagram(celldlDiagram)
                await setRdfBaseline()
            } else if (options.action === 'open') {
                resetToolBars()
                if (options.data !== undefined) {
                    try {
                        celldlDiagram = new CellDLDiagram(options?.name || '', options.data, celldlEditor)
                        await celldlEditor.editDiagram(celldlDiagram)
                        await setRdfBaseline()
                    } catch(err) {
                        emit('editor-state', {
                            error: `Cannot open ${options?.name} -- invalid CellDL file?\n\n${err}`
                        })
                    }
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
            }
        } else if (props.editorCommand?.command === 'element') {
            await elementCommand(props.editorCommand as EditorElementCommand)
        } else if (props.editorCommand?.command === 'set-state') {
            const command = props.editorCommand as EditorSetStateCommand
            const options = command.options
            if (options.action === 'reset-tools') {
                resetToolBars()
            }
        } else if (props.editorCommand?.command === 'view') {
            const command = props.editorCommand as EditorViewCommand
            editGuides.setState(command.options)
        }
    }
)

//==============================================================================

async function elementCommand(command: EditorElementCommand) {
    const options = command.options
    const kind = options.kind
    if (options.action === 'list') {
        emit('elements', { kind, revision: rdfRevision, elements: listElements(celldlDiagram) })
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
            celldlDiagram = new CellDLDiagram('', '', celldlEditor)
            await celldlDiagram.edit()
            await setRdfBaseline()

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
.editor-bar {
    width: 40px;
    overflow: auto;
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
