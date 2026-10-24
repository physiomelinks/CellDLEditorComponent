/** biome-ignore-all lint/style/noNonNullAssertion: the fixture's objects are there */

// A labelled compartment gives the stores and sources inside it its label as their location, as part of the edit
// that moved them in, and a location that disagrees with the compartment is listed

import { describe, expect, test } from 'bun:test'

import { RDFS } from '@celldl/rdf'

import { editor, openFixture, settle } from './support/editor'
import { measureSvgRects } from './support/svgRects'

import type { CellDLCompartment } from '#editor/celldlObjects'
import { updateItemProperty } from '#editor/components/properties'
import type { CellDLDiagram } from '#editor/diagram'
import { undoRedo, undoRedoState } from '#editor/diagram/undoredo'
import { Bounds } from '#editor/geometry'
import { boxOf, placeSpatial, resizeCompartment } from '#editor/editor/compartments'
import { compartmentLocations, locationMismatches } from '#editor/editor/locations'
import { componentLibraryPlugin } from '#root/plugins'
import { type BondgraphPlugin, PLUGIN_ID } from '#root/plugins/bondgraph'
import { listElements, setElements } from '#root/plugins/bondgraph/elements'

//==============================================================================

measureSvgRects()

// In the enzyme fixture: stores of S and E, and the reaction r1
const STORE_S = 'ID-00000001'
const STORE_E = 'ID-00000003'
const REACTION = 'ID-00000006'
const JUNCTION_E = 'ID-00000004'

const plugin = () => componentLibraryPlugin.getPlugin(PLUGIN_ID) as BondgraphPlugin

function locationOf(diagram: CellDLDiagram, id: string): string|undefined {
    return plugin().elementLocation(diagram.objectById(id)!)
}

function centreOf(diagram: CellDLDiagram, id: string) {
    return { ...diagram.objectById(id)!.celldlSvgElement!.centroid }
}

function boundsRound(point: { x: number, y: number }, half: number) {
    return new Bounds(point.x - half, point.y - half, point.x + half, point.y + half)
}

/** Labels a compartment, as its Location in Properties does: one undo step */
async function label(compartment: CellDLCompartment, location: string) {
    await editor.editProperties([compartment], async () => {
        updateItemProperty(RDFS.uri('label').value, { oldValue: compartment.label ?? '', newValue: location }, compartment)
    })
    await settle()
}

/** A compartment drawn round the point, labelled, each its own undo step */
async function labelledRound(point: { x: number, y: number }, half: number, location: string) {
    const diagram = editor.celldlDiagram!
    const compartment = placeSpatial(diagram, 'compartment', boundsRound(point, half))
    await settle()
    await label(compartment, location)
    return compartment
}

/** Drags an element from its centre by `by`, as one undo step, and lets its locations follow */
async function drag(diagram: CellDLDiagram, id: string, by: { x: number, y: number }) {
    const object = diagram.objectById(id)!
    const from = centreOf(diagram, id)
    const to = { x: from.x + by.x, y: from.y + by.y }
    const undoState = undoRedo.setMoveUndoState(object, from)
    object.startMove(from)
    object.move(to)
    diagram.objectMoved(object)
    object.endMove()
    object.finaliseMove()
    expect(undoRedo.endMove(undoState, to)).toBe(true)
    await settle()
}

async function undo() {
    editor.undo()
    await settle()
}

async function redo() {
    editor.redo()
    await settle()
}

//==============================================================================

describe('a labelled compartment', () => {
    test('gives the store inside it its label as location, with the labelling as one undo step', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const compartment = placeSpatial(diagram, 'compartment', boundsRound(centreOf(diagram, STORE_E), 60))
        await settle()
        // Unlabelled, it gives none
        expect(locationOf(diagram, STORE_E)).toBe('c')
        await label(compartment, 'm')
        expect(compartment.label).toBe('m')
        expect(locationOf(diagram, STORE_E)).toBe('m')
        // its variables are named by it
        const naming = plugin().namingElements().find(element => element.id.endsWith(STORE_E))
        expect(naming?.location).toBe('m')
        await undo()
        expect(compartment.label).toBeUndefined()
        expect(locationOf(diagram, STORE_E)).toBe('c')
        await redo()
        expect(compartment.label).toBe('m')
        expect(locationOf(diagram, STORE_E)).toBe('m')
    })

    test('leaves reactions and junctions inside it as they are', async () => {
        const diagram = await openFixture('enzyme.celldl')
        await labelledRound(centreOf(diagram, REACTION), 400, 'm')
        expect(compartmentLocations(diagram).has(diagram.objectById(REACTION)!)).toBe(false)
        expect(locationOf(diagram, REACTION)).toBe('c')
        expect(locationOf(diagram, JUNCTION_E)).toBe('c')
        expect(locationOf(diagram, STORE_E)).toBe('m')
    })

    test('drawn round a store and then labelled, and relabelled, renames it each time', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const compartment = await labelledRound(centreOf(diagram, STORE_E), 60, 'm')
        await label(compartment, 'n')
        expect(locationOf(diagram, STORE_E)).toBe('n')
        await undo()
        expect(locationOf(diagram, STORE_E)).toBe('m')
    })

    test('innermost is the one that gives a location', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const centre = centreOf(diagram, STORE_E)
        await labelledRound(centre, 300, 'c2')
        await labelledRound(centre, 60, 'm')
        expect(locationOf(diagram, STORE_E)).toBe('m')
        // one unlabelled inside them gives none
        placeSpatial(diagram, 'compartment', boundsRound(centre, 30))
        await settle()
        expect(locationOf(diagram, STORE_E)).toBe('m')
    })
})

describe('a store', () => {
    test('moved out of every compartment keeps its location, and into another takes that one\'s', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const centre = centreOf(diagram, STORE_E)
        await labelledRound(centre, 40, 'm')
        await labelledRound({ x: centre.x + 400, y: centre.y }, 40, 'c2')
        expect(locationOf(diagram, STORE_E)).toBe('m')

        await drag(diagram, STORE_E, { x: 200, y: 0 })
        expect(locationOf(diagram, STORE_E)).toBe('m')

        await drag(diagram, STORE_E, { x: 200, y: 0 })
        expect(locationOf(diagram, STORE_E)).toBe('c2')
        // the move and its location are one undo step
        await undo()
        expect(centreOf(diagram, STORE_E).x).toBeCloseTo(centre.x + 200, 0)
        expect(locationOf(diagram, STORE_E)).toBe('m')
        await redo()
        expect(locationOf(diagram, STORE_E)).toBe('c2')
        await undo()
        await undo()
        expect(centreOf(diagram, STORE_E).x).toBeCloseTo(centre.x, 0)
        expect(locationOf(diagram, STORE_E)).toBe('m')
    })

    test('inside a compartment resized away from it keeps its location, and one resized round it takes it',
         async () => {
        const diagram = await openFixture('enzyme.celldl')
        const centre = centreOf(diagram, STORE_E)
        const compartment = await labelledRound({ x: centre.x + 300, y: centre.y }, 40, 'm')
        const start = boxOf(compartment)
        const grown = { ...start, x: centre.x - 40, width: start.x + start.width - (centre.x - 40) }
        resizeCompartment(compartment, grown)
        undoRedo.pushChange(compartment, direction => resizeCompartment(compartment, direction === 'backwards' ? start : grown))
        await settle()
        expect(locationOf(diagram, STORE_E)).toBe('m')
        await undo()
        expect(boxOf(compartment)).toEqual(start)
        expect(locationOf(diagram, STORE_E)).toBe('c')
    })

    test('whose location is set by hand inside a compartment keeps it, and is listed as disagreeing', async () => {
        const diagram = await openFixture('enzyme.celldl')
        await labelledRound(centreOf(diagram, STORE_E), 60, 'm')
        await setElements(editor, diagram, [{ id: STORE_E, field: 'location', value: 'x' }])
        await settle()
        expect(locationOf(diagram, STORE_E)).toBe('x')
        const listed = listElements(diagram).find(element => element.id === STORE_E)!
        expect(listed.location).toBe('x')
        expect(listed.compartment).toBe('m')
        expect(locationMismatches(diagram).map(m => [m.object.id, m.location, m.compartment])).toEqual([[STORE_E, 'x', 'm']])
        // one outside every compartment isn't listed with one
        expect(listElements(diagram).find(element => element.id === STORE_S)!.compartment).toBeUndefined()
        // moving it within the compartment keeps it
        await drag(diagram, STORE_E, { x: 10, y: 0 })
        expect(locationOf(diagram, STORE_E)).toBe('x')
    })

    test('added inside a labelled compartment takes its location as part of the adding', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const centre = centreOf(diagram, STORE_E)
        await labelledRound({ x: centre.x, y: centre.y + 400 }, 80, 'm')
        const undoable = undoRedoState.canUndo
        const added = await editor.addPaletteEntry('chemical/store', { x: centre.x, y: centre.y + 400 })
        await settle()
        const store = added[0]!
        expect(plugin().elementLocation(store)).toBe('m')
        await undo()
        expect(diagram.objectById(store.id)).toBeNull()
        expect(undoRedoState.canUndo).toBe(undoable)
    })
})
