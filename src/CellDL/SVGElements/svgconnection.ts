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

import type { ShapeTypes } from 'svg-path-commander'
import SVGPathCommander from 'svg-path-commander'

//==============================================================================

import type { CellDLConnection } from '#editor/celldlObjects'
import { ID_PART_SEPARATOR } from '#editor/diagram'
import { alert } from '#editor/editor/alerts'

import type { PointLike } from '#root/utils/points'
import {
    CONNECTION_COLOUR,
    CONNECTION_DASH,
    CONNECTION_WIDTH,
    type Styling
} from '#root/utils/styling'
import { getStrokeString, setStrokeFromString } from '#root/utils/svgUtils'

//==============================================================================

import { CellDLSVGElement, type DomLocation, type ElementMoveOptions } from '.'
import type { BoundedElement } from './boundedelement'
import { LinearPath } from './utils/linearpath'
import type { PathElement } from './utils/pathelement'
import { RectilinearPath } from './utils/rectilinearpath'

//==============================================================================

const shapeTags = ['line', 'polyline', 'polygon', 'ellipse', 'circle', 'rect', 'glyph']
const svgPathTag = 'path'
const svgGroupTag = 'g'

//==============================================================================

export class SvgConnection extends CellDLSVGElement {
    #pathElements: PathElement[] = []
    #moveableElement: PathElement | null = null

    constructor(connection: CellDLConnection, svgElement: SVGGraphicsElement) {
        super(connection, svgElement)

        const svgPaths: SVGPathElement[] = []
        if (shapeTags.includes(svgElement.tagName)) {
            SVGPathCommander.shapeToPath(svgElement as ShapeTypes, true)
        }
        if (svgElement.tagName === svgPathTag) {
            svgPaths.push(<SVGPathElement>svgElement)
        } else if (svgElement.tagName === svgGroupTag) {
            for (let i = 0; i < svgElement.children.length; ++i) {
                const element = svgElement.children.item(i) as SVGPathElement
                if (shapeTags.includes(element.tagName)) {
                    SVGPathCommander.shapeToPath(element as ShapeTypes, true)
                }
                if (element.tagName === 'path') {
                    svgPaths.push(element)
                } else {
                    throw new Error(`Connection ${connection.id}: SVG paths are not all 'path' elements`)
                }
            }
        } else {
            throw new Error(`Connection ${connection.id}: SVG is not a 'path' element`)
        }

        const connectorElements = connection.connectedObjects.map((cn) => <BoundedElement>cn.celldlSvgElement)
        if (svgPaths.length === connectorElements.length - 1) {
            for (let n = 0; n < svgPaths.length; n += 1) {
                const pathId = `${svgElement.id}${ID_PART_SEPARATOR}${n + 1}`
                const svgPath = svgPaths[n]
                this.#pathElements[n] =
                    // @ts-expect-error: `n < svgPaths.length` and so `svgPath` is defined
                    svgPath.classList.contains('rectilinear')
                        ? new RectilinearPath(
                              connection,
                              pathId,
                              // @ts-expect-error
                              svgPath,
                              connectorElements[n],
                              connectorElements[n + 1]
                          )
                        : new LinearPath(
                              connection,
                              pathId,
                              // @ts-expect-error
                              svgPath,
                              connectorElements[n],
                              connectorElements[n + 1]
                          )
            }
        } else {
            alert.elementError(`Connection ${connection.id}: wrong number of paths for connectors`, this.svgElement)
        }
    }

    get pathElements(): PathElement[] {
        return this.#pathElements
    }

    /** Whether any of the connection's paths has points between its ends */
    get hasControlPoints(): boolean {
        return this.#pathElements.some(pathElement => pathElement.hasControlPoints)
    }

    activate(active = true) {
        super.activate(active)
        this.#pathElements.forEach((element) => { element.activate(active) })
        this.#moveableElement = null
    }
    highlight(highlight = true) {
        super.highlight(highlight)
        this.#pathElements.forEach((element) => { element.highlight(highlight) })
    }
    select(selected = true) {
        super.select(selected)
        this.#pathElements.forEach((element) => { element.select(selected) })
    }

    addControlHandle(svgPoint: PointLike): SVGGraphicsElement|undefined {
        for (const pathElement of this.#pathElements) {
            const controlHandle = pathElement.addControlHandle(svgPoint)
            if (controlHandle) {
                return controlHandle.svgElement || undefined
            }
        }
    }

    clearControlHandles() {
        this.#pathElements.forEach((element) => { element.clearControlHandles() })
    }

    drawControlHandles() {
        this.#pathElements.forEach((element) => { element.drawControlHandles() })
    }

    clearSelectedHandles() {
        if (this.selected) {
            this.#pathElements.forEach((element) => { element.clearControlHandles() })
        }
    }

    endMove() {
        if (this.#moveableElement) {
            this.#moveableElement.endMove()
            this.#moveableElement = null
        } else {
            this.#pathElements.forEach((element) => { element.endMove() })
        }
    }

    isMoveable(svgElement: SVGGraphicsElement): boolean {
        if (svgElement.dataset.controlIndex) {
            const indices = svgElement.dataset.controlIndex
                .split(ID_PART_SEPARATOR)
                .slice(-2)
                .map((n) => +n)
            // @ts-expect-error: `0` and `1` indexes are in range
            if (indices[0] > 0 && indices[0] <= this.#pathElements.length) {
                // @ts-expect-error:
                if (this.#pathElements[indices[0] - 1].isMoveable(indices[1])) {
                    // @ts-expect-error:
                    this.#moveableElement = this.#pathElements[indices[0] - 1] || null
                    return true
                }
            }
        }
        this.#moveableElement = null
        return false
    }

    move(svgPoint: PointLike, options: ElementMoveOptions={}) {
        if (options.moveEntireConnection) {
            this.#pathElements.forEach((element) => { element.move(svgPoint, options) })
        } else if (this.#moveableElement) {
            if (this.#moveableElement.move(svgPoint)) {
                this.#moveableElement.redraw()
            }
        }
    }

    redraw() {
        this.#pathElements.forEach((element) => { element.redraw() })
        super.redraw()
    }

    remove() {
        super.remove()
        this.#pathElements.forEach((element) => { element.remove() })
    }

    restore(domLocation: DomLocation) {
        super.restore(domLocation)
        this.#pathElements.forEach((element) => { element.restore() })
    }

    setPathElements(pathElements: PathElement[]) {
        this.#pathElements = pathElements
        this.redraw()
    }

    /**
     * Removes the control points of the connection's straight-line paths.
     *
     * @returns Whether any path had control points to remove.
     */
    straighten(): boolean {
        let straightened = false
        for (const pathElement of this.#pathElements) {
            straightened = pathElement.straighten() || straightened
        }
        return straightened
    }

    startMove(svgPoint: PointLike, options: ElementMoveOptions={}) {
        if (options.moveEntireConnection) {
            this.#pathElements.forEach((element) => { element.startMove(svgPoint, options) })
        } else if (this.#moveableElement?.movePoint) {
            this.#moveableElement.startMove(svgPoint)
        }
    }

//==============================================================================

    getStyle(): Styling {
        return {
            pathStyle: getStrokeString(this.svgElement, {
                colour: CONNECTION_COLOUR,
                width: CONNECTION_WIDTH,
                dashScale: CONNECTION_DASH
            })
        }
    }

    setStyle(styling: Styling) {
        if (styling.pathStyle) {
            setStrokeFromString(this.svgElement, styling.pathStyle)
        }
    }
}

//==============================================================================
//==============================================================================
