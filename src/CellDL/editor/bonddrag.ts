/******************************************************************************

CellDL Editor

Copyright (c) 2022 - 2026 David Brooks

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

/**
 * Hover-to-bond: drawing a bond without a bond tool.
 *
 * Hovering an element shows a handle on its boundary. Dragging from the handle,
 * or Cmd-dragging (Ctrl-dragging off a Mac) from the element, draws a bond that
 * ends where it's released, if that's a valid target. Valid targets are marked
 * and the rest dimmed. No tooltips show while drawing; releasing on an invalid
 * target briefly says why.
 */

import type { CellDLObject } from '#editor/celldlObjects'
import { PathMaker, type PathNode } from '#editor/connections/pathmaker'
import type { CellDLDiagram } from '#editor/diagram'

import { isMacOs } from '#root/utils/common'
import type { PointLike } from '#root/utils/points'
import { SVG_URI } from '#root/utils/svgUtils'

import type { EditorFrame } from './editorframe'

//==============================================================================

export const BOND_HANDLE_CLASS = 'bond-handle'
export const BOND_TARGET_VALID_CLASS = 'bond-target-valid'
export const BOND_TARGET_DIMMED_CLASS = 'bond-target-dimmed'

const HANDLE_RADIUS = 5         // pixels
const DRAG_START_DISTANCE = 4   // pixels, as for a click

const BOND_DRAG_STYLE = `
#svg-container .${BOND_HANDLE_CLASS} {
    fill: #fff;
    stroke: #0a7;
    stroke-width: 1.5px;
    vector-effect: non-scaling-stroke;
    cursor: crosshair;
}
#svg-container .${BOND_HANDLE_CLASS}:hover {
    fill: #0a7;
}
#svg-container .${BOND_TARGET_VALID_CLASS} {
    filter: drop-shadow(0 0 3px #0a7);
}
#svg-container .${BOND_TARGET_DIMMED_CLASS} {
    opacity: 0.35;
}
`

function addStyle() {
    if (typeof document !== 'undefined' && !document.getElementById('celldl-bond-drag-style')) {
        const style = document.createElement('style')
        style.id = 'celldl-bond-drag-style'
        style.textContent = BOND_DRAG_STYLE
        document.head.appendChild(style)
    }
}

//==============================================================================

/** What `BondDrag` needs from the editor */
export interface BondDragHost {
    readonly celldlDiagram: CellDLDiagram|null
    readonly editorFrame: EditorFrame|null
    /** Whether a bond can be started now: selecting, and not moving or box selecting */
    readonly canStartBond: boolean
    /** The connection style for new bonds */
    readonly bondStyle: string
    svgPoint(event: MouseEvent): DOMPoint
    objectAt(element: SVGGraphicsElement): CellDLObject|null
    /** Stops hover tooltips showing while a bond is drawn, hiding any shown, or lets them show again */
    suppressTooltips(suppress: boolean): void
    /** Briefly shows an error at a client point, e.g. why a bond was refused */
    flashError(message: string, at: PointLike): void
    /** A click on the handle, or a modifier click, that didn't become a bond, for the editor to handle as a click */
    click(event: PointerEvent, object: CellDLObject): void
}

/** Whether a modifier for drawing a bond from an element's body is down: Cmd on a Mac, else Ctrl */
export function bondModifier(event: MouseEvent): boolean {
    return isMacOs() ? event.metaKey : event.ctrlKey
}

/** The point on a rectangle's boundary nearest to a point */
export function nearestBoundaryPoint(bounds: { left: number, top: number, right: number, bottom: number },
                                     point: PointLike): PointLike {
    const x = Math.min(Math.max(point.x, bounds.left), bounds.right)
    const y = Math.min(Math.max(point.y, bounds.top), bounds.bottom)
    if (x !== point.x || y !== point.y) {
        return { x, y }     // Outside, so already on the boundary
    }
    const distances = [
        { d: x - bounds.left, p: { x: bounds.left, y } },
        { d: bounds.right - x, p: { x: bounds.right, y } },
        { d: y - bounds.top, p: { x, y: bounds.top } },
        { d: bounds.bottom - y, p: { x, y: bounds.bottom } }
    ]
    return distances.reduce((a, b) => (b.d < a.d ? b : a)).p
}

//==============================================================================

interface PendingDrag {
    object: CellDLObject
    clientX: number
    clientY: number
}

export class BondDrag {
    #host: BondDragHost
    #handle: SVGCircleElement|null = null
    #handleObject: CellDLObject|null = null
    #pending: PendingDrag|null = null
    #pathMaker: PathMaker|null = null
    #startObject: CellDLObject|null = null
    #validTargets: Map<string, PathNode> = new Map()
    #markedObjects: CellDLObject[] = []

    constructor(host: BondDragHost) {
        this.#host = host
        addStyle()
    }

    /** Whether a bond is being drawn */
    get active(): boolean {
        return this.#pathMaker !== null
    }

    /** The ids of the objects a bond being drawn could end at */
    get validTargetIds(): string[] {
        return [...this.#validTargets.keys()]
    }

    mount(container: HTMLElement) {
        container.addEventListener('pointerleave', () => {
            if (!this.active && !this.#pending) {
                this.hideHandle()
            }
        })
    }

    //==========================================================================

    pointerOver(event: PointerEvent): boolean {
        if (this.#pathMaker) {
            // Targets are marked valid or dimmed; why one is invalid is said on release
            return true
        }
        // Over the handle, leave the element it's on active
        return this.#isHandle(event.target)
    }

    pointerDown(event: PointerEvent): boolean {
        if (this.active) {
            // The button was released outside the editor, so this press ends the bond
            this.cancel()
            return true
        }
        if (event.button !== 0 || !this.#host.canStartBond) {
            this.hideHandle()
            return false
        }
        let object: CellDLObject|null = null
        if (this.#isHandle(event.target)) {
            object = this.#handleObject
        } else if (bondModifier(event) && !event.shiftKey) {
            object = this.#bondable(this.#host.objectAt(event.target as SVGGraphicsElement))
        }
        if (object === null) {
            this.hideHandle()
            return false
        }
        // A bond starts once the pointer moves, so a modifier click is still a click
        this.#pending = { object, clientX: event.clientX, clientY: event.clientY }
        return true
    }

    pointerMove(event: PointerEvent): boolean {
        if (event.buttons === 0 && (this.#pending || this.active)) {
            // The button was released outside the editor
            this.cancel()
        }
        if (this.#pending && !this.active) {
            if (Math.abs(event.clientX - this.#pending.clientX) <= DRAG_START_DISTANCE
             && Math.abs(event.clientY - this.#pending.clientY) <= DRAG_START_DISTANCE) {
                return true
            }
            const object = this.#pending.object
            this.#pending = null
            if (!this.#start(object, { x: event.clientX, y: event.clientY })) {
                return true
            }
        }
        if (this.#pathMaker) {
            this.#pathMaker.drawTo(this.#host.svgPoint(event))
            return true
        }
        if (event.buttons === 0 && this.#host.canStartBond) {
            this.#hover(event)
        } else {
            this.hideHandle()
        }
        return false
    }

    pointerUp(event: PointerEvent): boolean {
        const pending = this.#pending
        this.#pending = null
        const pathMaker = this.#pathMaker
        const diagram = this.#host.celldlDiagram
        if (!pathMaker || !diagram) {
            if (pending) {
                // Not dragged, so a click: it selects the element
                this.#host.click(event, pending.object)
                return true
            }
            return false
        }
        const object = this.#targetObject(event)
        const node = object ? this.#validTargets.get(object.id) : undefined
        let refusal: string|null = null
        if (node) {
            // Records the new bond as one undo step
            pathMaker.finishPath(node, diagram)
            this.#pathMaker = null
        } else if (object && object !== this.#startObject) {
            refusal = pathMaker.refusal(object)
        }
        this.#finish()
        if (refusal) {
            this.#host.flashError(refusal, { x: event.clientX, y: event.clientY })
        }
        return true
    }

    /** Cancels a bond being drawn, returning whether there was one. */
    cancel(): boolean {
        const wasActive = this.active || this.#pending !== null
        this.#pending = null
        this.#finish()
        this.hideHandle()
        return wasActive
    }

    /** Forgets everything, e.g. when a diagram closes */
    reset() {
        this.#pending = null
        this.#pathMaker = null
        this.#startObject = null
        this.#validTargets.clear()
        this.#markedObjects = []
        this.#handle = null
        this.#handleObject = null
    }

    //==========================================================================

    #bondable(object: CellDLObject|null): CellDLObject|null {
        return (object?.isConnectable && !object.isConduit && !object.isConnection) ? object : null
    }

    #isHandle(target: EventTarget|null): boolean {
        return this.#handle !== null && target === this.#handle
    }

    #targetObject(event: PointerEvent): CellDLObject|null {
        return this.#bondable(this.#host.objectAt(event.target as SVGGraphicsElement))
    }

    /** Starts a bond at an object, or says at client point `at` why it can't. */
    #start(object: CellDLObject, at: PointLike): boolean {
        const frame = this.#host.editorFrame
        const diagram = this.#host.celldlDiagram
        if (!frame || !diagram) {
            return false
        }
        this.hideHandle()
        const startNode = PathMaker.validStartObject(object, (msg) => this.#host.flashError(msg, at))
        if (startNode === null) {
            return false
        }
        this.#startObject = object
        this.#host.suppressTooltips(true)
        this.#pathMaker = new PathMaker(frame, startNode, this.#host.bondStyle)
        this.#validTargets.clear()
        for (const candidate of diagram.objects) {
            if (candidate === object || this.#bondable(candidate) === null || !candidate.isComponent) {
                continue
            }
            const node = this.#pathMaker.validPathNode(candidate, true)
            if (node) {
                this.#validTargets.set(candidate.id, node)
            }
            candidate.svgElement?.classList.add(node ? BOND_TARGET_VALID_CLASS : BOND_TARGET_DIMMED_CLASS)
            this.#markedObjects.push(candidate)
        }
        diagram.svgDiagram.style.setProperty('cursor', 'crosshair')
        return true
    }

    #finish() {
        if (this.#pathMaker) {
            this.#pathMaker.close()
            this.#pathMaker = null
        }
        if (this.#startObject !== null) {
            this.#host.suppressTooltips(false)
        }
        for (const object of this.#markedObjects) {
            object.svgElement?.classList.remove(BOND_TARGET_VALID_CLASS, BOND_TARGET_DIMMED_CLASS)
        }
        this.#markedObjects = []
        this.#validTargets.clear()
        this.#pending = null
        this.#startObject = null
        this.#host.celldlDiagram?.svgDiagram.style.removeProperty('cursor')
    }

    //==========================================================================

    #hover(event: PointerEvent) {
        if (this.#isHandle(event.target)) {
            return
        }
        const object = this.#targetObject(event)
        if (!object || !object.isComponent || object.numConnections >= object.maxConnections) {
            this.hideHandle()
            return
        }
        const bounds = object.celldlSvgElement?.svgBounds()
        if (!bounds) {
            this.hideHandle()
            return
        }
        const centre = nearestBoundaryPoint(bounds, this.#host.svgPoint(event))
        this.#showHandle(object, centre)
    }

    #showHandle(object: CellDLObject, centre: PointLike) {
        const frame = this.#host.editorFrame
        const diagram = this.#host.celldlDiagram
        if (!frame || !diagram) {
            return
        }
        if (this.#handle === null || !this.#handle.isConnected) {
            this.#handle = document.createElementNS(SVG_URI, 'circle')
            this.#handle.classList.add(BOND_HANDLE_CLASS)
            frame.restoreElement(this.#handle)
        }
        const scale = diagram.svgDiagram.getScreenCTM?.()?.a || 1
        this.#handle.setAttribute('cx', String(centre.x))
        this.#handle.setAttribute('cy', String(centre.y))
        this.#handle.setAttribute('r', String(HANDLE_RADIUS / scale))
        this.#handleObject = object
    }

    hideHandle() {
        if (this.#handle) {
            this.#host.editorFrame?.removeElement(this.#handle)
            this.#handle = null
        }
        this.#handleObject = null
    }
}

//==============================================================================
//==============================================================================
