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

// Compartments and regions: drawn boxes round elements. What lies wholly inside one is its contents, by position
// alone, so nesting is one box drawn inside another. A box moves with its contents, and a selected box is resized by
// its handles; placing, resizing, moving and deleting are each one undo step.

import type { CellDLCompartment, CellDLConnection, CellDLObject } from '#editor/celldlObjects'
import type { CellDLDiagram } from '#editor/diagram'
import type { MoveGroup, SelectionSet } from '#editor/diagram/selectionset'
import { undoRedo } from '#editor/diagram/undoredo'
import { Bounds } from '#editor/geometry'
import { type Box, compartmentBox, setCompartmentBox } from '#editor/SVGElements/utils/compartment'

import {
    DEFAULT_SPATIAL_SIZE,
    MIN_SPATIAL_SIZE,
    SPATIAL_STYLES,
    type SpatialKind
} from '#root/plugins/drawing/spatial'
import type { PointLike } from '#root/utils/points'
import { svgRect } from '#root/utils/svgUtils'

import { editGuides } from './editguides'
import type { EditorFrame } from './editorframe'

//==============================================================================

function boxBounds(box: Box): Bounds {
    return new Bounds(box.x, box.y, box.x + box.width, box.y + box.height)
}

/** A compartment's box, in the diagram's coordinates */
export function boxOf(compartment: CellDLObject): Box {
    return compartmentBox(compartment.svgElement as SVGGElement)
}

/** The diagram's objects wholly inside a compartment's box, nested compartments and their contents included */
export function compartmentContents(diagram: CellDLDiagram, compartment: CellDLObject): CellDLObject[] {
    return diagram.objectsContainedIn(boxBounds(boxOf(compartment)))
                  .filter(c => c.exact && c.object !== compartment && !c.object.isConnection && c.object.isMoveable)
                  .map(c => c.object)
}

/**
 * What moving `movedObject` moves, when that includes a compartment: the selection (or just the object, if it isn't
 * selected), what is inside each compartment in it, and the bonds between them. `undefined` when no compartment moves.
 */
export function compartmentMoveGroup(diagram: CellDLDiagram, movedObject: CellDLObject,
                                     selectionSet: SelectionSet): MoveGroup|undefined {
    const selected = selectionSet.has(movedObject)
    const moved = selected ? selectionSet.objects : [movedObject]
    if (!moved.some(object => object.isCompartment)) {
        return undefined
    }
    const objects: Map<string, CellDLObject> = new Map(moved.map(object => [object.id, object]))
    for (const compartment of moved.filter(object => object.isCompartment)) {
        for (const object of compartmentContents(diagram, compartment)) {
            objects.set(object.id, object)
        }
    }
    const connections: Map<string, CellDLConnection> = new Map(
        selected ? selectionSet.moveGroup.connections.map(connection => [connection.id, connection]) : []
    )
    for (const object of objects.values()) {
        for (const connection of object.connections) {
            if (connection.connectedObjects.every(end => objects.has(end.id))) {
                connections.set(connection.id, connection)
            }
        }
    }
    // The moved object first, as a selection moves the others by it
    return {
        objects: [movedObject, ...[...objects.values()].filter(object => object !== movedObject)],
        connections: [...connections.values()]
    }
}

//==============================================================================

/**
 * Adds a compartment or region drawn as `bounds`, as one undo step. A box smaller than `MIN_SPATIAL_SIZE` either way,
 * as a click makes, is placed at its default size, centred on it.
 */
export function placeSpatial(diagram: CellDLDiagram, kind: SpatialKind, bounds: Bounds): CellDLCompartment {
    let drawn = bounds
    if (bounds.width < MIN_SPATIAL_SIZE || bounds.height < MIN_SPATIAL_SIZE) {
        const centre = { x: (bounds.left + bounds.right)/2, y: (bounds.top + bounds.bottom)/2 }
        drawn = defaultBounds(centre)
    }
    const style = SPATIAL_STYLES[kind]
    return diagram.makeCompartment(drawn, {
        cornerRadius: style.cornerRadius,
        fill: [style.fill],
        strokeColour: style.strokeColour,
        strokeDashed: style.strokeDashed,
        strokeGap: style.strokeGap,
        strokeWidth: style.strokeWidth
    })
}

/** A default sized box centred at `centre`, on the grid */
export function defaultBounds(centre: PointLike): Bounds {
    const topLeft = editGuides.gridAlign({
        x: centre.x - DEFAULT_SPATIAL_SIZE.width/2,
        y: centre.y - DEFAULT_SPATIAL_SIZE.height/2
    })
    return new Bounds(topLeft.x, topLeft.y, topLeft.x + DEFAULT_SPATIAL_SIZE.width, topLeft.y + DEFAULT_SPATIAL_SIZE.height)
}

//==============================================================================

/** Redraws a compartment as `box`, keeping it selected if it was, and reports the change */
export function resizeCompartment(compartment: CellDLCompartment, box: Box) {
    const svgElement = compartment.svgElement as SVGGElement|null
    if (!svgElement) {
        return
    }
    const selected = !!compartment.selected
    setCompartmentBox(svgElement, box)
    // Its selection rectangle, bounds and label's place are those of the old box, so make them again
    for (const child of [...svgElement.children]) {
        if (child.classList.contains('editor-specific')) {
            child.remove()
        }
    }
    compartment.assignSvgElement(svgElement, false)
    compartment.compartmentElement?.updateElement()
    if (selected) {
        compartment.select(true)
    }
    compartment.celldlDiagram.reorderCompartment(compartment)
    compartment.celldlDiagram.objectMoved(compartment)
}

function sameBox(a: Box, b: Box): boolean {
    return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

//==============================================================================

const HANDLE_CLASS = 'compartment-handle'
const HANDLE_SIZE = 10

// Clockwise from the top left corner: which of the box's edges each handle moves, and its cursor
const HANDLES: { left?: true, right?: true, top?: true, bottom?: true, cursor: string }[] = [
    { left: true, top: true, cursor: 'nwse-resize' },
    { top: true, cursor: 'ns-resize' },
    { right: true, top: true, cursor: 'nesw-resize' },
    { right: true, cursor: 'ew-resize' },
    { right: true, bottom: true, cursor: 'nwse-resize' },
    { bottom: true, cursor: 'ns-resize' },
    { left: true, bottom: true, cursor: 'nesw-resize' },
    { left: true, cursor: 'ew-resize' }
]

function handlePoints(box: Box): PointLike[] {
    const { x, y, width, height } = box
    return [
        { x, y }, { x: x + width/2, y }, { x: x + width, y }, { x: x + width, y: y + height/2 },
        { x: x + width, y: y + height }, { x: x + width/2, y: y + height }, { x, y: y + height }, { x, y: y + height/2 }
    ]
}

/** The box that dragging handle `index` to `point` makes from `box`, keeping it at least `MIN_SPATIAL_SIZE` */
export function resizedBox(box: Box, index: number, point: PointLike): Box {
    const handle = HANDLES[index]
    let left = box.x, top = box.y, right = box.x + box.width, bottom = box.y + box.height
    if (handle?.left) left = Math.min(point.x, right - MIN_SPATIAL_SIZE)
    if (handle?.right) right = Math.max(point.x, left + MIN_SPATIAL_SIZE)
    if (handle?.top) top = Math.min(point.y, bottom - MIN_SPATIAL_SIZE)
    if (handle?.bottom) bottom = Math.max(point.y, top + MIN_SPATIAL_SIZE)
    return { x: left, y: top, width: right - left, height: bottom - top }
}

type Resizing = {
    compartment: CellDLCompartment
    index: number
    startBox: Box
}

export interface CompartmentHandlesHost {
    readonly editorFrame: EditorFrame|null
    /** The compartment to show handles on: the only object selected, if it's a compartment and nothing is armed */
    readonly selectedCompartment: CellDLCompartment|null
}

/**
 * Handles on a selected compartment's corners and edges, dragged to resize it. A resize is one undo step.
 */
export class CompartmentHandles {
    #host: CompartmentHandlesHost
    #compartment: CellDLCompartment|null = null
    #handles: SVGGraphicsElement[] = []
    #resizing: Resizing|null = null
    // A press on a handle ends with a click, which isn't a selection's
    #handleClick = false
    #endResize = () => this.#finish()

    constructor(host: CompartmentHandlesHost) {
        this.#host = host
    }

    get resizing(): boolean {
        return this.#resizing !== null
    }

    /** Shows the handles on the selected compartment, where it now is, or hides them when there's none */
    refresh() {
        if (this.#resizing) {
            return
        }
        const compartment = this.#host.selectedCompartment
        if (compartment === null || !compartment.svgElement?.isConnected) {
            this.clear()
        } else {
            this.#draw(compartment)
        }
    }

    clear() {
        for (const handle of this.#handles) {
            handle.remove()
        }
        this.#handles = []
        this.#compartment = null
    }

    #draw(compartment: CellDLCompartment) {
        const frame = this.#host.editorFrame
        if (!frame) {
            return
        }
        const points = handlePoints(boxOf(compartment))
        if (this.#compartment !== compartment || !this.#handles.every(handle => handle.isConnected)) {
            this.clear()
            this.#compartment = compartment
            points.forEach((point, index) => {
                const handle = frame.addElementAsString(svgRect(
                    { x: point.x - HANDLE_SIZE/2, y: point.y - HANDLE_SIZE/2 },
                    { x: point.x + HANDLE_SIZE/2, y: point.y + HANDLE_SIZE/2 },
                    { class: HANDLE_CLASS }
                ))
                handle.dataset.handleIndex = String(index)
                // biome-ignore lint/style/noNonNullAssertion: index is in range
                handle.style.setProperty('cursor', HANDLES[index]!.cursor)
                this.#handles.push(handle)
            })
        } else {
            points.forEach((point, index) => {
                // biome-ignore lint/style/noNonNullAssertion: there's a handle for each point
                const handle = this.#handles[index]!
                handle.setAttribute('x', String(point.x - HANDLE_SIZE/2))
                handle.setAttribute('y', String(point.y - HANDLE_SIZE/2))
            })
        }
    }

    /**
     * The editor's pointer events, before it handles them: a press on a handle starts a resize, which the pointer's
     * moves follow until it's released. Returns whether the event was a resize's, and so not for the editor.
     */
    pointerEvent(type: string, target: Element|null, svgPoint: PointLike): boolean {
        if (type === 'pointerdown') {
            const index = target?.classList.contains(HANDLE_CLASS) ? Number((target as SVGElement).dataset.handleIndex) : -1
            this.#handleClick = index >= 0
            if (index < 0 || !this.#compartment) {
                return false
            }
            this.#resizing = { compartment: this.#compartment, index, startBox: boxOf(this.#compartment) }
            // A release outside the canvas ends it too
            document.addEventListener('pointerup', this.#endResize, true)
            document.addEventListener('pointercancel', this.#endResize, true)
            return true
        } else if (type === 'pointermove' && this.#resizing) {
            const { compartment, index, startBox } = this.#resizing
            const box = resizedBox(startBox, index, editGuides.gridAlign(svgPoint))
            if (!sameBox(box, boxOf(compartment))) {
                resizeCompartment(compartment, box)
                this.#draw(compartment)
            }
            return true
        } else if (type === 'pointerup' && this.#resizing) {
            this.#finish()
            return true
        } else if (type === 'click' && this.#handleClick) {
            this.#handleClick = false
            return true
        }
        return false
    }

    /** Ends a resize, keeping it as one undo step if it changed the box */
    #finish() {
        document.removeEventListener('pointerup', this.#endResize, true)
        document.removeEventListener('pointercancel', this.#endResize, true)
        const resizing = this.#resizing
        this.#resizing = null
        if (!resizing) {
            return
        }
        const { compartment, startBox } = resizing
        const endBox = boxOf(compartment)
        if (!sameBox(startBox, endBox)) {
            undoRedo.pushChange(compartment, direction => {
                resizeCompartment(compartment, direction === 'backwards' ? startBox : endBox)
                this.refresh()
            })
        }
        this.refresh()
    }
}

//==============================================================================
//==============================================================================
