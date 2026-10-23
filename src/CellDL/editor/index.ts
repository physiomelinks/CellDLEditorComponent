/******************************************************************************

CellDL Editor

Copyright (c) 2022 - 2025 David Brooks

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

******************************************************************************/
/** biome-ignore-all lint/style/noNonNullAssertion: values known to be non null */

import * as vue from 'vue'
import type { Instance as TippyInstance } from "tippy.js"
import { useTippy } from "vue-tippy"

import '#root/assets/svgContent.css'

import type { CellDLObject } from '#editor/celldlObjects'
import { ConnectionStyle } from '#editor/connections'
import { PathMaker, type PathNode } from '#editor/connections/pathmaker'
import type { TemplateEventDetails } from '#editor/components'
import { objectMetadataTemplate, ObjectPropertiesPanel } from '#editor/components/properties'
import type { CellDLDiagram } from '#editor/diagram'
import { SelectionSet } from '#editor/diagram/selectionset'
import { type MoveUndoState, undoRedo } from '#editor/diagram/undoredo'
import type { Bounds } from '#editor/geometry'
import { round } from '#editor/utils'

import { isMacOs } from '#root/utils/common'
import { type Annotations, PANEL_ID, type SvgViewerOptions, type ViewerEvent, type ViewInfo } from '#root/utils/editor-types'
import { type Point, type PointLike, PointMath } from '#root/utils/points'
import { imagesLoaded } from '#root/utils/svgUtils'
import type { StringProperties } from '#root/utils/types'
import { componentLibraryPlugin } from '#root/plugins'
import { paletteEntry, placeEntry } from '#root/plugins/bondgraph/palette'

//==============================================================================

import { type ArrangeBounds, type ArrangeOp, arrangeTargets, minimumForArrange } from './arrange'
import { drawBondCounts } from './bondcounts'
import { BondDrag } from './bonddrag'
import { EditorFrame } from './editorframe'
import { DEFAULT_VIEW_STATE, editGuides, EDITOR_GRID_CLASS } from './editguides'
import PanZoom, { ZOOM_STEP } from './panzoom'
import { BoxMaker } from './boxmaker'
import { drawSideLabels } from './sidelabels'
import { type TooltipContent, type TooltipDisplay, Tooltips } from './tooltips'

//==============================================================================

// Set the CSS variables that style a compartment as it is being drawn

import {
    COMPARTMENT_BACKGROUND,
    MEMBRANE_COLOUR,
    MEMBRANE_CORNER_RADIUS,
    MEMBRANE_GAP,
    MEMBRANE_STROKE_WIDTH
} from '#root/utils/styling'
document.documentElement.style.setProperty('--editor-compartment-fill', COMPARTMENT_BACKGROUND)
document.documentElement.style.setProperty('--editor-membrane-colour', MEMBRANE_COLOUR)
document.documentElement.style.setProperty('--editor-membrane-gap', String(MEMBRANE_GAP))
document.documentElement.style.setProperty('--editor-membrane-radius', String(MEMBRANE_CORNER_RADIUS))
document.documentElement.style.setProperty('--editor-membrane-width', String(MEMBRANE_STROKE_WIDTH))

//==============================================================================

/****  WIP
const SVG_CLOSE_DISTANCE = 2   // Pointer is close to object in SVG coords
                               // c.f. stroke-width (for connections)??
WIP ****/

//==============================================================================

const MAX_POINTER_CLICK_TIME = 200 // milliseconds
const MAX_POINTER_CLICK_DISTANCE = 4 // pixels

//==============================================================================

// Lookup tables for tracking tool bar state

export enum EDITOR_TOOL_IDS {
    SelectTool = 'editor-select-tool',
    BondgraphTool = 'editor-bondgraph-tool',
    DrawingTool = 'editor-drawing-tool'
}

export const DEFAULT_EDITOR_TOOL_ID = EDITOR_TOOL_IDS.SelectTool

enum EDITOR_MODE {
    Selecting = 'SELECTING',
    PathDrawing = 'DRAW-PATH',
    AddingComponent = 'ADD-COMPONENT',
    DrawCompartment = 'DRAW-COMPARTMENT'
}

const DEFAULT_EDITOR_MODE = EDITOR_MODE.Selecting

//==============================================================================

function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Draws the editor's tooltips with a Tippy instance, which follows the pointer unless placed at a point */
function tippyDisplay(tippy: TippyInstance): TooltipDisplay {
    let styleClass = ''
    return {
        show(content: TooltipContent, at?: PointLike) {
            tippy.setProps({
                allowHTML: content.html,
                maxWidth: content.html ? 640 : 350,
                followCursor: at === undefined,
                getReferenceClientRect: at ? () => new DOMRect(at.x, at.y, 0, 0) : null
            })
            tippy.setContent(content.text)
            tippy.show()
            if (styleClass !== '') {
                tippy.popper.classList.remove(styleClass)
                styleClass = ''
            }
            if (content.style !== '') {
                styleClass = `tooltip-${content.style}`
                tippy.popper.classList.add(styleClass)
            }
        },
        hide() {
            tippy.hide()
        },
        get visible() {
            return tippy.state.isVisible
        }
    }
}

/** Whether a PrimeVue overlay (a dropdown, menu or popover) is open, which closes itself on Escape. */
function popupOpen(): boolean {
    return document.querySelector('.p-select-overlay, .p-contextmenu, .p-popover, .p-autocomplete-overlay') !== null
}

/** Whether a toolbar tool's popover, such as the bond graph palette, is showing. */
function toolPopoverOpen(): boolean {
    return document.querySelector('.celldl-editor .popover:not(.hidden)') !== null
}

/** Whether a key event's target takes typed text. */
function isTextField(target: EventTarget|null): boolean {
    if (!(target instanceof HTMLElement)) {
        return false
    }
    if (target.isContentEditable || target instanceof HTMLTextAreaElement) {
        return true
    }
    if (target instanceof HTMLInputElement) {
        return !['button', 'checkbox', 'radio', 'range', 'reset', 'submit', 'color', 'file'].includes(target.type)
    }
    return false
}

//==============================================================================

export enum CONTEXT_MENU {
    ADD_ELEMENT = 'menu-add-element',
    DELETE = 'menu-delete',
    EDIT_GROUP = 'menu-edit-group',
    INFO = 'menu-info',
    GROUP_OBJECTS = 'menu-group',
    UNGROUP_OBJECTS = 'menu-ungroup'
}

//==============================================================================

export function notifyChanges() {
    document.dispatchEvent(new CustomEvent('file-edited'))
}

/** The view's scale has changed, as `detail.scale` */
export const VIEW_CHANGED_EVENT = 'editor-view-changed'

/** The selection has changed, with `detail.arrangeable` components that can be aligned */
export const SELECTION_CHANGED_EVENT = 'editor-selection-changed'

//==============================================================================

export function getElementId(element: SVGGraphicsElement): string {
    return element.dataset.parentId
        ? element.dataset.parentId
        : element.classList.contains('parent-id')
          ? element.parentElement?.id || ''
          : element.id
}

//==============================================================================

const SVG_PANEL_ID = 'svg-panel'
type PointerEventHandler = (eventType: string, svgElement: SVGGraphicsElement, svgCoords: PointLike) => boolean
export type ViewerEventHandler = (event: ViewerEvent) => void


export class CellDLEditor {
    static instance: CellDLEditor | null = null

    #container: HTMLElement | null = null
    #statusMsg: HTMLElement | null = null
    #statusPos: HTMLElement | null = null
    #statusStyle: string = ''

    #celldlDiagram: CellDLDiagram | null = null
    #svgDiagram: SVGSVGElement | null = null
    #editorFrame: EditorFrame | null = null
    #moveUndoState: MoveUndoState | null = null

    #panning: boolean = false
    #panzoom: PanZoom | null = null
    protected pointerMoved: boolean = false
    protected moving: boolean = false
    protected moved: boolean = false
    #moveSelection: boolean = false
    #movingBoxContents: boolean = false
    // A press in the canvas whose release is still to come, and where the pointer last was in it
    #pointerHeld: boolean = false
    #lastSvgPoint: DOMPoint | null = null

    #editorMode: EDITOR_MODE = DEFAULT_EDITOR_MODE
    #dirty: boolean = false

    #dragging: boolean = false

    #pathMaker: PathMaker | null = null
    #nextPathNode: PathNode | null = null

    // Hover-to-bond, in Selecting mode
    #bondDrag: BondDrag

    #contextMenuActiveItems: Set<CONTEXT_MENU> = new Set()
    // Where the context menu was opened, for its Add element item
    #contextMenuPoint: { client: PointLike, svg: PointLike } | null = null

    #currentTemplateDetails: TemplateEventDetails | null = null
    #drawConnectionSettings: StringProperties = {}

    // Keep:
    // * Current object that the pointer is over
    // * Set of active objects -- either currentObject or set of selectedObjects
    // * set of selected objects.
    #activeObjects: Map<string, CellDLObject> = new Map()
    protected currentObject: CellDLObject | null = null
    protected selectionSet: SelectionSet = new SelectionSet(this)

    // Auto close selection box on pointer up, keeping enclosed objects selected
    #boxMaker: BoxMaker | null = null
    #boxMaking: boolean = false

    #pointerDownTime: number = 0
    // A click counts only when it started on the canvas, not when a closing popup's click lands there
    #pointerDownInContainer: boolean = false
    // Set when pointer up has already made a click's selection, so the click itself is ignored
    #clickDoneOnPointerUp: boolean = false
    // Whether a popup was open when the current key went down
    #popupOpenAtKeyDown: boolean = false
    #pointerDownPosn: PointLike = { x: 0, y: 0 }
    #pointerEventHandlers: Map<string, PointerEventHandler> = new Map()

    #openPanel: ObjectPropertiesPanel | undefined = undefined
    // Property edits run one after another, so each is its own undo step
    #propertiesEditing: Promise<void> = Promise.resolve()
    #panels: Map<PANEL_ID, ObjectPropertiesPanel> = new Map([
        [
            PANEL_ID.METADATA_PANEL, new ObjectPropertiesPanel(PANEL_ID.METADATA_PANEL, [
                objectMetadataTemplate(),
                ...componentLibraryPlugin.getPanelTemplates(PANEL_ID.METADATA_PANEL)
            ])
        ],
        [
            PANEL_ID.PROPERTIES_PANEL, new ObjectPropertiesPanel(PANEL_ID.PROPERTIES_PANEL,
                componentLibraryPlugin.getPanelTemplates(PANEL_ID.PROPERTIES_PANEL)
            )
        ],
        [
            PANEL_ID.STYLE_PANEL, new ObjectPropertiesPanel(PANEL_ID.STYLE_PANEL,
                componentLibraryPlugin.getPanelTemplates(PANEL_ID.STYLE_PANEL)
            )
        ]
    ])

    #tooltips = new Tooltips()

    // Viewer compatible annotations and events
    #annotations: Annotations = {}
    #tooltipField: string | undefined = undefined
    #viewerEventHandler: ViewerEventHandler | null = null
    #activeEventObject: CellDLObject | null = null
    #selectedEventObjects: Map<string, CellDLObject> = new Map()
    #selectionClicking: boolean = false

    // Events about this editor's diagram, for code that must not hear another editor's
    #events = new EventTarget()

    constructor() {
        CellDLEditor.instance = this

        // The host's getters read the editor's private fields
        const editor = this
        this.#bondDrag = new BondDrag({
            get celldlDiagram() { return editor.#celldlDiagram },
            get editorFrame() { return editor.#editorFrame },
            get canStartBond() {
                return editor.#editorMode === EDITOR_MODE.Selecting && editor.#celldlDiagram !== null
                    && !editor.moving && !editor.#panning && editor.#boxMaker === null
            },
            get bondStyle() { return editor.#drawConnectionSettings.style || ConnectionStyle.Linear },
            svgPoint: (event) => editor.#domToSvgCoords(event),
            objectAt: (element) => editor.#objectAt(element),
            suppressTooltips: (suppress) => editor.#tooltips.suppress(suppress),
            flashError: (message, at) => editor.#tooltips.flash(message, at),
            click: (event, object) => editor.#selectingClick(event, object.svgElement ?? event.target as SVGGraphicsElement, object)
        })

        // Add a handler for events from toolbar buttons and popovers
        document.addEventListener('toolbar-event', this.#toolBarEvent.bind(this))
        document.addEventListener('component-selected', this.#componentTemplateSelectedEvent.bind(this))
        document.addEventListener('component-drag', this.#componentTemplateDragEvent.bind(this))
        document.addEventListener('connection-style', this.#connectionStyleEvent.bind(this))
        document.addEventListener('celldl-drawing', this.#celldlDrawingEvent.bind(this))

        // Redraw bond counts after a change, in this editor's diagram
        document.addEventListener('file-edited', () => {
            this.#scheduleBondCounts()
            // at once, so a reaction side's caption follows its junction as it is dragged
            if (this.#celldlDiagram !== null) {
                drawSideLabels(this.#celldlDiagram)
            }
        })

        // Add handler for events from panels
        document.addEventListener('panel-event', this.#panelEvent.bind(this))
        document.addEventListener('style-event', this.#styleEvent.bind(this))

        // Handle click events on control points
        document.addEventListener('select-object', this.#objectClickEvent.bind(this))
    }

    mount(svgContainer: HTMLElement) {
        this.#container = svgContainer
        this.#statusMsg = document.getElementById('status-msg')
        this.#statusPos = document.getElementById('status-pos')

        // Create a panzoom handler
        this.#panzoom = new PanZoom(this.#container, (scale: number) => {
            document.dispatchEvent(new CustomEvent(VIEW_CHANGED_EVENT, { detail: { scale } }))
        })
        this.#bondDrag.mount(this.#container)

        // Set up event handlers
        this.#container.addEventListener('click', this.#pointerClickEvent.bind(this))
        this.#container.addEventListener('dblclick', this.#pointerDoubleClickEvent.bind(this))

        this.#container.addEventListener('pointerover', this.#pointerOverEvent.bind(this))
        this.#container.addEventListener('pointerout', this.#pointerOutEvent.bind(this))

        this.#container.addEventListener('pointerdown', this.#pointerDownEvent.bind(this))
        this.#container.addEventListener('pointermove', this.#pointerMoveEvent.bind(this))
        this.#container.addEventListener('pointerup', this.#pointerUpEvent.bind(this))
        // A drag released outside the canvas, such as over the palette or another window, or taken away
        document.addEventListener('pointerup', this.#documentPointerUpEvent.bind(this))
        document.addEventListener('pointercancel', this.#documentPointerUpEvent.bind(this))
        window.addEventListener('blur', () => this.#endDragElsewhere(null))

        // Keyboard handlers. A popup's own handler may close it before ours runs, so note first whether one is open
        window.addEventListener('keydown', this.#keyDownCaptureEvent.bind(this), true)
        window.addEventListener('keydown', this.#keyDownEvent.bind(this))
        window.addEventListener('keyup', this.#keyUpEvent.bind(this))

        // Add handlers for dropping components on the canvas
        this.#container.addEventListener('dragover', this.#appDragOverEvent.bind(this))
        this.#container.addEventListener('drop', this.#appDropEvent.bind(this))

        // Create a tooltip

        const { tippy } = useTippy(this.#container, {
            content: '',
            animation: 'none',
            duration: [0, 0],
            showOnCreate: false,
            hideOnClick: false,
            trigger: 'manual',
            arrow: true,
            followCursor: true
        })
        if (tippy.value) {
            this.#tooltips.display = tippyDisplay(tippy.value)
        }
        // Handle context menu events
        this.#container.addEventListener('contextmenu', (event) => {
            this.#tooltips.cancelHover()
            const element = event.target as SVGGraphicsElement
            const clickedObject = this.#objectAt(element)
            if (clickedObject && !this.selectionSet.has(clickedObject)) {
                // The menu acts on what was right clicked, unless that's already part of the selection
                this.selectionSet.clear()
                this.setSelectedObject(clickedObject)
            }
            this.enableContextMenuItem(CONTEXT_MENU.DELETE, this.selectionSet.size > 0)
            this.#contextMenuPoint = {
                client: { x: event.clientX, y: event.clientY },
                svg: this.#domToSvgCoords(event)
            }
            // Elements are only added from empty canvas: a right click on an element is about that element
            this.enableContextMenuItem(CONTEXT_MENU.ADD_ELEMENT, this.#celldlDiagram !== null && !clickedObject)
            document.dispatchEvent(new CustomEvent('open-context-menu', {
                detail: {
                    state: this.#contextMenuActiveItems,
                    event: event
                }
            }))
        })
        document.addEventListener('context-menu-click', (event: Event) => {
            const targetId = (<CustomEvent>event).detail.id
            if (targetId === CONTEXT_MENU.ADD_ELEMENT) {
                // The element picker opens where the menu was, and places its pick there
                if (this.#contextMenuPoint) {
                    document.dispatchEvent(new CustomEvent('open-add-element', { detail: this.#contextMenuPoint }))
                }
            } else if (targetId === CONTEXT_MENU.DELETE) {
                this.#deleteSelectedObjects()
            } else if (targetId === CONTEXT_MENU.INFO) {
// WIP               this.#showSelectedObjectInfo()
            } else if (targetId === CONTEXT_MENU.GROUP_OBJECTS) {
                if (this.#boxMaker) {
                    this.#boxMaker.groupComponents()
                    this.#closeBoxMaker()
                }
            }
        })
    }

    get celldlDiagram() {
        return this.#celldlDiagram
    }

    /** Is an object or selection being dragged? */
    get dragging(): boolean {
        return this.moving
    }

    get dirty() {
        return this.#dirty
    }

    get editorFrame() {
        return this.#editorFrame
    }

    get status(): string {
        return this.#statusMsg ? this.#statusMsg.innerText : ''
    }
    set status(text: string) {
        this.showMessage(text)
    }

    get windowSize(): [number, number] {
        if (this.#container) {
            return [this.#container.clientWidth, this.#container.clientHeight]
        }
        return [0, 0]
    }

    setDirty() {
        if (!this.#dirty) {
            this.#dirty = true
        }
    }

    markClean() {
        if (this.#dirty) {
            this.#dirty = false
        }
    }

    setAnnotations(annotations: Annotations | undefined, options: SvgViewerOptions | undefined) {
        this.#annotations = annotations || {}
        this.#tooltipField = options?.tooltip
    }

    setViewerEventHandler(handler: ViewerEventHandler | null) {
        this.#viewerEventHandler = handler
    }

    #emitViewerEvent(type: ViewerEvent['type'], object: CellDLObject | null = null) {
        if (this.#viewerEventHandler) {
            const event: ViewerEvent = { type }
            if (object) {
                event.component = { id: object.id }
                if (Object.hasOwn(this.#annotations, object.id)) {
                    event.component.annotation = this.#annotations[object.id]
                }
            }
            this.#viewerEventHandler(event)
        }
    }

    #setActiveEventObject(object: CellDLObject | null) {
        if (object === this.#activeEventObject) {
            return
        }
        if (this.#activeEventObject) {
            this.#activeEventObject = null
            this.#tooltips.cancelHover()
            this.#emitViewerEvent('unactive')
        }
        if (object) {
            this.#activeEventObject = object
            this.#emitViewerEvent('active', object)
        }
    }

    // Called by the selection set whenever the selection changes
    selectionChanged() {
        if (!this.#selectionClicking) {
            this.#emitUnselectEvents()
        }
        document.dispatchEvent(new CustomEvent(SELECTION_CHANGED_EVENT, {
            detail: { arrangeable: this.#arrangeableObjects().length }
        }))
    }

    #emitUnselectEvents() {
        for (const object of [...this.#selectedEventObjects.values()]) {
            if (!this.selectionSet.has(object)) {
                this.#selectedEventObjects.delete(object.id)
                this.#emitViewerEvent('unselect', object)
            }
        }
    }

    async editDiagram(celldlDiagram: CellDLDiagram) {
        if (this.#celldlDiagram !== null) {
            this.closeDiagram()
        }
        this.#celldlDiagram = celldlDiagram
        this.#svgDiagram = celldlDiagram.svgDiagram

        // Make sure we have a group in which to put selection related objects
        // This MUST remain as the last group in the diagram when new layer groups are added...
        this.#editorFrame = new EditorFrame(celldlDiagram)

        // Initialise alignment guides and grid
        editGuides.newDiagram(celldlDiagram, DEFAULT_VIEW_STATE)

        // Show the diagram in the editor's window
        if (this.#container) {
            this.#container.appendChild(this.#svgDiagram!)
        }

        // Allow for the diagram to render, and its images to load so they can be measured
        await vue.nextTick()
        await imagesLoaded(this.#svgDiagram!)

        // Rewriting metadata during diagram finishSetup might dirty
        this.markClean()
        undoRedo.clean()

        // Finish setting up the diagram as we now have SVG elements
        celldlDiagram.finishSetup()

        // Enable pan/zoom and toolBars
        this.#panzoom!.enable(this.#svgDiagram!)

        // Set initial mode
        this.#editorMode = DEFAULT_EDITOR_MODE
        this.#bondDrag.reset()
        this.#notifyEditorMode()
        this.currentObject = null
        this.pointerMoved = false
        this.#activeObjects.clear()
        this.#activeEventObject = null
        this.#selectedEventObjects.clear()
        this.#tooltips.reset()
        this.selectionSet.clear()

        this.#events.dispatchEvent(new CustomEvent('diagram-opened', { detail: { diagram: celldlDiagram } }))
        this.#scheduleBondCounts()
        drawSideLabels(celldlDiagram)
    }

    #bondCountsTimer: ReturnType<typeof setTimeout> | undefined

    // Shortly, so a burst of changes redraws once
    #scheduleBondCounts() {
        if (this.#bondCountsTimer !== undefined) {
            clearTimeout(this.#bondCountsTimer)
        }
        this.#bondCountsTimer = setTimeout(() => {
            this.#bondCountsTimer = undefined
            if (this.#celldlDiagram !== null && this.#svgDiagram !== null) {
                drawBondCounts(this.#celldlDiagram)
            }
        }, 50)
    }

    /**
     * Listens for an event about this editor's diagram, rather than any editor's,
     * as a host may have several editors.
     *
     * `'diagram-opened'`: a diagram has been opened (or a new one started) and
     * is ready to edit; its `detail.diagram` is the `CellDLDiagram`.
     */
    addEventListener(type: 'diagram-opened', listener: EventListener) {
        this.#events.addEventListener(type, listener)
    }

    removeEventListener(type: 'diagram-opened', listener: EventListener) {
        this.#events.removeEventListener(type, listener)
    }

    closeDiagram() {
        if (this.#celldlDiagram !== null) {
            this.#editorFrame!.clear()
            this.#editorFrame = null
            this.#bondDrag.reset()
            this.#tooltips.reset()
            //            this.#toolBar.enable(false)
            this.#panzoom!.disable()
            if (this.#container) {
                this.#container.removeChild(this.#svgDiagram as Node)
            }
            this.#svgDiagram = null
            this.#celldlDiagram = null
        }
    }

    /** Undoes the last change, after cancelling any move being dragged, partial bond or selection box. */
    undo() {
        if (this.#celldlDiagram === null) {
            return
        }
        if (this.#cancelMove()) {
            // Undoing a move being dragged just puts it back
            return
        }
        if (this.#cancelPartialPath()) {
            // Undoing a bond being drawn just removes it
            return
        }
        // A selection box would no longer surround what it selects
        this.#closeBoxMaker()
        undoRedo.undo(this.#celldlDiagram)
    }

    /** Redoes the last undone change. */
    redo() {
        if (this.#celldlDiagram === null) {
            return
        }
        this.#cancelPartialPath()
        this.#closeBoxMaker()
        undoRedo.redo(this.#celldlDiagram)
    }

    #cancelPartialPath(): boolean {
        if (this.#bondDrag.cancel()) {
            return true
        }
        if (this.#pathMaker) {
            this.#pathMaker.close()
            this.#pathMaker = null
            return true
        }
        return false
    }

    /** Tells the toolbar which tool is armed, for its indicator. */
    #notifyEditorMode() {
        let label = ''
        if (this.#editorMode === EDITOR_MODE.AddingComponent) {
            const details = this.#currentTemplateDetails
            const name = details?.entryId ? paletteEntry(details.entryId)?.label
                       : details ? componentLibraryPlugin.getObjectTemplateById(details.id)?.name
                       : undefined
            label = `Adding ${name || 'elements'}`
        } else if (this.#editorMode === EDITOR_MODE.PathDrawing) {
            label = 'Drawing bonds'
        } else if (this.#editorMode === EDITOR_MODE.DrawCompartment) {
            label = 'Drawing compartments'
        }
        document.dispatchEvent(new CustomEvent('editor-mode', {
            detail: { mode: this.#editorMode, label }
        }))
    }

    resetObjectStates() {
        this.unsetSelectedObjects()
        this.#unsetActiveObjects()
    }

    #setDefaultCursor() {
        if (this.#editorMode === EDITOR_MODE.PathDrawing
         || this.#editorMode === EDITOR_MODE.DrawCompartment) {
            this.#svgDiagram?.style.setProperty('cursor', 'crosshair')
        } else if (this.#editorMode === EDITOR_MODE.AddingComponent) {
            this.#svgDiagram?.style.setProperty('cursor', 'copy')
        } else {
            this.#svgDiagram?.style.removeProperty('cursor')
        }
        if (this.#container) {
            this.#container.style.setProperty('cursor', 'default')
        }
    }

    enableContextMenuItem(itemId: CONTEXT_MENU, enable: boolean = true) {
        if (enable) {
            this.#contextMenuActiveItems.add(itemId)
        } else {
            this.#contextMenuActiveItems.delete(itemId)
        }
    }

    #changeMode(editorMode: EDITOR_MODE) {
        this.#editorMode = editorMode
        this.#setDefaultCursor()
        this.unsetSelectedObjects()
        this.#closeBoxMaker()
        if (this.#editorMode !== EDITOR_MODE.PathDrawing) {
            // Remove any partial path from editor frame...
            this.#cancelPartialPath()
        }
        this.#notifyEditorMode()
    }

    #toolBarEvent(event: Event) {
        const detail = (<CustomEvent>event).detail
        if (detail.type === 'state') {
            if (this.#panels.has(detail.source)) {
                this.#openPanel = this.#panels.get(detail.source)
            } else {
                this.#changeMode(EDITOR_MODE.Selecting)
            }
        }
    }

    async #panelEvent(event: Event) {
        const detail = (<CustomEvent>event).detail
        const panel = this.#openPanel
        if (panel && detail.source === panel.panelId) {
            if (this.selectionSet.size === 1) {
                const values = detail.value
                if (values.oldValue !== values.newValue) {
                    const object = this.selectionSet.objects[0]!
                    if (panel.panelId === PANEL_ID.PROPERTIES_PANEL) {
                        // Undoable, as the host's `element` command's edits are
                        await this.editProperties([object], async () => {
                            await panel.updateObjectProperties(object, detail.itemId, detail.value)
                        })
                    } else {
                        await panel.updateObjectProperties(object, detail.itemId, detail.value)
                        notifyChanges()
                    }
                }
            }
        }
    }

    /**
     * Edits objects' properties as one undoable step, reporting the change.
     *
     * Edits are made one at a time, in the order asked for.
     *
     * @param objects The objects whose properties `edit` changes.
     * @param edit Makes the changes.
     * @param rebindPanel Reload the Properties panel if it shows an edited object.
     * @returns Whether any property changed.
     */
    editProperties(objects: CellDLObject[], edit: () => Promise<void>, rebindPanel: boolean=false): Promise<boolean> {
        const run = async () => {
            if (objects.length === 0) {
                return false
            }
            const undoState = undoRedo.setPropertiesUndoState(objects)
            let changed = false
            try {
                await edit()
            } finally {
                // An edit that fails part way through is still undone as one step
                changed = undoRedo.endPropertiesEdit(undoState)
            }
            if (changed) {
                notifyChanges()
                if (rebindPanel) {
                    this.refreshPropertiesPanel(objects)
                }
            }
            return changed
        }
        const result = this.#propertiesEditing.then(run, run)
        this.#propertiesEditing = result.then(() => undefined, () => undefined)
        return result
    }

    /** Reloads the panels if they show one of the objects, e.g. after its properties changed elsewhere. */
    refreshPropertiesPanel(objects: CellDLObject[]) {
        if (this.selectionSet.size === 1) {
            const selected = this.selectionSet.objects[0]!
            if (objects.some(object => object.id === selected.id)) {
                this.setPropertiesPanelObject(undefined)
                this.setPropertiesPanelObject(selected)
            }
        }
    }

    /**
     * Selects just one object, as clicking it would, or clears the selection.
     *
     * @param id The object's id, or `null` to clear the selection.
     * @param centre Pan to centre the object: always, never, or only when it is not wholly in view.
     * @returns Whether the object was found (always `true` when clearing).
     */
    selectObjectById(id: string|null, centre: boolean|'if-hidden'=false): boolean {
        if (this.#celldlDiagram === null) {
            return false
        }
        const object = (id === null) ? null : this.#celldlDiagram.objectById(id)
        if (id !== null && object === null) {
            return false
        }
        this.#closeBoxMaker()
        this.selectionSet.clear()     // Reports unselections
        if (object) {
            this.setSelectedObject(object)
            this.#selectedEventObjects.set(object.id, object)
            this.#emitViewerEvent('select', object)
            const svgElement = object.celldlSvgElement
            if (svgElement && this.#panzoom && centre !== false) {
                if (centre === true || !this.#panzoom.inView(svgElement.svgBounds())) {
                    this.#panzoom.centreOn(svgElement.centroid)
                }
            }
        }
        return true
    }

    async #styleEvent(event: Event) {
        const detail = (<CustomEvent>event).detail
        if (detail.source === this.#openPanel?.panelId) {
            if (this.#openPanel && this.selectionSet.size === 1) {
                await this.#openPanel.updateObjectStyling(this.selectionSet.objects[0]!, detail.styling)
                notifyChanges()
            }
        }
    }

    showMessage(msg: string, style: string = '') {
        if (this.#statusMsg) {
            this.#statusMsg.innerText = msg
            if (this.#statusStyle !== '') {
                this.#statusMsg.classList.remove(this.#statusStyle)
            }
            if (style !== '') {
                this.#statusMsg.classList.add(style)
                this.#statusStyle = style
            }
        }
    }

    #showStatus(pos: PointLike|null, currentObject: CellDLObject|null=null) {
        if (pos === null) {
            this.status = ''
            if (this.#statusPos) {
                const text = this.#statusPos.innerText
                if (!text.startsWith('(')) {
                    if (text.includes('(')) {
                        const parts = text.split('(')
                        this.#statusPos.innerText = `(${parts.slice(1).join('(')}`
                    } else {
                        this.#statusPos.innerText = ''
                    }
                }
            }
        } else {
            const position = `(${round(pos.x, 1)}, ${round(pos.y, 1)})`
            if (currentObject === null) {
                currentObject = this.currentObject
            }
            if (currentObject) {
                let pluginText = componentLibraryPlugin.statusText(currentObject)
                if (pluginText !== '') {
                    pluginText = ` (${pluginText})`
                }
                this.status = (currentObject.name ?? '') + pluginText
                if (this.#statusPos) {
                    this.#statusPos.innerText = `${currentObject.id} ${position}`
                }
            } else {
                this.status = ''
                if (this.#statusPos) {
                    this.#statusPos.innerText = position
                }
            }
        }
    }

    /** How long the pointer stays on an element before its tooltip shows, in milliseconds */
    get tooltipDelay(): number {
        return this.#tooltips.delay
    }

    set tooltipDelay(delay: number) {
        this.#tooltips.delay = delay
    }

    /** Cancels any waiting or shown tooltip, e.g. when the editor is unmounted */
    clearTooltips() {
        this.#tooltips.reset()
    }

    /**
     * Shows a message in the tooltip, unless one of higher priority is shown.
     *
     * @param msg The message; `''` hides the tooltip.
     * @param style `'error'` shows an error, any other style a hint.
     * @param html Whether `msg` is HTML (from a plugin), never user text unescaped.
     */
    showTooltip(msg: string, style: string = '', html: boolean = false) {
        if (msg === '') {
            this.#tooltips.hide()
        } else {
            this.#tooltips.show(style === 'error' ? 'error' : 'hint', msg, style, html)
        }
    }

    /** The host's annotation tooltip for an object, or `''`. */
    #annotationTooltipText(object: CellDLObject): string {
        const annotation = Object.hasOwn(this.#annotations, object.id) ? this.#annotations[object.id] : undefined
        if (this.#tooltipField === undefined || !annotation || !Object.hasOwn(annotation, this.#tooltipField)) {
            return ''
        }
        return String(annotation[this.#tooltipField])
    }

    /**
     * Shows an object's hover tooltips once the pointer has stayed on it: a
     * plugin's hover (e.g. an element's law, else a reaction's equation) or,
     * when there's none, the host's annotation tooltip.
     */
    #hoverTooltipAfterDelay(object: CellDLObject) {
        this.#tooltips.hoverAfterDelay(object, () => {
            this.#showHover(object)
            if (this.#editorMode === EDITOR_MODE.Selecting) {
                const text = this.#annotationTooltipText(object)
                if (text !== '') {
                    this.#tooltips.show('annotation', text, 'info')
                }
            }
        })
    }

    /**
     * Shows a plugin's hover for an object (e.g. an element's law), with the
     * host's annotation tooltip above it, so that is still seen. Without a
     * hover, any hover shown is hidden and the annotation tooltip is left.
     */
    #showHover(object: CellDLObject) {
        const hoverHtml = componentLibraryPlugin.hoverHtml(object)
        const hoverText = hoverHtml === '' ? componentLibraryPlugin.hoverText(object) : ''
        if (hoverHtml === '' && hoverText === '') {
            this.#tooltips.hideKind('hover')
            return
        }
        const annotation = (this.#editorMode === EDITOR_MODE.Selecting) ? this.#annotationTooltipText(object) : ''
        if (annotation === '' && hoverHtml === '') {
            this.#tooltips.show('hover', hoverText)
        } else {
            const note = annotation ? `<div class="tooltip-annotation">${escapeHtml(annotation)}</div>` : ''
            const body = hoverHtml || `<div>${escapeHtml(hoverText)}</div>`
            this.#tooltips.show('hover', `${note}${body}`, '', true)
        }
    }

    #domToSvgCoords(domCoords: PointLike): DOMPoint {
        return this.#celldlDiagram!.domToSvgCoords(domCoords)
    }

    #highlightAssociatedObjects(object: CellDLObject, highlight: boolean) {
        for (const obj of this.#celldlDiagram!.associatedObjects(object)) {
            obj.highlight(highlight)
        }
    }

    #activateObject(object: CellDLObject, active: boolean) {
        object.activate(active)
        this.#highlightAssociatedObjects(object, active)
    }

    #setActiveObjects(activeObjects: CellDLObject[]) {
        for (const activeObject of activeObjects) {
            if (!this.#activeObjects.has(activeObject.id)) {
                activeObject.drawControlHandles()
                this.#activateObject(activeObject, true)
                this.#activeObjects.set(activeObject.id, activeObject)
            }
        }
    }

    #unsetActiveObjects() {
        for (const activeObject of this.#activeObjects.values()) {
            activeObject.clearControlHandles()
            this.#activateObject(activeObject, false)
        }
        this.#activeObjects.clear()
        this.currentObject = null
        this.#setActiveEventObject(null)
    }

    // Used by selection box and diagram undo/redo code
    selectObject(selectedObject: CellDLObject, select: boolean=true) {
        if (select) {
            this.setSelectedObject(selectedObject)
        } else {
            this.#unsetSelectedObject(selectedObject)
        }
    }

    protected setSelectedObject(selectedObject: CellDLObject) {
        if (this.selectionSet.select(selectedObject)) {
            this.enableContextMenuItem(CONTEXT_MENU.DELETE, true)
            this.enableContextMenuItem(CONTEXT_MENU.INFO, true)
        }
    }

    #unsetSelectedObject(selectedObject: CellDLObject|null) {
        if (selectedObject && this.selectionSet.unselect(selectedObject)) {
            this.enableContextMenuItem(CONTEXT_MENU.DELETE, false)
            this.enableContextMenuItem(CONTEXT_MENU.INFO, false)
        }
    }

    protected unsetSelectedObjects() {
        for (const selectedObject of this.selectionSet.objects || []) {
            this.#unsetSelectedObject(selectedObject)
        }
    }

    #deleteSelectedObjects() {
        if (this.selectionSet.size === 0) {
            return
        }
        this.#unsetActiveObjects()
        this.selectionSet.deleteObjects()
        if (this.#boxMaker) {
            this.#boxMaker.close()
            this.#boxMaker = null
        }
        this.#showStatus(null)
    }

    setPropertiesPanelObject(celldlObject: CellDLObject|undefined) {
        for (const panel of this.#panels.values()) {
            panel.setObjectProperties(celldlObject)
        }
    }

    #componentTemplateDragEvent(_event: Event) {
        this.#dragging = true
    }

    #appDragOverEvent(event: DragEvent) {
        if (this.#dragging && event.dataTransfer) {
            event.preventDefault() // Needed to allow drop
            event.dataTransfer.dropEffect = 'copy'
        }
    }

    #componentTemplateSelectedEvent(event: Event) {
        // A component's template has been selected in a tool

        this.#currentTemplateDetails = (<CustomEvent>event).detail
        this.#changeMode(EDITOR_MODE.AddingComponent)
    }

    #connectionStyleEvent(event: Event) {
        // A connection style has been selected in a tool

        this.#drawConnectionSettings.style = (<CustomEvent>event).detail.style
        this.#changeMode(EDITOR_MODE.PathDrawing)
    }

    #celldlDrawingEvent(event: Event) {
        // A drawing tool has been selected

        const tool = (<CustomEvent>event).detail.tool
        if (tool === 'draw-closed-compartment') { // draw-background-region
            this.#changeMode(EDITOR_MODE.DrawCompartment)
        }

    }

    protected addComponentTemplate(eventPosition: PointLike, details: TemplateEventDetails, dragged=false) {
        if (details.entryId) {
            // A palette entry is centred where it's dropped or clicked, with its defaults
            void this.addPaletteEntry(details.entryId, this.#domToSvgCoords(eventPosition))
            return
        }
        // Adjust position by offset at component selection
        const zoomScale = this.#panzoom?.scale || 1
        let topLeft = PointMath.subtract(eventPosition, PointMath.scalarScale(details.centre, zoomScale))
        if (dragged) {
            topLeft = topLeft.subtract(PointMath.scalarScale(details.offset, zoomScale))
        }
        const template = componentLibraryPlugin.getObjectTemplateById(details.id)
        if (!template) {
            console.error(`Drop of unknown component template '${details.id}'`)
            return
        }
        const componentGroup = this.#editorFrame!.addSvgElementFromTemplate(template, this.#domToSvgCoords(topLeft))
        const celldlObject = this.#celldlDiagram!.addConnectedObject(componentGroup, template)
        this.#unsetActiveObjects()
        if (celldlObject) {
            // Select newly added object
            this.unsetSelectedObjects()
            this.setSelectedObject(celldlObject)
            this.#showStatus(celldlObject.celldlSvgElement?.centroid as Point, celldlObject)
        }
    }

    /**
     * Places the palette entry `entryId` (../../plugins/bondgraph/palette.ts) centred at `svgPoint`, as one undo
     * step, and selects its main element. Returns what was added, or `[]` when nothing could be.
     */
    async addPaletteEntry(entryId: string, svgPoint: PointLike): Promise<CellDLObject[]> {
        if (this.#celldlDiagram === null) {
            return []
        }
        try {
            const objects = await placeEntry(entryId, svgPoint)
            this.#unsetActiveObjects()
            const main = objects[0]
            if (main) {
                this.unsetSelectedObjects()
                this.setSelectedObject(main)
                this.#showStatus(main.celldlSvgElement?.centroid as Point, main)
            }
            return objects
        } catch (error) {
            this.showMessage(`Cannot add the element: ${(error as Error).message}`, 'error')
            return []
        }
    }

    #addCompartment() {
        if (this.#boxMaker) {
            const celldlObject = this.#boxMaker.makeCompartment()
            this.#unsetActiveObjects()
            if (celldlObject) {
                // Select newly added object
                this.unsetSelectedObjects()
                this.setSelectedObject(celldlObject)
                this.#showStatus(celldlObject.celldlSvgElement?.centroid as Point, celldlObject)
            }
        }
    }

    #appDropEvent(event: DragEvent) {
        this.#dragging = false
        event.preventDefault();
        if (event.dataTransfer) {
            const itemList = event.dataTransfer!.items
            for (let index = 0; index < itemList.length; ++index) {
                const item = itemList[index]!
                if (item.kind === "string" && item.type.match("^text/plain")) {
                    item.getAsString((s: string) => {
                        this.addComponentTemplate(event, JSON.parse(s), true)
                    })
                }
            }
        }
    }

    #objectClickEvent(event: Event) {
        if (this.#clickDoneOnPointerUp) {
            this.#clickDoneOnPointerUp = false
            return
        }
        if (this.#editorMode === EDITOR_MODE.Selecting) {
            const detail = (<CustomEvent>event).detail
            const clickedObject: CellDLObject = detail.clickedObject
            this.#selectionClickEvent(detail.event, clickedObject.svgElement!, clickedObject)
        }
    }

    addPointerEventHandler(handlerId: string, handler: PointerEventHandler) {
        this.#pointerEventHandlers.set(handlerId, handler)
    }

    removePointerEventHandler(handlerId: string) {
        if (this.#pointerEventHandlers.has(handlerId)) {
            this.#pointerEventHandlers.delete(handlerId)
        }
    }

    #handlePointerEvents(event: PointerEvent|MouseEvent): boolean {
        for (const handler of this.#pointerEventHandlers.values()) {
            if (handler(event.type, event.target as SVGGraphicsElement, this.#domToSvgCoords(event))) {
                return true
            }
        }
        return false
    }

    #pointerClickEvent(event: MouseEvent) {
        const startedHere = this.#pointerDownInContainer
        this.#pointerDownInContainer = false
        if (this.#clickDoneOnPointerUp) {
            this.#clickDoneOnPointerUp = false
            return
        }
        if (!startedHere || this.#handlePointerEvents(event)) {
            return
        }
        const element = event.target as SVGGraphicsElement
        if (
            this.#celldlDiagram === null ||
            !this.#svgDiagram?.contains(element) ||
            // clickTolerance = 1px ? to set pointerMoved?
            (this.pointerMoved && Date.now() - this.#pointerDownTime > MAX_POINTER_CLICK_TIME) ||
            // Drawing, resizing or moving a selection box, however quickly, is not a click
            (this.#boxMaker && this.#pointerDragged(event))
        ) {
            return
        }
        const clickedObject = this.#celldlDiagram.objectById(getElementId(element))
        if (this.#editorMode === EDITOR_MODE.AddingComponent && clickedObject === null) {
            if (this.#currentTemplateDetails) {
                this.addComponentTemplate(event, this.#currentTemplateDetails)
            }
        } else if (this.#editorMode === EDITOR_MODE.PathDrawing) {
            if (this.#pathMaker) {
                if (this.currentObject === null) {
                    const svgPoint = this.#domToSvgCoords(event)
                    this.#pathMaker.addPoint(svgPoint, event.shiftKey)
                }
            }
        } else if (this.#editorMode === EDITOR_MODE.Selecting) {
            this.#selectingClick(event, element, clickedObject)
        }
    }

    #selectingClick(event: MouseEvent, element: SVGGraphicsElement, clickedObject: CellDLObject|null) {
        // Report unselections once the click's selection changes are complete
        this.#selectionClicking = true
        try {
            this.#selectionClickEvent(event, element, clickedObject)
        } finally {
            this.#selectionClicking = false
        }
        this.#emitUnselectEvents()
        if (clickedObject && this.selectionSet.has(clickedObject) && !this.#pointerDragged(event)) {
            this.#selectedEventObjects.set(clickedObject.id, clickedObject)
            this.#emitViewerEvent('select', clickedObject)
        }
    }

    /** The diagram object an element belongs to, including a bond's control handle. */
    #objectAt(element: SVGGraphicsElement): CellDLObject|null {
        const object = this.#celldlDiagram?.objectById(getElementId(element)) ?? null
        if (object === null && element.classList?.contains('control-point')
         && this.currentObject?.isConnection) {
            return this.currentObject
        }
        return object
    }

    #pointerDragged(event: MouseEvent): boolean {
        return (
            Math.abs(event.clientX - this.#pointerDownPosn.x) > MAX_POINTER_CLICK_DISTANCE ||
            Math.abs(event.clientY - this.#pointerDownPosn.y) > MAX_POINTER_CLICK_DISTANCE
        )
    }

    #selectionClickEvent(event: MouseEvent, _element: SVGGraphicsElement, clickedObject: CellDLObject|null) {
        if (clickedObject === null
         || !event.metaKey
         || !this.selectionSet.firstMoveableObject
         || !clickedObject.isMoveable
        ) {
            // Forget all selected objects
            this.selectionSet.clear(!event.shiftKey)
        }
        // Select when active object is clicked
        if (clickedObject && clickedObject === this.currentObject) {
            if (event.metaKey) {
                if (clickedObject.selected) {
                    this.#unsetSelectedObject(clickedObject)
                } else {
                    this.setSelectedObject(clickedObject)
                }
            } else {
                if (event.shiftKey
                 && clickedObject.isMoveable
                 && this.selectionSet.firstMoveableObject
                 && clickedObject !== this.selectionSet.firstMoveableObject) {
                    const boundingBox = this.selectionSet.firstMoveableObject?.celldlSvgElement?.svgBounds().union(clickedObject.celldlSvgElement!.svgBounds())
                    if (boundingBox) {
                        const selectedObjects = this.celldlDiagram!.objectsContainedIn(boundingBox)
                                                                    .filter(c => c.exact)
                                                                    .map(c => c.object)
                                                                    .filter(c => c.isComponent)
                        for (const selectedObject of selectedObjects) {
                            this.setSelectedObject(selectedObject)
                        }
                    }
                } else {
                    this.setSelectedObject(clickedObject)
                }
            }
        }
    }

    #pointerDoubleClickEvent(event: MouseEvent) {
        if (this.#editorMode === EDITOR_MODE.PathDrawing) {
            if (this.#pathMaker) {
                if (this.currentObject === null) {
                    this.#pathMaker.finishPartialPath(this.#celldlDiagram!, event.shiftKey)
                    this.#pathMaker = null
                }
            } else {
                this.#nextPathNode = PathMaker.startPartialPath(this.#domToSvgCoords(event), this.#celldlDiagram!)
                if (this.#nextPathNode != null) {
                    const settings = this.#drawConnectionSettings // settings.type is to come from object's domain...
                    this.#pathMaker = new PathMaker(this.#editorFrame!, this.#nextPathNode, settings.style)
                }
            }
        }
    }

    #notDiagramElement(element: SVGGraphicsElement) {
        return (
            element === this.#svgDiagram ||
            element.id === SVG_PANEL_ID ||
            element.classList.contains(EDITOR_GRID_CLASS) ||
            !this.#svgDiagram?.contains(element)
        )
    }

    #pointerOverEvent(event: PointerEvent) {
        if (this.#bondDrag.pointerOver(event)) {
            // Over the bond handle, or drawing a bond, so no element's tooltip
            this.#tooltips.cancelHover()
            return
        }
        if (this.#celldlDiagram === null || this.#handlePointerEvents(event)) {
            return
        }
        const element = event.target as SVGGraphicsElement
        const currentObject = this.#celldlDiagram.objectById(getElementId(element))
        if (this.moving) {
            // A move finishes with pointer up
            return
        } else if (this.#notDiagramElement(element)) {
            this.#tooltips.clear()
            if (this.currentObject && currentObject !== this.currentObject) {
                this.#unsetActiveObjects()
            }
            return
        } else if (this.#boxMaker?.pointerEvent(event, this.#domToSvgCoords(event))) {
            return
        }

        if (this.#editorMode === EDITOR_MODE.PathDrawing) {
            if (
                this.currentObject &&
                currentObject !== this.currentObject &&
                (currentObject !== null || (this.#pathMaker && element !== this.#pathMaker.currentSvgPath))
            ) {
                this.#unsetActiveObjects()
            }
            if (currentObject) {
                element.style.removeProperty('cursor')
                this.currentObject = currentObject
                // Set object active regardless of whether it's valid for the path
                if (this.#pathMaker === null) {
                    this.#nextPathNode = PathMaker.validStartObject(currentObject)
                } else {
                    this.#nextPathNode = this.#pathMaker.validPathNode(currentObject)
                }
                if (this.#nextPathNode) {
                    this.#setActiveObjects([currentObject])
                }
            }
        } else if (this.#editorMode === EDITOR_MODE.DrawCompartment) {
            if (currentObject) {
                element.style.removeProperty('cursor')
            }
        } else {
            if (!currentObject || !this.#activeObjects.has(currentObject.id)) {
                this.#unsetActiveObjects()
            }
            if (currentObject) {
                if (this.selectionSet.has(currentObject)) {
                    this.#setActiveObjects(this.selectionSet.objects)
                } else {
                    this.#setActiveObjects([currentObject])
                }
                currentObject.initialiseMove(element)  // will set moveable
                this.currentObject = currentObject
                if (this.#editorMode === EDITOR_MODE.Selecting) {
                    this.#setActiveEventObject(currentObject)
                }
                if (event.buttons === 0) {
                    this.#hoverTooltipAfterDelay(currentObject)
                } else {
                    this.#tooltips.cancelHover()
                }
            } else {
                this.#tooltips.cancelHover()
            }
        }
    }

    #pointerOutEvent(event: PointerEvent) {
        const element = event.target as SVGGraphicsElement
        if (
            element === this.#svgDiagram ||
            element.classList.contains(EDITOR_GRID_CLASS) ||
            !this.#svgDiagram?.contains(element)
        ) {
            if (this.currentObject && !this.moving) {
                this.currentObject.finaliseMove()
                this.#unsetActiveObjects()
            }
        } else if (this.#editorMode === EDITOR_MODE.PathDrawing) {
            if (this.#pathMaker === null) {
                this.#unsetActiveObjects()
            }
        }
        // Leaving the editor straight from a component makes it inactive
        if (!this.#container?.contains(event.relatedTarget as Node | null)) {
            this.#setActiveEventObject(null)
            this.#tooltips.cancelHover()
        }
    }

    #pointerDownEvent(event: PointerEvent) {
        if (this.#bondDrag.pointerDown(event)) {
            this.#tooltips.cancelHover()
            return
        }
        this.#pointerDownInContainer = true
        this.#clickDoneOnPointerUp = false
        this.#pointerDownPosn = { x: event.clientX, y: event.clientY }
        this.#tooltips.cancelHover()
        if (this.#handlePointerEvents(event)) {
            return
        }
        this.pointerMoved = false
        this.#pointerDownTime = Date.now()
        this.#pointerHeld = true
        this.#lastSvgPoint = this.#domToSvgCoords(event)
        const element = event.target as SVGGraphicsElement
        if (event.button === 2
         || (!event.shiftKey
          && this.#editorMode !== EDITOR_MODE.DrawCompartment
          && this.#notDiagramElement(element))) {
            this.#svgDiagram?.style.removeProperty('cursor')
            this.#container?.style.setProperty('cursor', 'grab')
            this.#panzoom!.pointerDown(event)
            this.#panning = true
            return
        }
        const svgPoint = this.#domToSvgCoords(event)
        if (this.#editorMode === EDITOR_MODE.PathDrawing) {
            if (this.currentObject && this.#nextPathNode) {
                if (this.#pathMaker === null) {
                    const settings = this.#drawConnectionSettings // settings.type is to come from object's domain...
                    this.#pathMaker = new PathMaker(this.#editorFrame!, this.#nextPathNode, settings.style)
                } else if (!this.#pathMaker.empty) {
                    if (this.currentObject.isConduit) {
                        this.#pathMaker.addIntermediate(this.#nextPathNode, event.shiftKey)
                    } else {
                        this.#pathMaker.finishPath(this.#nextPathNode, this.#celldlDiagram!, event.shiftKey)
                        this.#pathMaker = null
                    }
                }
            }
        } else if (this.currentObject?.moveInitialised) {
            // EDITOR_MODE.Selecting or EDITOR_MODE.AddingComponent
            this.#moveSelection = !this.currentObject?.isConnection && this.selectionSet.has(this.currentObject)
            if (this.#moveSelection) {
                // Moving a set of selected components
                this.#moveUndoState = undoRedo.setMoveUndoState(this.currentObject, svgPoint, this.selectionSet)
                this.selectionSet.startMove(svgPoint, this.currentObject)
            } else {
                // Either moving a control point or an active component
                this.#moveUndoState = undoRedo.setMoveUndoState(this.currentObject, svgPoint)
                this.currentObject.startMove(svgPoint)
            }
            this.moving = true
            this.moved = false
        } else if (this.#editorMode === EDITOR_MODE.Selecting) {
            if (this.#boxMaker) {
                // Dragging inside a selection box moves what it selects, or with shift, just the box
                if (event.shiftKey || !this.#boxMaker.isInterior(event) || !this.#startBoxContentsMove(svgPoint)) {
                    this.#boxMaker.pointerEvent(event, svgPoint)
                }
            } else if (event.shiftKey) {
                this.unsetSelectedObjects()
                this.#boxMaker = new BoxMaker(this, svgPoint)
                this.#boxMaking = true
            } else if (this.currentObject?.isConnection) {
                // Check if a linear path and if so, insert a control point and initialise moving it
                this.#moveUndoState = undoRedo.setMoveUndoState(this.currentObject, svgPoint)
                const controlElement = this.currentObject.addControlHandle(svgPoint)
                if (controlElement) {
                    this.currentObject.initialiseMove(controlElement)
                    // this.#activateObject(this.currentObject, true) // should already be active, incl. new handle
                    this.currentObject.startMove(svgPoint)
                    this.moving = true
                    this.moved = false
                }
            }
        } else if (this.#editorMode === EDITOR_MODE.DrawCompartment) {
            if (this.#boxMaker) {
                this.#boxMaker.pointerEvent(event, svgPoint)
            } else {
                this.unsetSelectedObjects()
                this.#boxMaker = new BoxMaker(this, svgPoint, true)
                this.#boxMaking = true
            }
        }
    }

    #startBoxContentsMove(svgPoint: DOMPoint): boolean {
        const movedObject = this.selectionSet.objects.find(object => object.isMoveable)
        if (!movedObject) {
            return false
        }
        this.#moveSelection = true
        this.#movingBoxContents = true
        this.#moveUndoState = undoRedo.setMoveUndoState(movedObject, svgPoint, this.selectionSet)
        this.selectionSet.startMove(svgPoint, movedObject)
        this.#boxMaker?.startMove(movedObject)
        this.currentObject = movedObject
        this.moving = true
        this.moved = false
        return true
    }

    #pointerMoveEvent(event: PointerEvent) {
        if (this.#bondDrag.pointerMove(event)) {
            return
        }
        if (this.#handlePointerEvents(event)) {
            return
        }
        if (this.#pointerHeld && event.buttons === 0) {
            // The button was released where we didn't see it, such as outside the window, so the drag
            // ended where the pointer last was in the canvas
            this.#endDragElsewhere(event)
        }
        if (this.#panning) {
            this.pointerMoved = this.#panzoom!.pointerMove(event) || this.pointerMoved
            return
        }
        this.pointerMoved = true
        const svgPoint = this.#domToSvgCoords(event)
        if (this.#pointerHeld) {
            this.#lastSvgPoint = svgPoint
        }
        this.#showStatus(svgPoint)
        if (this.#editorMode === EDITOR_MODE.PathDrawing) {
            if (this.#pathMaker) {
                this.#pathMaker.drawTo(svgPoint, event.shiftKey)
            }
        } else if (this.currentObject && this.moving) {
            // EDITOR_MODE.Selecting or EDITOR_MODE.AddingComponent
            if (!this.moved && !this.#pointerDragged(event)) {
                // Still a click: a pointer that shakes a little mustn't move (and snap) what it clicks
                return
            }
            if (this.#moveSelection) {
                this.selectionSet.move(svgPoint)
            } else {
                this.currentObject.move(svgPoint)
                this.#celldlDiagram?.objectMoved(this.currentObject)
            }
            this.moved = true
            if (this.#movingBoxContents) {
                this.#boxMaker?.followMove()
            } else if (this.#boxMaker) {
                this.#boxMaker.updateSelectedObjects()
            }
        } else if (this.#editorMode === EDITOR_MODE.Selecting
                || this.#editorMode === EDITOR_MODE.DrawCompartment) {
            if (this.#boxMaker) {
                this.#boxMaker.pointerEvent(event, svgPoint)
            }
        }
    }

    #pointerUpEvent(event: PointerEvent) {
        this.#pointerHeld = false
        if (this.#bondDrag.pointerUp(event)) {
            return
        }
        if (this.#celldlDiagram === null || this.#handlePointerEvents(event)) {
            return
        }
        this.#endDrag(event, this.#domToSvgCoords(event))
    }

    /**
     * A release outside the canvas, which the canvas doesn't see, or a cancelled pointer, ends a drag
     * as a release in the canvas would, where the pointer last was in it.
     */
    #documentPointerUpEvent(event: PointerEvent) {
        if (event.type === 'pointerup' && this.#container?.contains(event.target as Node|null)) {
            return
        }
        this.#endDragElsewhere(event)
    }

    #endDragElsewhere(event: PointerEvent|null) {
        if (!this.#pointerHeld || this.#celldlDiagram === null) {
            return
        }
        const upEvent = new PointerEvent('pointerup', {
            clientX: event?.clientX ?? 0,
            clientY: event?.clientY ?? 0,
            pointerId: event?.pointerId ?? 1,
            pointerType: event?.pointerType ?? 'mouse'
        })
        const svgPoint = this.#lastSvgPoint ?? this.#domToSvgCoords(upEvent)
        const moved = this.moving && this.moved
        this.#endDrag(upEvent, svgPoint)
        if (moved) {
            // A host waiting for the release to read the diagram may not see one
            notifyChanges()
        }
    }

    /** Ends a move, pan or selection box at `svgPoint`, as the pointer is released there */
    #endDrag(event: PointerEvent, svgPoint: DOMPoint) {
        this.#pointerHeld = false
        this.#lastSvgPoint = null
        if (this.#panning) {
            this.#panzoom!.pointerUp(event)
            this.#panning = false
            this.#setDefaultCursor()
            if (
                !this.pointerMoved &&
                !this.#boxMaking &&
// WIP                !this.#contextMenu.isOpen &&
                this.#boxMaker &&
                !this.#boxMaker.pointInside(svgPoint)
            ) {
                this.#closeBoxMaker()
            }
            return
        }
        if (this.#editorMode !== EDITOR_MODE.PathDrawing) {
            if (this.currentObject && this.moving) {
                this.moving = false
                if (this.moved) {
                    if (this.#moveSelection) {
                        this.selectionSet.endMove()
                    } else {
                        this.currentObject.endMove()
                        this.currentObject.finaliseMove()
                    }
                    // Kept to undo only if it moved something, e.g. not if dragged back to the start
                    if (this.#moveUndoState) {
                        undoRedo.endMove(this.#moveUndoState, svgPoint)
                        this.#moveUndoState = null
                    }
                } else if (this.#moveUndoState) {
                    undoRedo.resetActiveUndoState()
                    this.#moveUndoState.reposition('backwards')
                    this.#moveUndoState = null
                    if (this.#editorMode === EDITOR_MODE.Selecting && this.currentObject.isConnection
                     && (event.target as Element|null)?.classList?.contains('control-point')) {
                        // Repositioning redraws a bond's control handles, so a click on one
                        // never arrives: select the bond now
                        this.#selectingClick(event, event.target as SVGGraphicsElement, this.currentObject)
                        this.#clickDoneOnPointerUp = true
                    }
                }
                if (this.#movingBoxContents) {
                    this.#movingBoxContents = false
                    this.currentObject = null
                }
            } else if (this.#editorMode === EDITOR_MODE.Selecting
                    || this.#editorMode === EDITOR_MODE.DrawCompartment) {
                if (this.#boxMaker) {
                    if (this.#editorMode === EDITOR_MODE.DrawCompartment) {
                        this.#boxMaker.pointerEvent(event, svgPoint)
                        this.#addCompartment()
                        this.#closeBoxMaker()
                    } else if (!this.#boxMaker.pointerEvent(event, svgPoint)) {
                        this.#closeBoxMaker()
                    }
                }
                this.#boxMaking = false
            }
        }
    }

    #closeBoxMaker() {
        if (this.#boxMaker) {
            this.#boxMaker.close()
            this.#boxMaker = null
        }
    }

    #keyDownCaptureEvent(event: KeyboardEvent) {
        this.#popupOpenAtKeyDown = event.key === 'Escape' && popupOpen()
    }

    #keyDownEvent(event: KeyboardEvent) {
        if (this.#celldlDiagram === null || event.defaultPrevented || this.#focusElsewhere(event.target)) {
            return
        }
        // Keys in a text field are the field's, wherever it is
        const inTextField = isTextField(event.target)
        if (isMacOs() ? event.metaKey : event.ctrlKey) {
            const key = event.key.toLowerCase()
            if (!inTextField && !event.altKey && (key === 'z' || key === 'y')) {
                event.preventDefault()
                if (key === 'z' && !event.shiftKey) {
                    this.undo()
                } else {
                    this.redo()
                }
            }
        } else if (event.key === 'Escape') {
            this.#escapeKey()
        } else if (!inTextField && !event.altKey && this.#zoomKey(event)) {
            event.preventDefault()
        } else if (event.key === 'Backspace' || event.key === 'Delete') {
            if (!inTextField) {
                // Backspace would otherwise navigate back
                event.preventDefault()
                if (!this.#cancelPartialPath()) {
                    this.#deleteSelectedObjects()
                }
            }
        }
    }

    /**
     * Whether a key went to something focused outside the editor, such as a host's table or button, whose keys
     * aren't the editor's. The canvas takes no focus, so its keys go to the body.
     */
    #focusElsewhere(target: EventTarget|null): boolean {
        if (!(target instanceof Element) || target === document.body || target === document.documentElement) {
            return false
        }
        const root = this.#container?.closest('.celldl-editor') ?? this.#container
        return !root?.contains(target)
    }

    /** Escape closes just the innermost thing open: a popup, a partial bond, a selection box, then the armed tool. */
    #escapeKey() {
        if (this.#popupOpenAtKeyDown) {
            return
        }
        if (this.#cancelMove()) {
            return
        } else if (toolPopoverOpen()) {
            document.dispatchEvent(new CustomEvent('close-tool-popover'))
        } else if (this.#cancelPartialPath()) {
            return
        } else if (this.#boxMaker) {
            this.#closeBoxMaker()
        } else if (this.#editorMode !== EDITOR_MODE.Selecting) {
            this.#changeMode(EDITOR_MODE.Selecting)
            // Show the Selection tool as the toolbar's active one
            document.dispatchEvent(new CustomEvent('editor-reset-tools'))
        }
    }

    /**
     * Cancels a move being dragged, putting what was moved, and its bonds, back where they were
     * and recording nothing to undo. The pointer's release then does nothing.
     *
     * @returns Whether a move was being dragged.
     */
    #cancelMove(): boolean {
        if (!this.moving || !this.currentObject) {
            return false
        }
        this.moving = false
        this.#pointerHeld = false
        const moved = this.moved
        if (moved) {
            this.#moveUndoState?.endMove(this.#lastSvgPoint ?? undefined)
            if (this.#moveSelection) {
                this.selectionSet.endMove()
            } else {
                this.currentObject.endMove()
                this.currentObject.finaliseMove()
            }
        }
        this.#lastSvgPoint = null
        if (this.#moveUndoState) {
            undoRedo.resetActiveUndoState()
            this.#moveUndoState.reposition('backwards')
            this.#moveUndoState = null
        }
        if (this.#movingBoxContents) {
            this.#boxMaker?.followMove()
            this.#movingBoxContents = false
            this.currentObject = null
        }
        if (moved) {
            notifyChanges()
        }
        return true
    }

    #keyUpEvent(event: KeyboardEvent) {
        if (event.key === 'Shift') {
            this.#setDefaultCursor()
        }
    }

    //==========================================================================

    // Zooming, which never happens on its own

    /** Zooms in by a step, about the view's centre */
    zoomIn() {
        this.#panzoom?.zoomBy(ZOOM_STEP)
    }

    /** Zooms out by a step, about the view's centre */
    zoomOut() {
        this.#panzoom?.zoomBy(1 / ZOOM_STEP)
    }

    /** Zooms and pans so that every component is in view, zooming in no further than `maxScale` */
    zoomToFit(maxScale?: number) {
        this.#panzoom?.zoomToFit(this.#contentBounds(), undefined, maxScale)
    }

    /**
     * Zooms to a scale, with a point (in SVG coordinates) at the centre of the view:
     * by default the components' centre, or, with none, the view's.
     */
    zoomTo(scale: number, centre: PointLike|null = null) {
        const bounds = this.#contentBounds()
        this.#panzoom?.zoomTo(scale, centre ?? (bounds ? { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 } : null))
    }

    /** The view's scale, screen pixels per SVG unit */
    get zoomScale(): number {
        return this.#panzoom?.scale ?? 1
    }

    /** The view, and where the components are, in SVG coordinates */
    get viewState(): ViewInfo {
        const bounds = this.#contentBounds()
        const centre = this.#panzoom?.centre ?? { x: 0, y: 0 }
        return {
            scale: this.zoomScale,
            centre: { x: centre.x, y: centre.y },
            fitScale: this.#panzoom?.fitScale(bounds) ?? null,
            bounds: bounds ? { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom } : null
        }
    }

    #contentBounds(): Bounds|null {
        let bounds: Bounds|null = null
        for (const object of this.#celldlDiagram?.objects ?? []) {
            const objectBounds = object.isConnection ? null : object.celldlSvgElement?.svgBounds()
            if (objectBounds) {
                bounds = bounds ? bounds.union(objectBounds) : objectBounds
            }
        }
        return bounds
    }

    /**
     * `+` or `=` zooms in, `-` out, and Shift+1 fits the diagram. Not with Ctrl or Cmd, which zoom the
     * browser, nor while the editor is hidden, such as parked inert by a host.
     */
    #zoomKey(event: KeyboardEvent): boolean {
        if (event.ctrlKey || event.metaKey || this.#hidden()) {
            return false
        }
        if (event.key === '+' || event.key === '=') {
            this.zoomIn()
        } else if (event.key === '-' || event.key === '_') {
            this.zoomOut()
        } else if (event.shiftKey && (event.code === 'Digit1' || event.key === '!')) {
            this.zoomToFit()
        } else {
            return false
        }
        return true
    }

    /** Whether the canvas can't be seen: not laid out, or inside an inert element */
    #hidden(): boolean {
        const container = this.#container
        return !container || container.getClientRects().length === 0 || container.closest('[inert]') !== null
    }

    //==========================================================================

    // Aligning and distributing the selection

    /** The selected components that aligning moves: not connections, nor compartments, which move their contents */
    #arrangeableObjects(): CellDLObject[] {
        return this.selectionSet.objects.filter(object => object.isMoveable && !object.isConnection
                                                       && !object.isCompartment && object.celldlSvgElement)
    }

    /** Whether there are enough selected components to arrange */
    canArrange(op: ArrangeOp): boolean {
        return this.#arrangeableObjects().length >= minimumForArrange(op)
    }

    /**
     * Aligns or distributes the selected components, as one undoable step.
     * Their bonds follow them. Nothing snaps to the grid.
     *
     * @returns Whether anything moved.
     */
    arrangeSelection(op: ArrangeOp): boolean {
        // Not while dragging, nor while a bond is being drawn, whose path would lose its ends
        if (this.#celldlDiagram === null || this.moving || this.#pathMaker !== null || this.#bondDrag.active) {
            return false
        }
        const objects = this.#arrangeableObjects()
        const bounds: ArrangeBounds[] = objects.map(object => {
            const b = object.celldlSvgElement!.svgBounds()
            return { left: b.left, top: b.top, right: b.right, bottom: b.bottom }
        })
        const deltas = arrangeTargets(bounds, op)
        const moving = objects.map((object, i) => ({ object, delta: deltas[i]! }))
                              .filter(({ delta }) => Math.abs(delta.dx) > 1e-6 || Math.abs(delta.dy) > 1e-6)
        if (moving.length === 0) {
            return false
        }
        const moveOptions = { noAlign: true }
        undoRedo.beginGroup()
        for (const { object, delta } of moving) {
            const centroid = object.celldlSvgElement!.centroid
            const target = { x: centroid.x + delta.dx, y: centroid.y + delta.dy }
            const undoState = undoRedo.setMoveUndoState(object, centroid)
            undoState.moveOptions = moveOptions
            object.reposition(centroid, target, moveOptions)
            this.#celldlDiagram.objectMoved(object)
            object.finaliseMove()
            undoState.endMove(target)
        }
        undoRedo.endGroup()
        this.setDirty()
        notifyChanges()
        return true
    }

    /* WIP
    #showSelectedObjectInfo() {
        if (this.#selectedObject) {
            //console.log('INFO:', this.#selectedObject.asString())
        }
    } */
}

//==============================================================================
//==============================================================================
