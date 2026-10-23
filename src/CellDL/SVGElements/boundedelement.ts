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

import { CELLDL_STYLE_CLASS, type CellDLConnectedObject, type CellDLObject } from '#editor/celldlObjects'
import { editGuides } from '#editor/editor/editguides'
import { RestrictedPoint, type RestrictedValue } from '#editor/geometry'
import { ControlRect } from '#editor/geometry/controls'
import { Transform } from '#editor/geometry/transforms'

import { Point, type PointLike } from '#root/utils/points'
import type { Styling } from '#root/utils/styling'
import { getFillString } from '#root/utils/svgUtils'

import { CellDLSVGElement, type ElementMoveOptions } from '.'
import type { PathElement } from './utils/pathelement'

//==============================================================================

export class BoundedElement extends CellDLSVGElement {
    // Selected object is stroked bounding box rectangle with control points at each corner
    // Control point move resizes (shift maintains aspect ratio if object doesn't have fixed
    // aspect ratio property).
    // Bounding box grab moves entire object.
    // Rotate via double click on a control point? Cursor to change to show rotate mode; click exits rotate mode.
    // svgElement could be a group.
    // connector nodes on object move with the object (==> need their position wrt. bbox (centre origin, so rotate works?))

    #connectedPathElements: Map<string, PathElement> = new Map()
    #controlRect: ControlRect
    #excludeConnectionIds: Set<string> = new Set()
    #localTransform: Transform
    #topLeftCorner: Point

    constructor(object: CellDLObject, svgElement: SVGGraphicsElement, gridAligned: boolean=false, align: boolean=false) {
        super(object, svgElement)
        // local transform on the element
        this.#localTransform = Transform.fromElement(svgElement)
        this.#controlRect = new ControlRect(
            RestrictedPoint.fromPoint(this.topLeft),
            RestrictedPoint.fromPoint(this.topLeft.add(this.size)),
            this.normalisedCentre
        )
        this.setCentroid(this.#controlRect.centroid.point)
        this.#topLeftCorner = this.#controlRect.topLeftPoint
        this.#controlRect.gridAligned = gridAligned
        if (gridAligned && align) {
            const gridAlignedCentroid = editGuides.gridAlign(this.centroid, { fullSnap: true })
            this.#reposition(gridAlignedCentroid)
        }
    }

    isMoveable(_svgElement: SVGGraphicsElement): boolean {
        return !this.svgElement.classList.contains(CELLDL_STYLE_CLASS.Interface)
    }

    startMove(svgPoint: PointLike, options: ElementMoveOptions={}) {
        this.#controlRect.startMove(svgPoint)
        this.#excludeConnectionIds = options?.excludeConnectionIds || new Set()
    }

    limitDirection(direction: string, minimum: number | RestrictedValue, maximum: number | RestrictedValue) {
        if (direction === 'H') {
            this.#controlRect.centroid.xValue.narrowRange(minimum, maximum)
        } else if (direction === 'V') {
            this.#controlRect.centroid.yValue.narrowRange(minimum, maximum)
        }
    }

    unlimitDirection() {
        this.#controlRect.centroid.xValue.reassignMinimum(-Infinity)
        this.#controlRect.centroid.xValue.reassignMaximum(Infinity)
        this.#controlRect.centroid.yValue.reassignMinimum(-Infinity)
        this.#controlRect.centroid.yValue.reassignMaximum(Infinity)
    }

    move(svgPoint: PointLike, options: ElementMoveOptions={}) {
        const savedCentroid = this.centroid
        // This sets the control rect's attributes but doesn't paint anything
        this.#controlRect.move(svgPoint, options)
        this.setCentroid(this.#controlRect.centroid.point)
        const centroidDelta = this.centroid.subtract(savedCentroid)
        // Reset any restrictions for `elementBoundingBoxBoxMoved()`
        this.unlimitDirection()
        for (const path of this.#connectedPathElements.values()) {
            if (!this.#excludeConnectionIds.has(path.connection.id)) {
                path.elementBoundingBoxMoved(this, centroidDelta)
            }
        }
        if (this.#controlRect.dirty) {
            this.celldlObject.redraw()
            this.svgBounds(true)  // Recalculate the element's bounds
        }
    }

    endMove() {
        super.endMove()
        for (const path of this.#connectedPathElements.values()) {
            if (!this.#excludeConnectionIds.has(path.connection.id)) {
                path.endMove()
            }
        }
    }

    addPathElement(path: PathElement) {
        this.#connectedPathElements.set(path.id, path)
    }

    removePathElement(path: PathElement) {
        this.#connectedPathElements.delete(path.id)
    }

    redraw() {
        const newTopLeft = this.#controlRect.topLeftPoint
        const translation = Transform.Translate(
            newTopLeft.x - this.#topLeftCorner.x,
            newTopLeft.y - this.#topLeftCorner.y
        )
        const transform = translation.leftMultiply(this.#localTransform)
        if (transform.isIdentity) {
            this.svgElement.removeAttribute('transform')
        } else {
            this.svgElement.setAttribute('transform', transform.toString())
        }
        super.redraw()
    }

    #reposition(centroid: Point) {
        this.setCentroid(centroid)
        this.#controlRect.reposition(centroid)
        if (this.#controlRect.dirty) {
            this.redraw()
        }
    }

    async updateImageElement(imageData: string) {
        const savedCorners = this.corners.map((point) => Point.fromPoint(point))
        await super.updateImageElement(imageData)
        this.#controlRect.assignCentroid(this.normalisedCentre)
        this.#controlRect.setCornerPositions(
            RestrictedPoint.fromPoint(this.topLeft),
            RestrictedPoint.fromPoint(this.topLeft.add(this.size))
        )
        // @ts-expect-error: `index` is in range
        const cornerDeltas = this.corners.map((corner, index) => corner.subtract(savedCorners[index]))
        if (this.celldlObject.isConnectable) {
            // Reset any restrictions for `elemntBoundingBoxResisized()`
            this.unlimitDirection()
            // Adjust boundary intersections of paths connected to the component
            for (const path of this.#connectedPathElements.values()) {
                path.elementBoundingBoxResisized(this, cornerDeltas as [Point, Point])
            }
            ;(<CellDLConnectedObject>this.celldlObject).connections.forEach((c) => { c.redraw() })
        }
    }

//==============================================================================

    getStyle(): Styling {
        // if an annotation region then havw cornerStyle but no strokeStyle nor gapStyle
        return {
            fillStyle: getFillString(this.svgElement)
        }
    }

    setStyle(_styling: Styling) {
    }
}

//==============================================================================
