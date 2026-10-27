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

import type { NormalArray } from 'svg-path-commander'
import SVGPathCommander from 'svg-path-commander'

//==============================================================================

import type { CellDLConnection, CellDLObject } from '#editor/celldlObjects'
import { ID_PART_SEPARATOR } from '#editor/diagram'
import type { EditorFrame } from '#editor/editor/editorframe'
import type { FixedValue, RestrictedValue } from '#editor/geometry'
import { ControlPoint } from '#editor/geometry/controls'
import type { FoundPoint } from '#editor/geometry/pathutils'

import type { Point, PointLike } from '#root/utils/points'
import { svgPathElement } from '#root/utils/svgUtils'

import type { ElementMoveOptions } from '..'
import type { BoundedElement } from '../boundedelement'

//==============================================================================

export class PathPoint extends ControlPoint {
    #static: boolean = false

    constructor(
        xValue: RestrictedValue,
        yValue: RestrictedValue,
        readonly component: CellDLObject | null = null,
        static_value: boolean = false
    ) {
        super(xValue, yValue, component)
        this.#static = static_value
    }

    get static() {
        return this.#static || this.fixed
    }
    setStatic(value: boolean = true) {
        this.#static = value
    }

    copy(): PathPoint {
        return new PathPoint(this.xValue, this.yValue, this.component, this.static)
    }
}

//==============================================================================

export class FixedPathPoint extends PathPoint {
    constructor(
        xValue: FixedValue,
        yValue: FixedValue,
        readonly component: CellDLObject | null = null
    ) {
        super(xValue, yValue, component)
    }

    copy(): FixedPathPoint {
        return new FixedPathPoint(this.xValue, this.yValue, this.component)
    }
}

//==============================================================================

export class PathElement {
    #connection: CellDLConnection
    #dirty: boolean = false
    #pathPoints: PathPoint[] = []
    #editorFrame: EditorFrame
    #firstElement: BoundedElement
    #lastElement: BoundedElement
    #moveIndex: number = 0
    #movePoint: PathPoint | null = null
    #pathArray: NormalArray
    #selectionClasses: Set<string> = new Set()
    #svgElement: SVGPathElement
    #svgShadow: SVGPathElement
    #svgParentId: string
    #validPath: boolean = false

    constructor(
        connection: CellDLConnection,
        readonly id: string,
        svgElement: SVGPathElement,
        firstElement: BoundedElement,
        lastElement: BoundedElement
    ) {
        this.#connection = connection
        // biome-ignore lint/style/noNonNullAssertion: the diagram has an editor frame
        this.#editorFrame = connection.celldlDiagram.editorFrame!
        this.#svgElement = svgElement
        this.#svgParentId = id.split(ID_PART_SEPARATOR).slice(0, -1).join(ID_PART_SEPARATOR)
        this.#svgShadow = this.#editorFrame.addElementAsString('<path class="shadow"/>', true) as SVGPathElement
        this.#svgShadow.dataset.parentId = this.#svgParentId
        this.#firstElement = firstElement
        this.#firstElement.addPathElement(this)
        this.#lastElement = lastElement
        this.#lastElement.addPathElement(this)

        let description = this.#svgElement.getAttribute('d') as string
        this.#pathArray = SVGPathCommander.normalizePath(description)
        if (this.#pathArray.length >= 2 && this.#pathArray[0][0] === 'M') {
            this.#validPath = true
            description = SVGPathCommander.pathToString(this.#pathArray)
            this.#svgElement.setAttribute('d', description)
        }
        this.#svgShadow.setAttribute('d', description)
        this.setPathPoints(this.#pathArray)
        const simplifiedPath = this.simplifyPathPoints()
        if (simplifiedPath) {
            this.#pathPoints = simplifiedPath
            this.redraw(true)
        }
    }
    get connection(): CellDLConnection {
        return this.#connection
    }

    get firstElement() {
        return this.#firstElement
    }

    get lastElement() {
        return this.#lastElement
    }

    /** Whether the path has points between its two ends */
    get hasControlPoints(): boolean {
        return this.#pathPoints.length > 2
    }

    get moveIndex() {
        return this.#moveIndex
    }

    get movePoint() {
        return this.#movePoint
    }

    get pathArray() {
        return this.#pathArray
    }

    get svgElement() {
        return this.#svgElement
    }

    protected get pathPoints() {
        return this.#pathPoints
    }
    protected set pathPoints(pathPoints: PathPoint[]) {
        this.#pathPoints = pathPoints
    }

    protected get validPath() {
        return this.#validPath
    }
    protected set validPath(valid: boolean) {
        this.#validPath = valid
    }

    protected setDirty() {
        this.#dirty = true
    }

    #setSelectionClass(cls: string, enable: boolean) {
        if (enable) {
            this.#svgShadow.classList.add(cls)
            this.#selectionClasses.add(cls)
        } else {
            this.#svgShadow.classList.remove(cls)
            this.#selectionClasses.delete(cls)
        }
    }

    activate(active = true) {
        this.#setSelectionClass('active', active)
    }
    highlight(highlight = true) {
        this.#setSelectionClass('highlight', highlight)
    }
    select(selected = true) {
        this.#setSelectionClass('selected', selected)
    }

    addControlHandle(_svgPoint: PointLike): PathPoint|undefined {
        return undefined
    }

    clearControlHandles() {
        this.pathPoints.forEach((pathPoint, _) => {
            pathPoint.removeSvgElement()
        })
    }

    drawControlHandles() {
        for (let index = 1; index < this.#pathPoints.length - 1; ++index) {
            // biome-ignore lint/style/noNonNullAssertion: index is in range
            const pathPoint = this.#pathPoints[index]!
            const svgElement = pathPoint.createSvgElement(this.#editorFrame, '', this.#connection)
            svgElement.id = `${this.#svgParentId}-cp-${index}`
            svgElement.dataset.parentId = this.#svgParentId
            svgElement.dataset.controlIndex = `${this.id}${ID_PART_SEPARATOR}${index}`
        }
        this.#movePoint = null
    }

    endMove() {
        this.clearControlHandles()
        const newPoints = this.simplifyPathPoints()
        if (newPoints) {
            this.#pathPoints = newPoints
            this.redraw(true)
        }
        this.#movePoint = null
    }

    isMoveable(index: number): boolean {
        if (index > 0 && index < this.#pathPoints.length - 1) {
            // biome-ignore lint/style/noNonNullAssertion: index is in range
            const pathPoint = this.#pathPoints[index]!
            if (!pathPoint.fixed) {
                this.#movePoint = pathPoint
                this.#moveIndex = index
                return true
            }
        }
        this.#movePoint = null
        return false
    }

    move(svgPoint: PointLike, options: ElementMoveOptions={}) {
        let redraw = false
        if (options.moveEntireConnection) {
            this.pathPoints.forEach((pathPoint) => {
                pathPoint.reassignValue(pathPoint.offsetPoint(svgPoint))
            })
            redraw = true
        } else if (this.#movePoint) {
            this.pathPoints.forEach((pathPoint) => {
                pathPoint.clean()
            })
            this.movePathPoint(svgPoint)
            this.pathPoints.forEach((pathPoint) => {
                if (pathPoint.redraw()) redraw = true
            })
        }
        this.#dirty = redraw
        return redraw
    }

    protected pathArrayFromPathPoints(): NormalArray {
        const normalArray = this.pathPoints.map((p) => ['L', p.x, p.y])
        // biome-ignore lint/style/noNonNullAssertion: array is three long
        normalArray[0]![0] = 'M'
        return normalArray as NormalArray
    }

    redraw(force: boolean=false) {
        if (force || this.#dirty) {
            this.#pathArray = this.pathArrayFromPathPoints()
            this.#svgElement.setAttribute('d', SVGPathCommander.pathToString(this.#pathArray))
            this.#svgShadow.setAttribute('d', SVGPathCommander.pathToString(this.#pathArray))
            this.#dirty = false
        }
    }

    remove() {
        this.#svgShadow.remove()
        this.#svgElement.remove()
        this.pathPoints.forEach((pathPoint, _) => {
            if (pathPoint.component) {
                (pathPoint.component?.celldlSvgElement as BoundedElement).removePathElement(this)
            }
            pathPoint.removeSvgElement()
        })
    }

    restore() {
        this.pathPoints.forEach((pathPoint, _) => {
            if (pathPoint.component) {
                (pathPoint.component?.celldlSvgElement as BoundedElement).addPathElement(this)
            }
        })
       this.#editorFrame.restoreElement(this.#svgShadow, true)
    }

    splitPath(splitPoint: FoundPoint, interfaceElement: BoundedElement): SVGPathElement {
        const point = splitPoint.point
        const headArray = this.#pathArray.slice(0, splitPoint.segment as number + 1)
        headArray.push(['L', point.x, point.y])

        const tailPoints = this.#pathArray.slice(splitPoint.segment as number + 1).map((p): PointLike => {
            return { x: p[1] as number, y: p[2] as number }
        })
        tailPoints.splice(0, 0, point)
        this.#lastElement.removePathElement(this)
        this.#lastElement = interfaceElement
        this.#lastElement.addPathElement(this)
        this.#pathArray = headArray as NormalArray

        const svgElement = svgPathElement(tailPoints)
        this.#svgElement.setAttribute('d', SVGPathCommander.pathToString(this.#pathArray))
        this.setPathPoints(this.#pathArray)
        svgElement.classList.add(...this.#svgElement.classList.values())
        return svgElement
    }

    startMove(svgPoint: PointLike, options: ElementMoveOptions={}) {
        if (options.moveEntireConnection) {
            this.#movePoint = null
            this.pathPoints.forEach((pathPoint) => {
                pathPoint.startMove(svgPoint)
            })
        } else if (this.#movePoint) {
            this.#movePoint.startMove(svgPoint)
        }
    }

    elementBoundingBoxMoved(element: BoundedElement, centroidDelta: Point) {
        for (const index of [0, this.#pathPoints.length - 1]) {
            // biome-ignore lint/style/noNonNullAssertion: index is in range
            if (element === this.#pathPoints[index]!.component?.celldlSvgElement) {
                this.movedElementBoundingBox(index, element, centroidDelta)
                return
            }
        }
    }

    elementBoundingBoxResisized(element: BoundedElement, cornerDeltas: [Point, Point]) {
        for (const index of [0, this.#pathPoints.length - 1]) {
            // biome-ignore lint/style/noNonNullAssertion: index is in range
            if (element === this.#pathPoints[index]!.component?.celldlSvgElement) {
                this.resizedElementBoundingBox(index, element, cornerDeltas)
                return
            }
        }
    }

    protected movePathPoint(_position: PointLike) {}

    protected movedElementBoundingBox(_index: number, _element: BoundedElement, _centroidDelta: Point) {}

    protected resizedElementBoundingBox(_index: number, _element: BoundedElement, _cornerDeltas: [Point, Point]) {}

    setPathPoints(_pathArray: NormalArray) {}

    /**
     * Runs the path straight between its two ends, squared up when within `square` pixels of horizontal or vertical.
     *
     * @returns Whether the path changed.
     */
    straighten(_square: number = 0): boolean {
        return false
    }

    protected simplifyPathPoints(): PathPoint[] | null {
        return null
    }
}

//==============================================================================
