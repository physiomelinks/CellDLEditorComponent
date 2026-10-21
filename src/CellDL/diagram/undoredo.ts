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

import { type CellDLConnectedObject, type CellDLConnection, CellDLObject } from '#editor/celldlObjects'
import type { CellDLDiagram } from '#editor/diagram'
import { notifyChanges } from '#editor/editor'
import type { SvgConnection } from '#editor/SVGElements/svgconnection'

import { Point, PointMath, type PointLike } from '#root/utils/points'

import { SelectionSet } from './selectionset'
import { StoredObject } from './storedobject'

//==============================================================================

enum UndoAction {
    DELETE = 1,
    INSERT = 2,
    MOVE = 3
}

type UndoObject = CellDLObject | SelectionSet

//==============================================================================

export class UndoState {
    #selectionSet: SelectionSet|null = null
    #storedObjects: Map<string, StoredObject> = new Map()

    constructor(
        readonly action: UndoAction,
        readonly undoObject: UndoObject,
    ) {
        if (undoObject instanceof CellDLObject) {
            this.storeObject(undoObject)
        } else if (undoObject instanceof SelectionSet) {
            this.#selectionSet = undoObject
        }
        if (this.#selectionSet) {
            for (const object of this.#selectionSet.objects) {
                this.storeObject(object)
            }
        }
    }

    protected get selectionSet() {
        return this.#selectionSet
    }

    protected set selectionSet(selectionSet: SelectionSet|null) {
        this.#selectionSet = selectionSet
    }

    get storedObjects() {
        return this.#storedObjects
    }

    storeObject(celldlObject: CellDLObject) {
        if (!this.#storedObjects.has(celldlObject.id)) {
            this.#storedObjects.set(celldlObject.id,
                new StoredObject(celldlObject, this.action !== UndoAction.MOVE))
        }
    }
}

//==============================================================================

type Direction = 'backwards' | 'forwards'

//==============================================================================

type ConnectionPathArrayMap = Map<string, NormalArray[]>

function setConnectionPathArray(connection: CellDLConnection, connectionPathArrays: ConnectionPathArrayMap) {
    const pathArrays = connectionPathArrays.get(connection.id)
    if (pathArrays) {
        connection.clearControlHandles()
        const pathElements = (connection.celldlSvgElement as SvgConnection)?.pathElements
        pathElements.forEach((pathElement, index) => {
            // biome-ignore lint/style/noNonNullAssertion: index is in range
            pathElement.setPathPoints(pathArrays[index]!)
            pathElement.redraw()
        })
    }
}

//==============================================================================

export class MoveUndoState extends UndoState {
    #nextPathArrays: ConnectionPathArrayMap | null = null
    #nextPosition: Point | null = null
    #prevPathArrays: ConnectionPathArrayMap = new Map()
    #prevPosition: Point

    constructor(
        readonly undoObject: CellDLObject,
        position: PointLike,
        selectionSet: SelectionSet|undefined
    ) {
        super(UndoAction.MOVE, undoObject)
        this.selectionSet = selectionSet || null
        this.#prevPathArrays = this.#connectionPathArrays()
        this.#prevPosition = Point.fromPoint(position)
    }

    #connectionPathArrays(): ConnectionPathArrayMap {
        const connectionPathArrays: ConnectionPathArrayMap = new Map()
        if (this.undoObject.isConnectable) {
            const component = <CellDLConnectedObject>this.undoObject
            for (const connection of component.connections) {
                const pathElements = (connection.celldlSvgElement as SvgConnection)?.pathElements
                const pathArrays = pathElements.map(pathElement => pathElement.pathArray)
                connectionPathArrays.set(connection.id, pathArrays)
            }
        } else if (this.undoObject.isConnection) {
            const connection = <CellDLConnection>this.undoObject
            const pathElements = (connection.celldlSvgElement as SvgConnection)?.pathElements
            const pathArrays = pathElements.map(pathElement => pathElement.pathArray)
            connectionPathArrays.set(connection.id, pathArrays)
        }
        return connectionPathArrays
    }

    endMove(position: PointLike|undefined) {
        if (position !== undefined) {
            this.#nextPathArrays = this.#connectionPathArrays()
            this.#nextPosition = Point.fromPoint(position)
        }
    }

    reposition(direction: Direction) {
        if (direction === 'backwards' && this.#nextPosition === null) {
            // restoring to original position without having moved
            this.#restoreConnectionPaths(this.#prevPathArrays)
        } else {
            const connectionPathArrays = (direction === 'backwards') ? this.#prevPathArrays : this.#nextPathArrays
            const position = (direction === 'backwards') ? this.#prevPosition : this.#nextPosition
            const startPosition = (direction === 'backwards') ? this.#nextPosition : this.#prevPosition
            if (position && startPosition && connectionPathArrays
             && !PointMath.equals(startPosition, position)) {
                const movedObject = this.undoObject as CellDLObject
                if (this.selectionSet) {
                    this.selectionSet.reposition(movedObject, startPosition, position)
                } else {
                    movedObject.reposition(startPosition, position)
                }
                this.#restoreConnectionPaths(connectionPathArrays)
            }
        }
    }

    #restoreConnectionPaths(pathArrays: ConnectionPathArrayMap) {
        if (this.undoObject.isConnectable) {
            const component = <CellDLConnectedObject>this.undoObject
            for (const connection of component.connections) {
                setConnectionPathArray(connection, pathArrays)
            }
        } else if (this.undoObject.isConnection) {
            setConnectionPathArray(<CellDLConnection>this.undoObject, pathArrays)
        }
    }
}

//==============================================================================

class UndoRedo {
    static #instance: UndoRedo | null = null

    #activeUndoState: UndoState|null = null
    #redoStack: UndoState[] = []
    #undoStack: UndoState[] = []

    private constructor() {
        if (UndoRedo.#instance) {
            throw new Error('Use UndoRedo.instance instead of `new`')
        }
        UndoRedo.#instance = this
    }

    static get instance() {
        if (!UndoRedo.#instance) {
            UndoRedo.#instance = new UndoRedo()
        }
        return UndoRedo.#instance
    }

    get activeUndoState() {
        return this.#activeUndoState
    }

    clean() {
        this.#redoStack = []
        this.#undoStack = []
        // notify CLEAN
    }

    resetActiveUndoState() {
        if (this.#activeUndoState) {
            if (this.#undoStack.at(-1) === this.#activeUndoState) {
                this.#popUndoStack()
            }
            this.#activeUndoState = null
        }
    }

    setDeleteUndoState(undoObject: UndoObject): UndoState {
        return this.#setActiveUndoState(new UndoState(UndoAction.DELETE, undoObject))
    }

    setInsertUndoState(undoObject: UndoObject): UndoState {
        return this.#setActiveUndoState(new UndoState(UndoAction.INSERT, undoObject))
    }

    setMoveUndoState(undoObject: UndoObject, position: PointLike, selectionSet: SelectionSet|undefined=undefined): MoveUndoState {
        return this.#setActiveUndoState(new MoveUndoState(undoObject as CellDLObject, position, selectionSet)) as MoveUndoState
    }

    #clearRedoStack() {
        if (this.#redoStack.length) {
            this.#redoStack = []
            // notify no REDO
        }
    }

    #popRedoStack(): UndoState | null {
        if (this.#redoStack.length) {
            const undoState = this.#redoStack.pop() || null
            if (this.#redoStack.length === 0) {
            // notify no REDO
            }
            return undoState
        }
        return null
    }

    #pushRedoStack(undoState: UndoState) {
        this.#redoStack.push(undoState)
        if (this.#redoStack.length === 1) {
            // notify can REDO
        }
    }

    #popUndoStack(): UndoState | null {
        if (this.#undoStack.length) {
            const undoState = this.#undoStack.pop() as UndoState
            if (this.#undoStack.length === 0) {
                // notify CLEAN
            }
            return undoState
        }
        return null
    }

    #pushUndoStack(undoState: UndoState, reDoing: boolean): UndoState {
        this.#undoStack.push(undoState)
        if (!reDoing) {
            this.#clearRedoStack() // Can no longer redo once there are new items
        }
        return undoState
    }

    #setActiveUndoState(undoState: UndoState): UndoState {
        this.#activeUndoState = undoState
        this.#pushUndoStack(undoState, false)
        return undoState
    }

    redo(diagram: CellDLDiagram) {
        const undoState = this.#popRedoStack()
        if (undoState) {
            this.#pushUndoStack(undoState, true)
            if (undoState.action === UndoAction.DELETE) {
                diagram.undoInsert(undoState)
            } else if (undoState.action === UndoAction.INSERT) {
                diagram.undoDelete(undoState)
            } else if (undoState.action === UndoAction.MOVE) {
                (undoState as MoveUndoState).reposition('forwards')
            }
            notifyChanges()
        }
    }

    undo(diagram: CellDLDiagram) {
        const undoState = this.#popUndoStack()
        if (undoState) {
            this.#pushRedoStack(undoState)
            if (undoState.action === UndoAction.DELETE) {
                diagram.undoDelete(undoState)
            } else if (undoState.action === UndoAction.INSERT) {
                diagram.undoInsert(undoState)
            } else if (undoState.action === UndoAction.MOVE) {
                (undoState as MoveUndoState).reposition('backwards')
            }
            notifyChanges()
        }
    }
}

//==============================================================================

export const undoRedo = UndoRedo.instance

//==============================================================================
