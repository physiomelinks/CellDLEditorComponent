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

// Editing a bond graph through its reaction equations (the Reactions panel). An edited equation becomes bond
// changes (./plugins/bondgraph/equations.ts: planEquationEdit): a changed coefficient sets its bond's bgf:bondCount,
// a removed species deletes its bond (and its chemostat copy, if no other step uses it), and an added species is
// bonded to its store; a species the diagram has no store for gets a new one, a chemostat a new copy beside the
// step, and a new equation a new reaction. New elements are placed beside the step, substrates to its left and
// products to its right, with the palette's defaults (./placing.ts): parameters 1, an initial value 0, the diagram's
// most used location when the equation gives none, and an unused name (R1, R2, ...) for an unnamed reaction.

import type * as $rdf from '@celldl/rdf'

import type { CellDLConnectedObject, CellDLConnection, CellDLObject } from '#editor/celldlObjects'
import { undoRedo } from '#editor/diagram/undoredo'

import {
    type EquationEdit, findSpeciesNode, parseEquation, planEquationEdit, type Side, speciesNameError, type SpeciesNode,
    type StepEquation
} from '#root/plugins/bondgraph/equations'
import { Point, type PointLike } from '#root/utils/points'

import { notifyChanges } from '.'
import {
    addBond, addElement as placeElement, asOneStep, bondgraphPlugin, centroidOf, defaultLocation, editorParts, nextName,
    usedNames
} from './placing'

//==============================================================================

const BGF = 'https://bg-rdf.org/ontologies/bondgraph-framework#'
/** Why a step's equation can't be edited: its reaction or flow element has been deleted. */
export const STEP_NOT_IN_DIAGRAM = 'That step is no longer in the diagram'

export const NEW_STORE_TYPE = `${BGF}ChemicalStorageNode`
export const NEW_REACTION_TYPE = `${BGF}ChemicalReactionNode`

const BESIDE = 120          // from a step to a new participant
const SPACING = 70          // between new participants on one side
const CLEARANCE = 40        // from other components

//==============================================================================

function objectByUri(uri: string): CellDLObject|null {
    const { diagram } = editorParts()
    return diagram.objectById(uri.split('#').pop() ?? uri)
}

function componentCentroids(): Point[] {
    const { diagram } = editorParts()
    const points: Point[] = []
    for (const element of diagram.svgDiagram.querySelectorAll('g.celldl-Component')) {
        const object = diagram.objectById(element.id)
        if (object?.celldlSvgElement) points.push(object.celldlSvgElement.centroid)
    }
    return points
}

/** The first free place beside `centre`, left of it for a substrate and right for a product. */
function placeBeside(centre: PointLike, side: Side|'step', taken: Point[]): Point {
    const dx = side === 'substrate' ? -BESIDE : side === 'product' ? BESIDE : 0
    for (let k = 0; k < 40; k += 1) {
        const dy = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * SPACING
        const point = new Point(centre.x + dx, centre.y + dy)
        if (taken.every(t => Math.hypot(t.x - point.x, t.y - point.y) > CLEARANCE)) {
            taken.push(point)
            return point
        }
    }
    return new Point(centre.x + dx, centre.y)
}

//==============================================================================

async function addElement(elementType: string, centre: PointLike, species?: string, location?: string,
                          value?: $rdf.Literal): Promise<CellDLConnectedObject> {
    const where = location ?? defaultLocation(usedNames().locations)
    const object = await placeElement(elementType, centre, species, where, value)
    if (!value) {
        added.push(`${elementType === NEW_REACTION_TYPE ? 'reaction' : 'store'} ${species ?? object.id}[${where}]`)
    }
    return object
}

// An object removed so that undo puts it back
function removeObject(object: CellDLObject) {
    const { diagram } = editorParts()
    diagram.removeObject(object, undoRedo.setDeleteUndoState(object))
}

// The elements added since the last call of takeAddedElements(), whose values start at the defaults
const added: string[] = []

/** The new elements an edit made (e.g. `store Xnew[c]`), whose values are the defaults until the user sets them. */
export function takeAddedElements(): string[] {
    return added.splice(0)
}

/** A potential source's type and value, to copy it beside another step. */
function sourceCopy(node: SpeciesNode): { type: string, value?: $rdf.Literal } {
    const object = objectByUri(node.id)
    const type = object ? bondgraphPlugin().elementType(object) : undefined
    const value = object?.rdfStore.query(`
        SELECT ?value WHERE { <${node.id}> <${BGF}hasValue> ?value }`)[0]?.get('value') as $rdf.Literal|undefined
    return { type: type ?? `${BGF}ChemicalPotential`, value }
}

async function applyEdit(step: CellDLConnectedObject, current: StepEquation, edit: EquationEdit, taken: Point[]) {
    const plugin = bondgraphPlugin()
    if (edit.op === 'count') {
        const bond = objectByUri(edit.bond)
        if (bond?.isConnection) {
            const undoState = undoRedo.setPropertiesUndoState([bond])
            plugin.setBondCount(bond as CellDLConnection, edit.count)
            undoRedo.endPropertiesEdit(undoState)
        }
    } else if (edit.op === 'remove') {
        const bond = objectByUri(edit.bond)
        if (bond) removeObject(bond)
        // a chemostat copy no other step uses goes too
        const node = edit.node ? objectByUri(edit.node) : null
        const isSource = plugin.speciesNodes().some(n => n.id === edit.node && n.isSource)
        if (node && isSource && (node as CellDLConnectedObject).connections.length === 0) {
            removeObject(node)
        }
    } else {
        const found = findSpeciesNode(plugin.speciesNodes(), edit.species, edit.location)
        const location = edit.location ?? found?.location
        // a step drawn with side junctions is bonded through them, and a store drawn with its species' 0-junction
        // through that, which takes any number of bonds
        const sideJunction = current.sides?.[edit.side]
        const joinTo = (sideJunction ? objectByUri(sideJunction) : null) as CellDLConnectedObject|null
        let node: CellDLConnectedObject|null = null
        if (found && !found.isSource) {
            node = objectByUri(plugin.speciesJunction(found.id) ?? found.id) as CellDLConnectedObject|null
        }
        if (!node) {
            const place = placeBeside(centroidOf(step), edit.side, taken)
            if (found) {
                const copy = sourceCopy(found)
                node = await addElement(copy.type, place, edit.species, location, copy.value)
            } else {
                node = await addElement(NEW_STORE_TYPE, place, edit.species, location ?? stepLocation(step))
            }
        }
        const target = joinTo ?? step
        if (edit.side === 'substrate') addBond(node, target, edit.count)
        else addBond(target, node, edit.count)
    }
}

function stepLocation(step: CellDLObject): string|undefined {
    const location = step.rdfStore.query(`
        SELECT ?location WHERE { <${step.uri.value}> <${BGF}hasLocation> ?location }`)[0]?.get('location')
    return location?.value
}

//==============================================================================

/**
 * Make the step `stepUri` follow the equation `text`, as one undoable step; returns the number of bond changes.
 * Throws an Error with a message for the user when the equation cannot be read or placed.
 */
export function applyEquation(stepUri: string, text: string): Promise<number> {
    return asOneStep(() => followEquation(stepUri, text))
}

async function followEquation(stepUri: string, text: string): Promise<number> {
    const current = bondgraphPlugin().reactionEquations().find(eq => eq.id === stepUri)
    const step = objectByUri(stepUri) as CellDLConnectedObject|null
    // refused before anything changes, so no bond goes to a deleted step
    if (!current || !step || !editorParts().diagram.hasConnector(step.uri)) {
        throw new Error(STEP_NOT_IN_DIAGRAM)
    }
    const edits = planEquationEdit(current, parseEquation(text))
    // check every added species can be placed before changing anything
    for (const edit of edits) {
        if (edit.op === 'add') findSpeciesNode(bondgraphPlugin().speciesNodes(), edit.species, edit.location)
    }
    const taken = componentCentroids()
    for (const edit of edits) {
        await applyEdit(step, current, edit, taken)
    }
    if (edits.length) notifyChanges()     // a changed bondCount alone touches only the RDF
    return edits.length
}

/**
 * Add a reaction following the equation `text`, named `name` (its species label), below the diagram's other
 * components, as one undoable step; returns its URI.
 */
export async function addReaction(text: string, name: string, location?: string): Promise<string> {
    const nameError = name ? speciesNameError(name) : ''
    if (nameError) throw new Error(nameError)
    const parsed = parseEquation(text)
    for (const p of [...parsed.substrates, ...parsed.products]) {
        findSpeciesNode(bondgraphPlugin().speciesNodes(), p.species, p.location)
    }
    return asOneStep(async () => {
        const taken = componentCentroids()
        const below = taken.length ? Math.max(...taken.map(p => p.y)) + 2 * BESIDE : 100
        const middle = taken.length ? taken.reduce((x, p) => x + p.x, 0) / taken.length : 200
        const step = await addElement(NEW_REACTION_TYPE, placeBeside(new Point(middle, below), 'step', taken),
                                      name || nextName('R', usedNames().species),
                                      location ?? parsed.substrates[0]?.location)
        await followEquation(step.uri.value, text)
        notifyChanges()
        return step.uri.value
    })
}

//==============================================================================
//==============================================================================
