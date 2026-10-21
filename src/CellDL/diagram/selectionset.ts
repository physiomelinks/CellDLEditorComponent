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

import type { CellDLConnection, CellDLObject } from "#editor/celldlObjects"
import { type CellDLEditor, notifyChanges } from "#editor/editor"
import { undoRedo } from '#editor/diagram/undoredo'
import { Point, type PointLike } from "#root/utils/points"

//==============================================================================

export type MoveGroup = {
    objects: CellDLObject[]
    connections: CellDLConnection[]
}

//==============================================================================

export class SelectionSet {
    #editor: CellDLEditor
    #moveGroup: MoveGroup = { objects: [], connections: [] }
    #movedObject: CellDLObject|null = null
    #movedObjectOffset: Point = new Point()
    #selectedConnections: CellDLConnection[] = []
    #selectedObjects: Map<string, CellDLObject> = new Map()

    #firstMoveableObject: CellDLObject | null = null

    constructor(editor: CellDLEditor) {
        this.#editor = editor
    }

    get firstMoveableObject() {
        return this.#firstMoveableObject
    }

    get objects(): CellDLObject[] {
        return [...this.#selectedObjects.values()]
    }

    get size() {
        return this.#selectedObjects.size
    }

    has(object: CellDLObject): boolean {
        return this.#selectedObjects.has(object.id)
    }

    clear(resetFirst: boolean=true) {
        for (const connection of this.#selectedConnections) {
            connection.select(false)
        }
        this.#selectedConnections = []
        for (const object of this.#selectedObjects.values()) {
            object.select(false)
        }
        this.#selectedObjects.clear()
        if (resetFirst) {
            this.#firstMoveableObject = null
        }
        this.#updatePanelObject()
    }

    select(object: CellDLObject): boolean {
        if (!this.#selectedObjects.has(object.id)) {
            if (object.isConnectable) {
                for (const component of this.#selectedObjects.values()) {
                    if (component.isConnectable) {
                        for (const connection of component.connections) {
                            if (connection.source?.id === object.id || connection.target?.id === object.id) {
                                this.#selectedConnections.push(connection)
                                connection.select(true)
                            }
                        }
                    }
                }
            }
            if (this.#selectedObjects.size === 0
             && this.#firstMoveableObject === null
             && object.isMoveable) {
                // For shift-click selection
                this.#firstMoveableObject = object
            }
            this.#selectedObjects.set(object.id, object)
            this.#updatePanelObject()
            object.select(true)
            return true
        }
        return false
    }

    unselect(object: CellDLObject): boolean {
        if (this.#selectedObjects.has(object.id)) {
            if (object.isConnectable) {
                const deletedIndices: number[] = []
                for (let i = 0; i < this.#selectedConnections.length; i += 1) {
                    const connection = this.#selectedConnections[i] as CellDLConnection
                    if (connection.source?.id === object.id || connection.target?.id === object.id) {
                        connection.select(false)
                        deletedIndices.push(i)
                    }
                }
                if (deletedIndices.length) {
                    this.#selectedConnections = this.#selectedConnections.filter((_, i) => !deletedIndices.includes(i))
                }
            }
            this.#selectedObjects.delete(object.id)
            if (this.#selectedObjects.size === 0) {
                this.#firstMoveableObject = null
            } else if (this.#firstMoveableObject?.id === object.id) {
                // Better to find object that is `closest` to the one being unset?
                // This assumes all selected objects are moveable...
                this.#firstMoveableObject = [...this.#selectedObjects.values()][0] as CellDLObject
            }
            this.#updatePanelObject()
            object.select(false)
            return true
        }
        return false
    }

    #updatePanelObject() {
        if (this.#selectedObjects.size === 1) {
            this.#editor.setPropertiesPanelObject([...this.#selectedObjects.values()][0])
        } else {
            this.#editor.setPropertiesPanelObject(undefined)
        }
        this.#editor.selectionChanged()
    }

    //==========================================================================

    deleteObjects() {
        const undoDelete = undoRedo.setDeleteUndoState(this)
        for (const object of this.#selectedObjects.values()) {
            // Delete the object
            object.celldlDiagram.removeObject(object, undoDelete)
            object.select(false)
        }
        this.clear()
    }

    //==========================================================================

    /**
     * The selected objects and the connections between them, as moved together.
     */
    get moveGroup(): MoveGroup {
        return {
            objects: this.objects,
            connections: [...this.#selectedConnections]
        }
    }

    startMove(svgPoint: PointLike, movedObject: CellDLObject, group: MoveGroup=this.moveGroup) {
        this.#moveGroup = group
        const excludeConnectionIds: Set<string> = new Set()
        for (const connection of group.connections) {
            excludeConnectionIds.add(connection.id)
            connection.startMove(svgPoint, { moveEntireConnection: true })
        }
        for (const object of group.objects) {
            if (object.isMoveable) {
                object.startMove(svgPoint, { excludeConnectionIds: excludeConnectionIds })
            }
        }
        this.#movedObject = movedObject
        this.#movedObjectOffset = Point.fromPoint(svgPoint).subtract(this.#movedObject?.celldlSvgElement?.centroid as Point)
    }

    move(svgPoint: PointLike) {
        // First move this.#movedObject without moving and redrawing paths, and get its change in centroid.
        // Use this delta to adjust svgpoint before moving other components (without grid alignment nor
        // moving/redrawing paths) and then connections (without grid aligning or limiting control points)
        this.#movedObject?.move(svgPoint)
        const newPosn = this.#movedObjectOffset.add(this.#movedObject?.celldlSvgElement?.centroid as Point)
        for (const object of this.#moveGroup.objects) {
            if (object.isMoveable && object.id !== this.#movedObject?.id) {
                object.move(newPosn, { noAlign: true })
            }
        }
        for (const connection of this.#moveGroup.connections) {
            connection.move(newPosn, { moveEntireConnection: true, noAlign: true } )
            connection.redraw()
        }
        notifyChanges()
    }

    endMove() {
        for (const object of this.#moveGroup.objects) {
            if (object.isMoveable) {
                object.endMove()
                object.finaliseMove()
                object.celldlDiagram.objectMoved(object)
            }
        }
        for (const connection of this.#moveGroup.connections) {
            connection.endMove()
        }
        this.#movedObject = null
        this.#moveGroup = { objects: [], connections: [] }
    }

    reposition(movedObject: CellDLObject, startPosn: PointLike, endPosn: PointLike, group?: MoveGroup) {
        this.startMove(startPosn, movedObject, group)
        this.move(endPosn)
        this.endMove()
    }
}

//==============================================================================
//==============================================================================
