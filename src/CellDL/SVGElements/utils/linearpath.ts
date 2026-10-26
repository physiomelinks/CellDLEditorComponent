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
/** biome-ignore-all lint/style/noNonNullAssertion: Array indices will be in range */

import type { NormalArray } from 'svg-path-commander'

//==============================================================================

import { FixedValue, RestrictedValue } from '#editor/geometry'
import { lengthToPixels } from '#editor/geometry/units'

import { type Point, type PointLike, PointMath } from '#root/utils/points'
import { CONNECTION_WIDTH } from '#root/utils/styling'

import type { BoundedElement } from './boundedelement'
import { FixedPathPoint, PathElement, PathPoint } from './pathelement'

//==============================================================================

export class LinearPath extends PathElement {

    addControlHandle(svgPoint: PointLike): PathPoint|undefined {
        const strokeWidth = this.svgElement.getAttribute('stroke-width')
        const halfWidth = (lengthToPixels(strokeWidth) || CONNECTION_WIDTH)/2
        const nPoints = this.pathPoints.length
        const newPoints: PathPoint[] = []
        let index = 0
        while (index < nPoints - 1) {
            const pathPoint = this.pathPoints[index]!
            const nextPoint = this.pathPoints[index + 1]!
            newPoints.push(pathPoint)
            if (PointMath.distanceFromLine(svgPoint, [pathPoint, nextPoint]) < halfWidth) {
                const intersection = PointMath.normalIntersectionPoint(svgPoint, [pathPoint, nextPoint])
                if (intersection) {
                    const newPoint = new PathPoint(new RestrictedValue(intersection.x),
                                                   new RestrictedValue(intersection.y))
                    newPoints.push(newPoint)
                    newPoints.push(...this.pathPoints.slice(index+1))
                    this.pathPoints = newPoints
                    this.drawControlHandles()
                    this.redraw(true)
                    return newPoint
                }
            }
            index += 1
        }
    }

    setPathPoints(pathArray: NormalArray) {
        if (this.validPath) {
            // set by constructor when path starts with 'M' command
            this.pathPoints.length = 0
            let pathPoint: PathPoint = new FixedPathPoint(
                new FixedValue(pathArray[0][1]),
                new FixedValue(pathArray[0][2]),
                this.firstElement.celldlObject
            )
            this.pathPoints.push(pathPoint)
            let n = 1
            while (n < pathArray.length) {
                const drawCommand = pathArray[n]
                if (drawCommand === undefined || drawCommand[0] !== 'L') {
                    this.validPath = false
                    break
                }
                const nextX = new RestrictedValue(drawCommand[1])
                const nextY = new RestrictedValue(drawCommand[2])
                if (n < pathArray.length - 1) {
                    pathPoint = new PathPoint(nextX, nextY)
                } else {
                    // End of path
                    pathPoint = new FixedPathPoint(
                        nextX,
                        nextY,
                        this.lastElement.celldlObject
                    )
                }
                // line from lastpoint to controlpoint
                this.pathPoints.push(pathPoint)
                n += 1
            }
        }
        this.setDirty()
    }

    straighten(): boolean {
        if (!this.validPath || this.pathPoints.length <= 2) {
            return false
        }
        // Each end where the line between the two centroids crosses its element's boundary
        const firstCentroid = this.firstElement.centroid
        const lastCentroid = this.lastElement.centroid
        const start = this.firstElement.boundaryIntersections(lastCentroid)[0] ?? firstCentroid
        const end = this.lastElement.boundaryIntersections(firstCentroid)[0] ?? lastCentroid
        this.clearControlHandles()
        this.setPathPoints([['M', start.x, start.y], ['L', end.x, end.y]] as NormalArray)
        this.redraw(true)
        return true
    }

    protected movePathPoint(position: PointLike) {
        const firstElement = this.pathPoints.at(0)?.component?.celldlSvgElement
        const lastElement = this.pathPoints.at(-1)?.component?.celldlSvgElement
        this.movePoint?.move(position)
        if ([1, 2].includes(this.moveIndex)) {
            // Index is for either the first or second point after the start point, so
            // update the boundary intersection for the start point (move of second point may
            // have moved first point after start point)
            const boundaryPoint = firstElement?.boundaryIntersections(this.pathPoints[1]!)[0]
            if (boundaryPoint) {
                this.pathPoints.at(0)?.reassignPosition(boundaryPoint)
            }
        }
        if ([2, 3].includes(this.pathPoints.length - this.moveIndex)) {
            // Index is for either the first or second point before the last point, so
            // update the boundary intersection for the last point (move of second point may
            // have moved first point before last point)
            const boundaryPoint = lastElement?.boundaryIntersections(this.pathPoints[this.pathPoints.length - 2]!)[0]
            if (boundaryPoint) {
                this.pathPoints.at(-1)?.reassignPosition(boundaryPoint)
            }
        }
        this.setDirty()
    }

    protected movedElementBoundingBox(index: number, element: BoundedElement, _centroidDelta: Point) {
        const position = element.centroid

        const pathPoint = this.pathPoints.at(index) as PathPoint
        const prevPoint = index > 0 ? this.pathPoints[index - 1] : null
        const nextPoint = index < this.pathPoints.length - 1 ? this.pathPoints[index + 1] : null
        if (prevPoint) {
            if (index > 1) {
                const element = this.pathPoints.at(index - 2)?.component?.celldlSvgElement
                if (element) {
                    const boundaryPoint = element.boundaryIntersections(prevPoint)[0]
                    if (boundaryPoint) {
                        this.pathPoints.at(index - 2)?.reassignPosition(boundaryPoint)
                    }
                }
            }
            if (prevPoint.component && !prevPoint.isConduit) {
                const boundaryPoint = prevPoint.component?.celldlSvgElement?.boundaryIntersections(pathPoint)[0]
                if (boundaryPoint) {
                    prevPoint.reassignPosition(boundaryPoint)
                }
            }
        }
        if (nextPoint) {
            if (index < this.pathPoints.length - 2) {
                const element = this.pathPoints.at(index + 2)?.component?.celldlSvgElement
                if (element) {
                    const boundaryPoint = element.boundaryIntersections(nextPoint)[0]
                    if (boundaryPoint) {
                        this.pathPoints.at(index + 2)?.reassignPosition(boundaryPoint)
                    }
                }
            }
            if (nextPoint.component && !nextPoint.isConduit) {
                const boundaryPoint = nextPoint.component?.celldlSvgElement?.boundaryIntersections(pathPoint)[0]
                if (boundaryPoint) {
                    nextPoint.reassignPosition(boundaryPoint)
                }
            }
        }
        pathPoint.reassignPosition(position)

        // One and only one of prev/next point will be defined
        const boundaryPoint = prevPoint
            ? pathPoint.component?.celldlSvgElement?.boundaryIntersections(prevPoint)[0]
            : nextPoint
              ? pathPoint.component?.celldlSvgElement?.boundaryIntersections(nextPoint)[0]
              : null
        if (boundaryPoint) {
            pathPoint.reassignPosition(boundaryPoint)
        }
        this.setDirty()
    }

    protected resizedElementBoundingBox(index: number, element: BoundedElement, _cornerDeltas: [Point, Point]) {
        this.movedElementBoundingBox(index, element, _cornerDeltas[0])
    }

    protected simplifyPathPoints(): PathPoint[] | null {
        // If two points coincide then remove one...
        const nPoints = this.pathPoints.length
        if (nPoints < 3) {
            return null
        }
        const newPoints: PathPoint[] = []
        newPoints.push(this.pathPoints[0]!)
        let index = 1
        while (index < nPoints - 1) {
            const prevPoint = this.pathPoints[index - 1]!
            const pathPoint = this.pathPoints[index]!
            const nextPoint = this.pathPoints[index + 1]!

            if (pathPoint.isConduit) {
                newPoints.push(pathPoint)
            } else if (pathPoint.point.equals(nextPoint.point)) {
                // Two identical points -- remove first one
                pathPoint.removeSvgElement()
            } else if (PointMath.colinear(prevPoint, pathPoint, nextPoint)) {
                // Three colinear points -- remove middle one
                pathPoint.removeSvgElement()
            } else {
                newPoints.push(pathPoint)
            }
            index += 1
        }
        // Add last point
        newPoints.push(this.pathPoints[nPoints - 1]!)
        if (newPoints.length === nPoints) {
            return null
        }
        return newPoints
    }
}

//==============================================================================
