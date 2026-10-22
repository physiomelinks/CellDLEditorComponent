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
import * as vue from 'vue'

import { isBlankNode, type Statement } from '@celldl/rdf'

import { type CellDLConnectedObject, type CellDLConnection, CellDLObject } from '#editor/celldlObjects'
import type { CellDLDiagram } from '#editor/diagram'
import { CellDLEditor, notifyChanges } from '#editor/editor'
import type { SvgConnection } from '#editor/SVGElements/svgconnection'

import { componentLibraryPlugin } from '#root/plugins'
import { Point, PointMath, type PointLike } from '#root/utils/points'

import { type MoveGroup, SelectionSet } from './selectionset'
import { StoredObject } from './storedobject'

//==============================================================================

enum UndoAction {
    DELETE = 1,
    INSERT = 2,
    MOVE = 3,
    PROPERTIES = 4
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
    // What was moved, as the selection may have changed by undo time
    #group: MoveGroup | null
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
        this.#group = selectionSet?.moveGroup ?? null
        this.#prevPathArrays = this.#connectionPathArrays()
        this.#prevPosition = Point.fromPoint(position)
    }

    // The connections whose paths a move changes
    #movedConnections(): CellDLConnection[] {
        const connections: Set<CellDLConnection> = new Set(this.#group?.connections)
        for (const object of this.#group?.objects ?? [this.undoObject]) {
            if (object.isConnectable) {
                for (const connection of (<CellDLConnectedObject>object).connections) {
                    connections.add(connection)
                }
            } else if (object.isConnection) {
                connections.add(<CellDLConnection>object)
            }
        }
        return [...connections]
    }

    #connectionPathArrays(): ConnectionPathArrayMap {
        const connectionPathArrays: ConnectionPathArrayMap = new Map()
        for (const connection of this.#movedConnections()) {
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
                if (this.selectionSet && this.#group) {
                    this.selectionSet.reposition(movedObject, startPosition, position, this.#group)
                } else {
                    movedObject.reposition(startPosition, position)
                }
                this.#restoreConnectionPaths(connectionPathArrays)
            }
        }
    }

    #restoreConnectionPaths(pathArrays: ConnectionPathArrayMap) {
        for (const connection of this.#movedConnections()) {
            setConnectionPathArray(connection, pathArrays)
        }
    }
}

//==============================================================================

/**
 * An object's property statements: those with it as subject, and those of the
 * blank nodes they reach, such as its `bgf:parameterValue` and `bgf:VariableValue`
 * nodes.
 */
function propertyStatements(celldlObject: CellDLObject): Statement[] {
    const statements: Statement[] = []
    const subjects = [celldlObject.uri] as Statement['subject'][]
    const seen: Set<string> = new Set()
    while (subjects.length) {
        // biome-ignore lint/style/noNonNullAssertion: `subjects` is not empty
        const subject = subjects.pop()!
        if (seen.has(subject.toString())) {
            continue
        }
        seen.add(subject.toString())
        for (const statement of celldlObject.rdfStore.statementsMatching(subject, null, null, null)) {
            statements.push(statement)
            if (isBlankNode(statement.object)) {
                subjects.push(statement.object as Statement['subject'])
            }
        }
    }
    return statements
}

/** The statements as text, with blank nodes named by position, so equal statements compare equal. */
function statementsKey(statements: Statement[]): string {
    const blankNodes: Map<string, string> = new Map()
    const term = (t: Statement['subject']|Statement['object']) => {
        if (isBlankNode(t)) {
            const id = t.toString()
            if (!blankNodes.has(id)) {
                blankNodes.set(id, `_:b${blankNodes.size}`)
            }
            return blankNodes.get(id)
        }
        return t.toString()
    }
    return statements.map(st => `${term(st.subject)} ${st.predicate.toString()} ${term(st.object)}`)
                     .sort()
                     .join('\n')
}

/**
 * Undoes and redoes changes to objects' properties, as the Properties panel or
 * the host's `element` command makes them, by swapping the objects' property
 * statements.
 */
export class PropertiesUndoState extends UndoState {
    #after: Map<string, Statement[]> = new Map()
    #before: Map<string, Statement[]> = new Map()
    #objects: CellDLObject[]

    constructor(objects: CellDLObject[]) {
        // biome-ignore lint/style/noNonNullAssertion: there is at least one object
        super(UndoAction.PROPERTIES, objects[0]!)
        this.#objects = objects
        for (const object of objects) {
            this.#before.set(object.id, propertyStatements(object))
        }
    }

    get objects() {
        return this.#objects
    }

    /** Notes the objects' properties once edited, returning whether any changed. */
    endEdit(): boolean {
        let changed = false
        for (const object of this.#objects) {
            const after = propertyStatements(object)
            this.#after.set(object.id, after)
            // biome-ignore lint/style/noNonNullAssertion: set in the constructor
            changed ||= statementsKey(after) !== statementsKey(this.#before.get(object.id)!)
        }
        return changed
    }

    /** Restores the objects' properties to before or after the edit. */
    async restore(direction: Direction) {
        const statements = (direction === 'backwards') ? this.#before : this.#after
        for (const object of this.#objects) {
            object.rdfStore.removeStatements(propertyStatements(object))
            object.rdfStore.addStatementList(statements.get(object.id) ?? [])
        }
        for (const object of this.#objects) {
            await componentLibraryPlugin.refreshObject(object)
        }
        CellDLEditor.instance?.refreshPropertiesPanel(this.#objects)
    }
}

//==============================================================================

/** Whether there is anything to undo or redo, for the toolbar's buttons */
export const undoRedoState = vue.reactive({
    canUndo: false,
    canRedo: false
})

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
        this.#updateState()
    }

    #updateState() {
        undoRedoState.canUndo = this.#undoStack.length > 0
        undoRedoState.canRedo = this.#redoStack.length > 0
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

    /** Starts an undoable edit of objects' properties; call its `endEdit()` once they are edited. */
    setPropertiesUndoState(objects: CellDLObject[]): PropertiesUndoState {
        return this.#setActiveUndoState(new PropertiesUndoState(objects)) as PropertiesUndoState
    }

    /**
     * Ends an edit of objects' properties, keeping it to undo only if it changed them.
     *
     * @returns Whether the edit changed the objects' properties.
     */
    endPropertiesEdit(undoState: PropertiesUndoState): boolean {
        const changed = undoState.endEdit()
        if (!changed && this.#undoStack.at(-1) === undoState) {
            this.#popUndoStack()
        }
        if (this.#activeUndoState === undoState) {
            this.#activeUndoState = null
        }
        return changed
    }

    setMoveUndoState(undoObject: UndoObject, position: PointLike, selectionSet: SelectionSet|undefined=undefined): MoveUndoState {
        return this.#setActiveUndoState(new MoveUndoState(undoObject as CellDLObject, position, selectionSet)) as MoveUndoState
    }

    #clearRedoStack() {
        if (this.#redoStack.length) {
            this.#redoStack = []
            this.#updateState()
        }
    }

    #popRedoStack(): UndoState | null {
        if (this.#redoStack.length) {
            const undoState = this.#redoStack.pop() || null
            this.#updateState()
            return undoState
        }
        return null
    }

    #pushRedoStack(undoState: UndoState) {
        this.#redoStack.push(undoState)
        this.#updateState()
    }

    #popUndoStack(): UndoState | null {
        if (this.#undoStack.length) {
            const undoState = this.#undoStack.pop() as UndoState
            this.#updateState()
            return undoState
        }
        return null
    }

    #pushUndoStack(undoState: UndoState, reDoing: boolean): UndoState {
        this.#undoStack.push(undoState)
        if (!reDoing) {
            this.#clearRedoStack() // Can no longer redo once there are new items
        }
        this.#updateState()
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
            } else if (undoState.action === UndoAction.PROPERTIES) {
                void (undoState as PropertiesUndoState).restore('forwards')
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
            } else if (undoState.action === UndoAction.PROPERTIES) {
                void (undoState as PropertiesUndoState).restore('backwards')
            }
            notifyChanges()
        }
    }
}

//==============================================================================

export const undoRedo = UndoRedo.instance

//==============================================================================
