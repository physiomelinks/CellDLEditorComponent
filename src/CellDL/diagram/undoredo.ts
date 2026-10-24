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
import type { ElementMoveOptions } from '#editor/SVGElements'
import type { SvgConnection } from '#editor/SVGElements/svgconnection'

import { componentLibraryPlugin } from '#root/plugins'
import { Point, PointMath, type PointLike } from '#root/utils/points'
import type { Styling } from '#root/utils/styling'

import { type MoveGroup, SelectionSet } from './selectionset'
import { StoredObject } from './storedobject'

//==============================================================================

enum UndoAction {
    DELETE = 1,
    INSERT = 2,
    MOVE = 3,
    PROPERTIES = 4,
    GROUP = 5,
    PATHS = 6,
    STYLE = 7
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

    /**
     * Stores the objects again, as they are now, e.g. once an inserted object's
     * properties have been set, so redoing the insert restores them. An object
     * that is no longer in the diagram keeps what was stored.
     */
    restoreObjects() {
        for (const [id, stored] of this.#storedObjects) {
            const object = stored.celldlObject
            if (object.rdfStore.statementsMatching(object.uri, null, null, null).length) {
                this.#storedObjects.set(id, new StoredObject(object, this.action !== UndoAction.MOVE))
            }
        }
    }
}

//==============================================================================

/**
 * Several changes undone and redone as one step, such as an edit in the
 * Reactions panel that adds elements, bonds them and sets their counts.
 */
export class GroupUndoState extends UndoState {
    constructor(readonly states: UndoState[]) {
        // biome-ignore lint/style/noNonNullAssertion: a group has at least one state
        super(UndoAction.GROUP, states[0]!.undoObject)
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

function connectionPathArrays(connections: Iterable<CellDLConnection>): ConnectionPathArrayMap {
    const pathArrays: ConnectionPathArrayMap = new Map()
    for (const connection of connections) {
        const pathElements = (connection.celldlSvgElement as SvgConnection)?.pathElements
        pathArrays.set(connection.id, pathElements.map(pathElement => pathElement.pathArray))
    }
    return pathArrays
}

/** Whether objects are at the same positions in both maps */
function sameCentroids(a: Map<CellDLObject, Point>, b: Map<CellDLObject, Point>): boolean {
    if (a.size !== b.size) {
        return false
    }
    for (const [object, centroid] of a) {
        const other = b.get(object)
        if (other === undefined || !PointMath.equals(centroid, other)) {
            return false
        }
    }
    return true
}

/** Whether connections have the same paths in both maps */
function samePathArrays(a: ConnectionPathArrayMap, b: ConnectionPathArrayMap): boolean {
    if (a.size !== b.size) {
        return false
    }
    for (const [id, pathArrays] of a) {
        const other = b.get(id)
        if (other === undefined || JSON.stringify(pathArrays) !== JSON.stringify(other)) {
            return false
        }
    }
    return true
}

//==============================================================================

export class MoveUndoState extends UndoState {
    // What was moved, as the selection may have changed by undo time
    #group: MoveGroup | null
    #nextCentroids: Map<CellDLObject, Point> = new Map()
    #nextPathArrays: ConnectionPathArrayMap | null = null
    #nextPosition: Point | null = null
    #prevCentroids: Map<CellDLObject, Point> = new Map()
    #prevPathArrays: ConnectionPathArrayMap = new Map()
    #prevPosition: Point
    // Where the pointer was when the move started
    #startPointer: Point
    // Whether the positions are the moved component's centroid, as drawn, rather than the pointer's
    #byCentroid: boolean

    /** How a lone object is moved back and forth, such as without snapping to the grid */
    moveOptions: ElementMoveOptions = {}

    constructor(
        readonly undoObject: CellDLObject,
        position: PointLike,
        selectionSet: SelectionSet|undefined
    ) {
        super(UndoAction.MOVE, undoObject)
        this.selectionSet = selectionSet || null
        this.#group = selectionSet?.moveGroup ?? null
        this.#prevPathArrays = this.#connectionPathArrays()
        this.#startPointer = Point.fromPoint(position)
        this.#prevCentroids = this.#centroids()
        // A component is moved back and forth between where it was drawn, as the pointer's positions would be
        // snapped to the grid again, leaving it short of where its bonds are restored to. A bond's control point
        // is moved by the pointer, as its path is restored anyway.
        const centroid = undoObject.isConnection ? null : undoObject.celldlSvgElement?.centroid
        this.#byCentroid = !!centroid
        this.#prevPosition = Point.fromPoint(centroid ?? position)
    }

    // Where the moved objects with a position of their own, i.e. not connections, are
    #centroids(): Map<CellDLObject, Point> {
        const centroids: Map<CellDLObject, Point> = new Map()
        for (const object of this.#group?.objects ?? [this.undoObject]) {
            const centroid = object.isConnection ? undefined : object.celldlSvgElement?.centroid
            if (object.isMoveable && centroid) {
                centroids.set(object, Point.fromPoint(centroid))
            }
        }
        return centroids
    }

    /**
     * Puts the moved objects exactly where they were, or were moved to, as moving
     * them back by the pointer's offset can snap them elsewhere on the grid.
     */
    #setPositions(centroids: Map<CellDLObject, Point>) {
        for (const [object, centroid] of centroids) {
            const current = object.celldlSvgElement?.centroid
            if (current && !PointMath.equals(current, centroid)) {
                object.reposition(Point.fromPoint(current), centroid, { noAlign: true, snapGrid: false })
            }
        }
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
        return connectionPathArrays(this.#movedConnections())
    }

    /**
     * Notes where the move ended, returning whether it moved anything. A move
     * that ends where it started, or that left everything where it was (such as
     * one snapped back to the same grid point), is kept as not having moved.
     */
    endMove(position: PointLike|undefined): boolean {
        if (position !== undefined && !PointMath.equals(this.#startPointer, position)) {
            const centroids = this.#centroids()
            const pathArrays = this.#connectionPathArrays()
            if (!sameCentroids(centroids, this.#prevCentroids) || !samePathArrays(pathArrays, this.#prevPathArrays)) {
                this.#nextCentroids = centroids
                this.#nextPathArrays = pathArrays
                const centroid = this.#byCentroid ? this.undoObject.celldlSvgElement?.centroid : null
                this.#nextPosition = Point.fromPoint(centroid ?? position)
            }
        }
        return this.moved
    }

    /** Whether the move, once ended, moved anything */
    get moved(): boolean {
        return this.#nextPosition !== null
    }

    reposition(direction: Direction) {
        const backwards = (direction === 'backwards')
        if (backwards && this.#nextPosition === null) {
            // restoring to original position without having moved
            this.#setPositions(this.#prevCentroids)
            this.#restoreConnectionPaths(this.#prevPathArrays)
        } else {
            const connectionPathArrays = (direction === 'backwards') ? this.#prevPathArrays : this.#nextPathArrays
            const position = (direction === 'backwards') ? this.#prevPosition : this.#nextPosition
            const startPosition = (direction === 'backwards') ? this.#nextPosition : this.#prevPosition
            if (position && startPosition && connectionPathArrays
             && !PointMath.equals(startPosition, position)) {
                const movedObject = this.undoObject as CellDLObject
                const moveOptions = this.#byCentroid ? { ...this.moveOptions, noAlign: true } : this.moveOptions
                if (this.selectionSet && this.#group) {
                    this.selectionSet.reposition(movedObject, startPosition, position, this.#group, moveOptions)
                } else {
                    movedObject.reposition(startPosition, position, moveOptions)
                }
                this.#setPositions(backwards ? this.#prevCentroids : this.#nextCentroids)
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
 * Undoes and redoes a change to connections' paths that moves nothing, such as
 * straightening bonds once their ends are aligned.
 */
export class PathsUndoState extends UndoState {
    #connections: CellDLConnection[]
    #nextPathArrays: ConnectionPathArrayMap = new Map()
    #prevPathArrays: ConnectionPathArrayMap

    constructor(connections: CellDLConnection[]) {
        // biome-ignore lint/style/noNonNullAssertion: there is at least one connection
        super(UndoAction.PATHS, connections[0]!)
        this.#connections = connections
        this.#prevPathArrays = connectionPathArrays(connections)
    }

    /** Notes the connections' paths once changed, returning whether any changed. */
    endEdit(): boolean {
        this.#nextPathArrays = connectionPathArrays(this.#connections)
        return !samePathArrays(this.#prevPathArrays, this.#nextPathArrays)
    }

    restore(direction: Direction) {
        const pathArrays = (direction === 'backwards') ? this.#prevPathArrays : this.#nextPathArrays
        for (const connection of this.#connections) {
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

/** A statement as text, blank nodes included as they are */
function statementKey(statement: Statement): string {
    return `${statement.subject.toString()} ${statement.predicate.toString()} ${statement.object.toString()}`
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

    /**
     * Restores the objects' properties to before or after the edit.
     *
     * Only the statements the edit removed or added are swapped, so a later change
     * that isn't undoable (e.g. to an object's metadata) is kept.
     */
    async restore(direction: Direction) {
        const [from, to] = (direction === 'backwards') ? [this.#after, this.#before] : [this.#before, this.#after]
        for (const object of this.#objects) {
            const fromStatements = from.get(object.id) ?? []
            const toStatements = to.get(object.id) ?? []
            const fromKeys = new Set(fromStatements.map(statementKey))
            const toKeys = new Set(toStatements.map(statementKey))
            object.rdfStore.removeStatements(fromStatements.filter(st => !toKeys.has(statementKey(st))))
            object.rdfStore.addStatementList(toStatements.filter(st => !fromKeys.has(statementKey(st))))
        }
        // Bring every object's plugin data up to date before any (slower) SVG update
        for (const object of this.#objects) {
            await componentLibraryPlugin.refreshObject(object)
        }
        CellDLEditor.instance?.refreshPropertiesPanel(this.#objects)
    }
}

//==============================================================================

/**
 * An object's styling, with what its styling draws: an element's image, and a
 * compartment's boundary rectangles, whose corners also follow its gap.
 */
export type StyleSnapshot = {
    styling: Styling
    image?: string
    rects: Record<string, string>[]
    /** The attributes styling is saved in, `null` when absent */
    saved: Record<string, string|null>
    /** The paths of an element's bonds, whose ends follow its image's size */
    paths: ConnectionPathArrayMap
}

/** Where a compartment saves styling that its boundaries don't show, and a connection its stroke */
const STYLE_ATTRIBUTES = [
    'data-fill-style', 'data-stroke-gap', 'data-text-style',
    'stroke', 'stroke-width', 'stroke-dasharray'
]

function objectConnections(object: CellDLObject): CellDLConnection[] {
    return object.isConnection ? [] : [...((<CellDLConnectedObject>object).connections ?? [])]
}

/** Sets an element's attributes, removing those that are `null` */
function setAttributes(element: Element, attributes: Record<string, string|null>) {
    for (const [name, value] of Object.entries(attributes)) {
        if (value === null) {
            element.removeAttribute(name)
        } else if (element.getAttribute(name) !== value) {
            element.setAttribute(name, value)
        }
    }
}

function boundaryRects(object: CellDLObject): SVGRectElement[] {
    return Array.from(object.svgElement?.querySelectorAll<SVGRectElement>(':scope > rect') ?? [])
}

/** An object's styling as it is now, for `recordStyleEdit()` */
export function styleSnapshot(object: CellDLObject): StyleSnapshot {
    const image = object.svgElement?.querySelector(':scope > image')?.getAttribute('href') ?? undefined
    const rects = boundaryRects(object).map(rect => Object.fromEntries(
        Array.from(rect.attributes).map(attribute => [attribute.name, attribute.value])
    ))
    const saved = Object.fromEntries(STYLE_ATTRIBUTES.map(name => [name, object.svgElement?.getAttribute(name) ?? null]))
    const paths: ConnectionPathArrayMap = new Map()
    for (const connection of objectConnections(object)) {
        const pathElements = (connection.celldlSvgElement as SvgConnection)?.pathElements ?? []
        paths.set(connection.id, structuredClone(pathElements.map(pathElement => pathElement.pathArray)))
    }
    return {
        styling: componentLibraryPlugin.componentStyling(object),
        image,
        rects,
        saved,
        paths
    }
}

/**
 * Undoes and redoes a change to an object's styling, as the Style panel makes
 * it, by restoring just the style fields the change altered, and an element's
 * image as it was drawn, so the saved diagram is as it was.
 *
 * A change still being made, such as a colour picker being dragged, stays
 * `open` and takes in later changes to the same fields until it's committed.
 */
export class StyleUndoState extends UndoState {
    #after: StyleSnapshot
    #before: StyleSnapshot
    #fields: Set<string>
    #object: CellDLObject
    #open: boolean

    constructor(object: CellDLObject, fields: string[], before: StyleSnapshot, after: StyleSnapshot, open: boolean) {
        super(UndoAction.STYLE, object)
        this.#object = object
        this.#fields = new Set(fields)
        this.#before = before
        this.#after = after
        this.#open = open
    }

    get object() {
        return this.#object
    }

    get open() {
        return this.#open
    }

    /** Whether the styling now differs from before the change */
    get changed(): boolean {
        return this.#changedFields().length > 0
    }

    /** Whether a further change to `object`'s `fields` continues this one */
    continues(object: CellDLObject, fields: string[]): boolean {
        return this.#open && object === this.#object
            && fields.length === this.#fields.size && fields.every(field => this.#fields.has(field))
    }

    /** Takes in a further change, closing the step if the change is committed */
    extend(after: StyleSnapshot, open: boolean) {
        this.#after = after
        this.#open = open
    }

    close() {
        this.#open = false
    }

    #changedFields(): (keyof Styling)[] {
        const before = this.#before.styling
        const after = this.#after.styling
        const fields = new Set([...Object.keys(before), ...Object.keys(after)]) as Set<keyof Styling>
        return [...fields].filter(field => before[field] !== after[field])
    }

    async restore(direction: Direction) {
        this.#open = false
        const to = (direction === 'backwards') ? this.#before : this.#after
        const styling: Styling = {}
        for (const field of this.#changedFields()) {
            if (to.styling[field] !== undefined) {
                styling[field] = to.styling[field]
            }
        }
        await componentLibraryPlugin.updatedComponentStyling(this.#object, styling)
        // Redrawn from its styling, what's drawn may not be byte for byte as it was saved
        const svgElement = this.#object.celldlSvgElement
        if (to.image !== undefined && svgElement && styleSnapshot(this.#object).image !== to.image) {
            await svgElement.updateImageElement(to.image)
            svgElement.redraw()
        }
        const rects = boundaryRects(this.#object)
        if (rects.length === to.rects.length) {
            rects.forEach((rect, index) => {
                const attributes: Record<string, string|null> = { ...to.rects[index] }
                for (const name of rect.getAttributeNames()) {
                    if (!Object.hasOwn(attributes, name)) {
                        attributes[name] = null
                    }
                }
                setAttributes(rect, attributes)
            })
        }
        if (this.#object.svgElement) {
            setAttributes(this.#object.svgElement, to.saved)
        }
        for (const connection of objectConnections(this.#object)) {
            setConnectionPathArray(connection, to.paths)
        }
        CellDLEditor.instance?.refreshPropertiesPanel([this.#object])
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
    #group: UndoState[] = []
    #groupDepth = 0
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

    /**
     * Ends a move started with `setMoveUndoState()`, keeping it to undo (and so
     * clearing the redo stack) only if it moved something. A move that didn't,
     * such as a click or a drag back to where it started, is put back as it was.
     *
     * @returns Whether the move moved anything.
     */
    endMove(undoState: MoveUndoState, position: PointLike|undefined): boolean {
        const moved = undoState.endMove(position)
        if (this.#activeUndoState === undoState) {
            this.#activeUndoState = null
            if (moved) {
                this.#pushUndoStack(undoState, false)
            }
        }
        if (!moved) {
            undoState.reposition('backwards')
        }
        return moved
    }

    /**
     * Starts collecting changes to undo as one step, until the matching
     * `endGroup()`. Groups nest: only the outermost one makes an undo step.
     */
    beginGroup() {
        if (this.#groupDepth === 0) {
            this.#group = []
        }
        this.#groupDepth += 1
    }

    /**
     * Ends a group of changes, putting them on the undo stack as one step.
     *
     * @returns Whether the group changed anything.
     */
    endGroup(): boolean {
        if (this.#groupDepth === 0) {
            return false
        }
        this.#groupDepth -= 1
        if (this.#groupDepth > 0) {
            return this.#group.length > 0
        }
        // A move that moved nothing, such as aligning what is already aligned, isn't a change
        const states = this.#group.filter(state => !(state instanceof MoveUndoState) || state.moved)
        this.#group = []
        if (states.length === 0) {
            return false
        }
        // An inserted object is redone as it is now, with its properties set
        for (const state of states) {
            if (state.action === UndoAction.INSERT) {
                state.restoreObjects()
            }
        }
        this.#pushUndoStack(states.length === 1 ? states[0]! : new GroupUndoState(states), false)
        return true
    }

    setDeleteUndoState(undoObject: UndoObject): UndoState {
        return this.#setActiveUndoState(new UndoState(UndoAction.DELETE, undoObject))
    }

    setInsertUndoState(undoObject: UndoObject): UndoState {
        return this.#setActiveUndoState(new UndoState(UndoAction.INSERT, undoObject))
    }

    /**
     * Starts an undoable edit of objects' properties; pass it to `endPropertiesEdit()`
     * once they are edited. Nothing is put on the undo stack (and the redo stack
     * is kept) until the edit is known to have changed something, and the edit is
     * not the active undo state, so a move ending meanwhile can't remove it.
     */
    setPropertiesUndoState(objects: CellDLObject[]): PropertiesUndoState {
        return new PropertiesUndoState(objects)
    }

    /**
     * Ends an edit of objects' properties, keeping it to undo only if it changed them.
     *
     * @returns Whether the edit changed the objects' properties.
     */
    endPropertiesEdit(undoState: PropertiesUndoState): boolean {
        const changed = undoState.endEdit()
        if (changed) {
            if (this.#groupDepth > 0) {
                this.#group.push(undoState)
            } else {
                this.#pushUndoStack(undoState, false)
            }
        }
        return changed
    }

    /**
     * Starts an undoable change to connections' paths; pass it to `endPathsEdit()`
     * once they are changed. As with a properties edit, nothing is put on the undo
     * stack until the paths are known to have changed.
     */
    setPathsUndoState(connections: CellDLConnection[]): PathsUndoState {
        return new PathsUndoState(connections)
    }

    /**
     * Ends a change to connections' paths, keeping it to undo only if it changed them.
     *
     * @returns Whether the change changed any path.
     */
    endPathsEdit(undoState: PathsUndoState): boolean {
        const changed = undoState.endEdit()
        if (changed) {
            if (this.#groupDepth > 0) {
                this.#group.push(undoState)
            } else {
                this.#pushUndoStack(undoState, false)
            }
        }
        return changed
    }

    /**
     * Records a change to an object's styling as an undo step, if it changed
     * anything. A change that continues the open step on top of the undo stack
     * (the same object and fields, e.g. while a colour picker is dragged) is
     * taken into it, so a drag is one step; `open: false` commits the step.
     *
     * @param fields The style fields the change set.
     * @param before The object's styling before the change.
     * @param after Its styling after the change.
     * @param open Whether the change is still being made.
     * @returns Whether an undo step now holds the change.
     */
    recordStyleEdit(object: CellDLObject, fields: string[], before: StyleSnapshot, after: StyleSnapshot, open: boolean): boolean {
        const top = this.#undoStack.at(-1)
        if (top instanceof StyleUndoState && top.continues(object, fields)) {
            top.extend(after, open)
            if (!open && !top.changed) {
                // Dragged back to where it started
                this.#popUndoStack()
                return false
            }
            return true
        }
        if (top instanceof StyleUndoState) {
            top.close()
        }
        const undoState = new StyleUndoState(object, fields, before, after, open)
        if (!undoState.changed) {
            return false
        }
        if (this.#groupDepth > 0) {
            undoState.close()
            this.#group.push(undoState)
        } else {
            this.#pushUndoStack(undoState, false)
        }
        return true
    }

    /** Commits an open style change, so the next change is a step of its own */
    closeStyleEdit() {
        const top = this.#undoStack.at(-1)
        if (top instanceof StyleUndoState) {
            top.close()
        }
    }

    /**
     * Starts an undoable move; pass it to `endMove()` once the move ends. Outside a
     * group, nothing is put on the undo stack (and the redo stack is kept) until the
     * move is known to have moved something, so a click that selects doesn't clear redo.
     */
    setMoveUndoState(undoObject: UndoObject, position: PointLike, selectionSet: SelectionSet|undefined=undefined): MoveUndoState {
        const undoState = new MoveUndoState(undoObject as CellDLObject, position, selectionSet)
        if (this.#groupDepth > 0) {
            this.#group.push(undoState)
        } else {
            this.#activeUndoState = undoState
        }
        return undoState
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
        if (this.#groupDepth > 0) {
            this.#group.push(undoState)
            return undoState
        }
        this.#activeUndoState = undoState
        this.#pushUndoStack(undoState, false)
        return undoState
    }

    redo(diagram: CellDLDiagram) {
        const undoState = this.#popRedoStack()
        if (undoState) {
            this.#pushUndoStack(undoState, true)
            this.#restore(diagram, undoState, 'forwards')
        }
    }

    undo(diagram: CellDLDiagram) {
        const undoState = this.#popUndoStack()
        if (undoState) {
            this.#pushRedoStack(undoState)
            this.#restore(diagram, undoState, 'backwards')
        }
    }

    #restore(diagram: CellDLDiagram, undoState: UndoState, direction: Direction) {
        const restored = this.#apply(diagram, undoState, direction)
        if (restored) {
            // Report the change once the objects are up to date with their RDF
            void restored.finally(notifyChanges)
        } else {
            notifyChanges()
        }
    }

    // Returns a promise when the change is restored asynchronously
    #apply(diagram: CellDLDiagram, undoState: UndoState, direction: Direction): Promise<void>|undefined {
        const backwards = (direction === 'backwards')
        if (undoState.action === UndoAction.DELETE) {
            if (backwards) {
                diagram.undoDelete(undoState)
            } else {
                diagram.undoInsert(undoState)
            }
        } else if (undoState.action === UndoAction.INSERT) {
            if (backwards) {
                diagram.undoInsert(undoState)
            } else {
                diagram.undoDelete(undoState)
            }
        } else if (undoState.action === UndoAction.MOVE) {
            (undoState as MoveUndoState).reposition(direction)
        } else if (undoState.action === UndoAction.PROPERTIES) {
            return (undoState as PropertiesUndoState).restore(direction)
        } else if (undoState.action === UndoAction.PATHS) {
            (undoState as PathsUndoState).restore(direction)
        } else if (undoState.action === UndoAction.STYLE) {
            return (undoState as StyleUndoState).restore(direction)
        } else if (undoState.action === UndoAction.GROUP) {
            const states = (undoState as GroupUndoState).states
            const ordered = backwards ? [...states].reverse() : states
            // In order, waiting for any that is restored asynchronously
            let pending: Promise<void>|undefined
            for (const state of ordered) {
                pending = pending ? pending.then(() => this.#apply(diagram, state, direction))
                                  : this.#apply(diagram, state, direction)
            }
            return pending
        }
        return undefined
    }
}

//==============================================================================

export const undoRedo = UndoRedo.instance

//==============================================================================
