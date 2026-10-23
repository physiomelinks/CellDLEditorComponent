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

import { CELLDL, MetadataPropertiesMap } from '@celldl/metadata'
import { RDF } from '@celldl/rdf'

//==============================================================================


import { type CellDLConnectedObject, CellDLConnection, type CellDLObject } from '#editor/celldlObjects'
import type { CellDLDiagram } from '#editor/diagram'
import { alert } from '#editor/editor/alerts'
import type { EditorFrame } from '#editor/editor/editorframe'
import type { CellDLSVGElement } from '#editor/SVGElements'
import { round } from '#editor/utils'

import { componentLibraryPlugin } from '#root/plugins'
import { Point, type PointLike, PointMath } from '#root/utils/points'
import { CONNECTION_COLOUR, CONNECTION_WIDTH } from '#root/utils/styling'
import { SVG_URI, svgPath, svgPathDescription } from '#root/utils/svgUtils'

import { ConnectionStyle } from '.'

//==============================================================================

// We keep just behind the pointer to make sure it is not over the drawn
// SVG path and so don't see pointer over events on components

const TIP_MARGIN = 1 // pixels

//==============================================================================

class PathPoint {
    constructor(
        readonly point: Point,
        readonly celldlObject: CellDLConnectedObject | null = null
    ) {}

    static fromValue(x: number, y: number): PathPoint {
        return new PathPoint(new Point(x, y))
    }

    get x() {
        return this.point.x
    }

    get y() {
        return this.point.y
    }

    objectContainsPoint(point: PointLike) {
        return this.celldlObject?.containsPoint(point)
    }
}

//==============================================================================

class PathEdge {
    #svgPath: SVGPathElement | null

    constructor(
        readonly source: PathNode,
        readonly target: PathNode,
        svgPath: SVGPathElement
    ) {
        this.#svgPath = svgPath
    }

    get svgPath() {
        return this.#svgPath
    }

    clearSvgPath() {
        this.#svgPath = null
    }
}

//==============================================================================

export class PathNode {
    constructor(readonly object: CellDLConnectedObject) {}

    get celldlSvgElement() {
        return this.object.celldlSvgElement
    }

    get id() {
        return this.object.id
    }

    get uri() {
        return this.object.uri
    }

    canConnect(_node: PathNode): boolean {
        // Check if objects are allowed to be connected
        return true
        //       return libraryManager.objectMethods(this.object).canConnect(node.object)
    }
}

//==============================================================================

/**
 * A ``PathMaker`` is used to create a ``celldl:Connection``.
 *
 * A connection begins with a start object; has a geometric shape, specified by an
 * SVG path; possibly passes through intermediate objects (conduits); and finishes
 * with an end object.
 *
 * An object may have constraints to determine whether and how it can be connected
 * to a path.
 */
export class PathMaker {
    #currentSvgPath: SVGPathElement | null = null
    #edges: PathEdge[] = []
    #editorFrame: EditorFrame
    #lastNode: PathNode
    #lastNodeElement: CellDLSVGElement
    #pointBeforeNode: Point | null = null
    #nodes: PathNode[] = []
    #objectIds: string[] = []
    #pathPoints: PathPoint[] = []
    #rectilinearDirn: string = ''
    #startObject: CellDLObject
    #style: string

    constructor(editorFrame: EditorFrame, startNode: PathNode, style: string = 'rectilinear') {
        this.#editorFrame = editorFrame
        this.#nodes.push(startNode)
        this.#objectIds.push(startNode.id)
        this.#lastNode = startNode
        // biome-ignore lint/style/noNonNullAssertion: node has an SVG element
        this.#lastNodeElement = startNode.celldlSvgElement!
        this.#startObject = startNode.object
        this.#style = style
    }

    get currentSvgPath() {
        return this.#currentSvgPath
    }

    get empty() {
        return this.#edges.length === 0 && this.#currentSvgPath === null
    }

    static #checkMaxConnections(celldlObject: CellDLConnectedObject, quiet: boolean = false): boolean {
        if (celldlObject.numConnections < celldlObject.maxConnections) {
            return true
        } else if (celldlObject.maxConnections >= 0 && !quiet) {
            alert.tooltip('Component has maximum number of connections')
        }
        return false
    }

    static validStartObject(celldlObject: CellDLObject): PathNode | null {
        if (celldlObject.isUnconnectedPort) {
            const connection = celldlObject.connections[0]
            // An UnconnectedPort is only valid if it is the target of a connection
            if (connection) {
                if (connection.connectedObjects[1]?.id !== celldlObject.id) {
                    return null
                }
            }
        }
        if (celldlObject.isConnectable && !celldlObject.isConduit) {
            if (PathMaker.#checkMaxConnections(<CellDLConnectedObject>celldlObject)) {
                return new PathNode(<CellDLConnectedObject>celldlObject)
            }
        } else if (!celldlObject.isConnection) {
            alert.tooltip('Component cannot start a path')
        }
        return null
    }

    static startPartialPath(point: PointLike, celldlDiagram: CellDLDiagram): PathNode {
        const connector = celldlDiagram.createUnconnectedPort(point)
        return new PathNode(connector)
    }

    close() {
        this.#removeSvgPath()
    }

    /**
     * The path node for an object that the path can go to next, if it can.
     *
     * @param celldlObject The object.
     * @param quiet Don't say why it can't, and don't need the path to have been drawn
     *              yet, e.g. when finding every object a new bond could end at.
     */
    validPathNode(celldlObject: CellDLObject, quiet: boolean = false): PathNode | null {
        const refuse = (msg: string) => {
            if (!quiet) {
                alert.tooltip(msg)
            }
            return null
        }
        if (celldlObject.isUnconnectedPort) {
            const connection = celldlObject.connections[0]
            // An UnconnectedPort is only valid if it is the source of a connection
            if (connection) {
                if (connection.connectedObjects[0]?.id !== celldlObject.id) {
                    return null
                }
            }
        }
        if (!celldlObject.isConnectable) {
            if (!celldlObject.isConnection) {
                return refuse('Component does not allow connections')
            }
            return null
        } else if (this.#currentSvgPath === null && !quiet) {
            return null
        } else if (celldlObject.id === this.#startObject.id) {
            if (this.#nodes.length < 2) {
                return refuse('Path cannot directly loop to start component')
            }
        } else if (this.#objectIds.includes(celldlObject.id)) {
            return refuse('Component is already on the path')
        }
        // Check with plugins that (source --> object) would be valid.
        const connectionStatus = componentLibraryPlugin.checkConnectionValid(this.#startObject, celldlObject)
        if (connectionStatus?.alert) {
            return refuse(connectionStatus.alert)
        }
        if (!PathMaker.#checkMaxConnections(<CellDLConnectedObject>celldlObject, quiet)) {
            return null
        }
        const pathNode = new PathNode(<CellDLConnectedObject>celldlObject)
        if (pathNode.canConnect(this.#lastNode)) {
            return pathNode
        }
        return null
    }

    addIntermediate(node: PathNode, shiftKey: boolean = false) {
        // We assume that ``node`` is a ``validPathNode()``
        this.#addNode(node, this.#style === ConnectionStyle.Rectilinear || shiftKey)
    }

    #constrainAngle(
        startPoint: PointLike,
        point: PointLike,
        rectilinear: boolean,
        noTipMargin: boolean = false
    ): Point {
        if (this.#pointBeforeNode !== null) {
            const slope = PointMath.subtract(startPoint, this.#pointBeforeNode)
            const slopeLength = Math.sqrt(slope.x * slope.x + slope.y * slope.y)
            const delta = PointMath.subtract(point, this.#pointBeforeNode)
            const lengthScale = (Math.sqrt(delta.x * delta.x + delta.y * delta.y) - TIP_MARGIN) / slopeLength
            return new Point(slope.x * lengthScale, slope.y * lengthScale).add(this.#pointBeforeNode)
        } else if (rectilinear) {
            const delta = PointMath.subtract(point, startPoint)
            if (round(delta.x) === 0 && round(delta.y) === 0) {
                return Point.fromPoint(startPoint)
            } else {
                if (this.#rectilinearDirn.length === 0 || !['H', 'V'].includes(this.#rectilinearDirn.slice(0, 1))) {
                    let theta = (180 * Math.atan2(-delta.y, delta.x)) / Math.PI
                    if (theta < 0) theta += 360
                    theta = 90 * Math.round(theta / 90)
                    this.#rectilinearDirn = [0, 180, 360].includes(theta) ? 'h' : 'v'
                } else if (this.#rectilinearDirn.length > 1) {
                    if (
                        (this.#rectilinearDirn.toUpperCase().startsWith('H') &&
                            ((this.#rectilinearDirn.slice(1, 2) === '+' && point.x < startPoint.x) ||
                                (this.#rectilinearDirn.slice(1, 2) === '-' && point.x > startPoint.x))) ||
                        (this.#rectilinearDirn.toUpperCase().startsWith('V') &&
                            ((this.#rectilinearDirn.slice(1, 2) === '+' && point.y < startPoint.y) ||
                                (this.#rectilinearDirn.slice(1, 2) === '-' && point.y > startPoint.y)))
                    ) {
                        return Point.fromPoint(startPoint)
                    }
                }
                if (this.#rectilinearDirn.toUpperCase().startsWith('H')) {
                    const margin =
                        noTipMargin || Math.abs(delta.x) <= TIP_MARGIN ? 0 : delta.x > 0 ? TIP_MARGIN : -TIP_MARGIN
                    return new Point(point.x - margin, startPoint.y)
                } else {
                    const margin =
                        noTipMargin || Math.abs(delta.y) <= TIP_MARGIN ? 0 : delta.y > 0 ? TIP_MARGIN : -TIP_MARGIN
                    return new Point(startPoint.x, point.y - margin)
                }
            }
        }
        const delta = PointMath.subtract(point, startPoint)
        const length = Math.sqrt(delta.x * delta.x + delta.y * delta.y)
        const lengthScale = (length - TIP_MARGIN) / length
        return new Point(delta.x * lengthScale, delta.y * lengthScale).add(startPoint)
    }

    #splitPath(startPoint: PointLike, endPoint: PointLike): PathPoint[] {
        // Check is start and end points are aligned with the path's
        // direction and, if not, add an offset.
        const delta = PointMath.subtract(endPoint, startPoint)
        if (round(delta.x) === 0 || round(delta.y) === 0) {
            return []
        } else if (
            this.#rectilinearDirn.toUpperCase().startsWith('H') ||
            (this.#rectilinearDirn === '' && Math.abs(delta.x) >= Math.abs(delta.y))
        ) {
            const midX = (startPoint.x + endPoint.x) / 2
            return [PathPoint.fromValue(midX, startPoint.y), PathPoint.fromValue(midX, endPoint.y)]
        } else {
            const midY = (startPoint.y + endPoint.y) / 2
            return [PathPoint.fromValue(startPoint.x, midY), PathPoint.fromValue(endPoint.x, midY)]
        }
    }

    #setFirstPoints(currentObject: CellDLConnectedObject, finishing: boolean = false, rectilinear: boolean) {
        // Called when no path points have been set
        // biome-ignore lint/style/noNonNullAssertion: object has an SVG element
        const objectCentroid = currentObject.celldlSvgElement!.centroid
        let firstPoint = this.#lastNodeElement.boundaryIntersections(objectCentroid)[0]
        if (firstPoint) {
            // biome-ignore lint/style/noNonNullAssertion: object has an SVG element
            let currentPoint = currentObject.celldlSvgElement!.boundaryIntersections(firstPoint)[0]
            let midPoints: PathPoint[] = []
            if (rectilinear) {
                if (this.#rectilinearDirn.length) {
                    this.#rectilinearDirn = this.#rectilinearDirn.slice(0, 1).toLowerCase()
                }
                const endFromStart = this.#constrainAngle(this.#lastNodeElement.centroid, objectCentroid, true, true)
                // Add mid-points if start and end objects aren't aligned
                const startFromEnd = this.#constrainAngle(objectCentroid, this.#lastNodeElement.centroid, true, true)
                firstPoint = this.#lastNodeElement.boundaryIntersections(endFromStart)[0]
                if (firstPoint) {
                    // biome-ignore lint/style/noNonNullAssertion: object has an SVG element
                    if (currentObject.celldlSvgElement!.containsPoint(endFromStart)) {
                        midPoints = this.#splitPath(endFromStart, startFromEnd)
                        // biome-ignore lint/style/noNonNullAssertion: object has an SVG element
                        currentPoint = currentObject.celldlSvgElement!.boundaryIntersections(startFromEnd)[0]
                    } else {
                        // Start and end objects are separate enough to just need a corner point to change path direction
                        midPoints = [new PathPoint(endFromStart)]
                        // biome-ignore lint/style/noNonNullAssertion: object has an SVG element
                        currentPoint = currentObject.celldlSvgElement!.boundaryIntersections(endFromStart)[0]
                    }
                }
            }
            if (firstPoint && currentPoint) {
                this.#pathPoints = [new PathPoint(firstPoint, this.#lastNode.object), ...midPoints]
                this.#pathPoints.push(new PathPoint(finishing ? currentPoint : objectCentroid, currentObject))
            }
        }
    }

    #addPoint(point: PointLike, rectilinear: boolean): Point {
        let end = Point.fromPoint(point)
        // biome-ignore lint/style/noNonNullAssertion: pathPoints array has elements
        const lastPathPoint = this.#pathPoints.at(-1)!
        const lastPoint = lastPathPoint.point
        if (this.#rectilinearDirn.toUpperCase().startsWith('H') && lastPoint.x === point.x) {
            end = new Point(lastPoint.x, point.y)
            this.#rectilinearDirn = 'V'
        } else if (this.#rectilinearDirn.toUpperCase().startsWith('V') && lastPoint.y === point.y) {
            end = new Point(point.x, lastPoint.y)
            this.#rectilinearDirn = 'H'
        } else {
            point = this.#constrainAngle(lastPoint, point, rectilinear)
            this.#pathPoints.push(PathPoint.fromValue(point.x, point.y))
        }
        return end
    }

    #changeDirection() {
        this.#rectilinearDirn = this.#rectilinearDirn.toUpperCase().startsWith('H') ? 'V' : 'H'
    }

    addPoint(point: PointLike, shiftKey: boolean = false) {
        let addedPoints = false
        const end = Point.fromPoint(point)
        const rectilinear = this.#style === ConnectionStyle.Rectilinear || shiftKey
        if (this.#pathPoints.length === 0) {
            const newPoint = this.#constrainAngle(this.#lastNodeElement.centroid, point, rectilinear)
            const firstPoint = this.#lastNodeElement.boundaryIntersections(newPoint)[0]
            if (firstPoint !== null) {
                this.#pathPoints = [new PathPoint(firstPoint), new PathPoint(newPoint)]
                addedPoints = true
            }
        } else {
            // biome-ignore lint/style/noNonNullAssertion: pathPoints array has elements
            const lastPathPoint = this.#pathPoints.at(-1)!
            if (!lastPathPoint.objectContainsPoint(point)) {
                this.#addPoint(point, rectilinear)
                addedPoints = true
            }
        }
        if (addedPoints) {
            this.#pointBeforeNode = null
            this.#changeDirection()
        }
        this.drawTo(end, shiftKey)
    }

    drawTo(point: PointLike, shiftKey: boolean = false) {
        const rectilinear = this.#style === ConnectionStyle.Rectilinear || shiftKey
        if (this.#pathPoints.length === 0) {
            point = this.#constrainAngle(this.#lastNodeElement.centroid, point, rectilinear)
            const firstPoint = this.#lastNodeElement.boundaryIntersections(point)[0]
            if (firstPoint !== null) {
                this.#setCurrentSvgPath([new PathPoint(firstPoint), PathPoint.fromValue(point.x, point.y)])
            } else {
                this.#setCurrentSvgPath([])
            }
        } else {
            // biome-ignore lint/style/noNonNullAssertion: pathPoints array has elements
            const lastPathPoint = this.#pathPoints.at(-1)!
            const lastPoint = lastPathPoint.point
            if (
                !(
                    (this.#rectilinearDirn.toUpperCase() === 'H' && lastPoint.x === point.x) ||
                    (this.#rectilinearDirn.toUpperCase() === 'V' && lastPoint.y === point.y)
                )
            ) {
                point = this.#constrainAngle(lastPoint, point, rectilinear)
            }
            this.#setCurrentSvgPath([...this.#pathPoints, PathPoint.fromValue(point.x, point.y)])
        }
    }

    #addNode(node: PathNode, rectilinear: boolean): boolean {
        const object = node.object

        if (this.#pathPoints.length === 0) {
            // If rectilinear will add points to align path
            this.#setFirstPoints(object, true, rectilinear)
        } else {
            // biome-ignore lint/style/noNonNullAssertion: object has an SVG element
            const centroid = object.celldlSvgElement!.centroid
            // biome-ignore lint/style/noNonNullAssertion: pathPoints array has elements
            const prevPathPoint = this.#pathPoints.at(-1)!
            let prevPoint = prevPathPoint.point
            if (rectilinear) {
                // Adjust previous point to align with endObject
                let nextPoint = this.#constrainAngle(prevPoint, centroid, rectilinear, true)
                // biome-ignore lint/style/noNonNullAssertion: object has an SVG element
                if (object.celldlSvgElement!.containsPoint(nextPoint)) {
                    nextPoint = this.#constrainAngle(centroid, prevPoint, rectilinear, true)
                    this.#changeDirection()
                    this.#pathPoints.splice(-1, 1, new PathPoint(nextPoint))
                } else {
                    this.#pathPoints.push(new PathPoint(nextPoint))
                }
                prevPoint = nextPoint
            }
            // biome-ignore lint/style/noNonNullAssertion: object has an SVG element
            const lastPoint = object.celldlSvgElement!.boundaryIntersections(prevPoint)[0]
            if (lastPoint) {
                // no lastPoint if centroid, but dirn set...
                this.#pathPoints.push(new PathPoint(lastPoint))
            }
        }

        this.#setCurrentSvgPath(this.#pathPoints)
        if (this.#currentSvgPath === null) {
            return false
        }
        this.#edges.push(new PathEdge(this.#lastNode, node, this.#currentSvgPath))
        this.#nodes.push(node)
        this.#objectIds.push(node.id)
        this.#lastNode = node
        // biome-ignore lint/style/noNonNullAssertion: node has an SVG element
        this.#lastNodeElement = node.celldlSvgElement!

        const lastPoints = this.#pathPoints.slice(-2)
        if (rectilinear) {
            // biome-ignore lint/style/noNonNullAssertion: indices are in range
            const delta = PointMath.subtract(lastPoints[1]!.point, lastPoints[0]!.point)
            if (Math.abs(delta.x) > Math.abs(delta.y)) {
                this.#rectilinearDirn = `H${delta.x > 0 ? '+' : '-'}`
            } else {
                this.#rectilinearDirn = `V${delta.y > 0 ? '+' : '-'}`
            }
        } else if (this.#style === ConnectionStyle.Linear) {
            // biome-ignore lint/style/noNonNullAssertion: index is in range
            this.#pointBeforeNode = Point.fromPoint(lastPoints[0]!.point)
        }
        this.#pathPoints = []
        this.#currentSvgPath = null

        return true
    }

    // We assume that ``endNode`` is a ``validPathNode()``
    finishPath(endNode: PathNode, celldlDiagram: CellDLDiagram, shiftKey: boolean = false) {
        // Add the last point to the path
        if (!this.#addNode(endNode, this.#style === ConnectionStyle.Rectilinear || shiftKey)) {
            return
        }

        // The last path segment has an arrowhead
        // biome-ignore lint/style/noNonNullAssertion: edge has an SVG path
        this.#edges[this.#edges.length - 1]!.svgPath!.classList.add('arrow')

        // When multiple edges we return a SVG group containing the paths
        let svgElement: SVGGraphicsElement
        if (this.#edges.length === 1) {
            // biome-ignore lint/style/noNonNullAssertion: edge has an SVG path
            svgElement = this.#edges[0]!.svgPath!
        } else {
            svgElement = document.createElementNS(SVG_URI, 'g') as SVGGraphicsElement
            this.#edges.forEach((edge) => {
                edge.svgPath?.classList.add('parent-id')
            })
            this.#edges.forEach((edge) => {
                // biome-ignore lint/style/noNonNullAssertion: edge has an SVG path
                svgElement.appendChild(edge.svgPath!)
            })
        }
        svgElement.classList.add(this.#style)

        // Create a new connection between start and end objects
        const metadataProperties = MetadataPropertiesMap.fromProperties([
            [RDF.uri('type'), CELLDL.uri('Connection')], // shouldn't CellDLClass imply this??
            [CELLDL.uri('hasSource'), this.#startObject.uri],
            [CELLDL.uri('hasTarget'), endNode.uri],
            [CELLDL.uri('hasIntermediate'), this.#nodes.slice(1, -1).map((c) => c.uri)]
        ])
        // need to unregister redo handler...
        celldlDiagram.addNewConnection(svgElement, {
            CellDLClass: CellDLConnection,
            metadataProperties
        })
    }

    finishPartialPath(celldlDiagram: CellDLDiagram, shiftKey: boolean = false) {
        // Terminate the partly drawn path at an interface port
        if (this.#style === ConnectionStyle.Rectilinear || shiftKey) {
            // Need to undo change of direction etc from click seen before double click...
            this.#pathPoints = this.#pathPoints.slice(0, -1)
            this.#setCurrentSvgPath(this.#pathPoints)
        }
        const lastPointIndex = this.#pathPoints.length - 1
        // biome-ignore lint/style/noNonNullAssertion: index is in range
        const connector = celldlDiagram.createUnconnectedPort(this.#pathPoints[lastPointIndex]!.point)
        if (connector) {
            // biome-ignore lint/style/noNonNullAssertion: connector has an SVG element
            const pathEnd = connector.celldlSvgElement!.boundaryIntersections(
                // biome-ignore lint/style/noNonNullAssertion: index is in range
                this.#pathPoints[lastPointIndex - 1]!.point
            )[0]
            if (pathEnd) {
                this.#pathPoints[lastPointIndex] = new PathPoint(pathEnd)
            }
        }
        this.finishPath(new PathNode(connector), celldlDiagram)
    }

    #removeSvgPath() {
        for (const edge of this.#edges) {
            if (edge.svgPath) {
                this.#editorFrame.removeElement(edge.svgPath)
                edge.clearSvgPath()
            }
        }
        this.#removeCurrentSvgPath()
    }

    #removeCurrentSvgPath() {
        if (this.#currentSvgPath) {
            this.#editorFrame.removeElement(this.#currentSvgPath)
            this.#currentSvgPath = null
        }
    }

    #setCurrentSvgPath(pathPoints: PathPoint[]) {
        const points = pathPoints.map((p) => p.point)
        if (points.length <= 1) {
            this.#removeCurrentSvgPath()
        } else if (this.#currentSvgPath === null) {
            this.#currentSvgPath = <SVGPathElement>(
                this.#editorFrame.addElementAsString(
                    svgPath(points, {
                        class: `celldl-Connection bondgraph ${this.#style}`,
                        stroke: CONNECTION_COLOUR,
                        'stroke-width': String(CONNECTION_WIDTH)
                    })
                )
            )
        } else {
            this.#currentSvgPath.setAttribute('d', svgPathDescription(points))
        }
    }
}

//==============================================================================
