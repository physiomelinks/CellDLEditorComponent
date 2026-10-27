/** biome-ignore-all lint/style/noNonNullAssertion: the fixture's objects are there */

// Aligning and distributing straightens the bonds between arranged components, in the same undo step

import { describe, expect, test } from 'bun:test'
import type { NormalArray } from 'svg-path-commander'

import { editor, fixture, openFixture, settle } from './support/editor'
import { measureSvgRects } from './support/svgRects'

import type { CellDLConnection, CellDLObject } from '#editor/celldlObjects'
import { CellDLDiagram } from '#editor/diagram'
import { undoRedoState } from '#editor/diagram/undoredo'
import { bondsWithin } from '#editor/editor/arrange'
import { addBond } from '#editor/editor/placing'
import type { SvgConnection } from '#editor/SVGElements/svgconnection'
import { placeEntry } from '#root/plugins/bondgraph/palette'

//==============================================================================

// In the enzyme fixture: uS -> vr1f (a 1-junction) -> r1 -> vr1r
const US = 'ID-00000002'
const VR1F = 'ID-00000005'
const R1 = 'ID-00000006'
const VR1R = 'ID-00000007'

const svgConnection = (bond: CellDLConnection) => bond.celldlSvgElement as SvgConnection
const paths = (bond: CellDLConnection) => svgConnection(bond).pathElements.map(p => JSON.stringify(p.pathArray))
const pointCount = (bond: CellDLConnection) => svgConnection(bond).pathElements[0]!.pathArray.length
const controlPoints = (bond: CellDLConnection) => JSON.stringify(svgConnection(bond).pathElements[0]!.pathArray.slice(1, -1))
const centroid = (object: CellDLObject) => ({ ...object.celldlSvgElement!.centroid })

function bondBetween(diagram: CellDLDiagram, a: string, b: string): CellDLConnection {
    const [first, second] = [diagram.objectById(a)!, diagram.objectById(b)!]
    const bond = (first as unknown as { connections: CellDLConnection[] }).connections
        .find(c => c.connectedObjects.includes(second as never))
    if (!bond) throw new Error(`No bond between ${a} and ${b}`)
    return bond
}

/** Bends a bond through the given points, as dragging its line does */
function bend(bond: CellDLConnection, ...through: { x: number, y: number }[]) {
    const pathElement = svgConnection(bond).pathElements[0]!
    const pathArray = pathElement.pathArray
    const [start, end] = [pathArray.at(0)!, pathArray.at(-1)!]
    pathElement.setPathPoints([
        ['M', start.at(-2), start.at(-1)],
        ...through.map(p => ['L', p.x, p.y]),
        ['L', end.at(-2), end.at(-1)]
    ] as NormalArray)
    pathElement.redraw()
    expect(pointCount(bond)).toBe(through.length + 2)
}

function select(diagram: CellDLDiagram, ...ids: string[]) {
    editor.selectionSet.clear()
    for (const id of ids) {
        editor.selectionSet.select(diagram.objectById(id)!)
    }
}

/** Moves an object so it's out of line with the others */
function offset(diagram: CellDLDiagram, id: string, dy: number) {
    const object = diagram.objectById(id)!
    const start = centroid(object)
    object.startMove(start)
    object.move({ x: start.x, y: start.y + dy })
    object.endMove()
    object.finaliseMove()
    diagram.objectMoved(object)
}

//==============================================================================

describe('bondsWithin', () => {
    const a = { connections: [] as { connectedObjects: unknown[] }[] }
    const b = { connections: [] as { connectedObjects: unknown[] }[] }
    const c = { connections: [] as { connectedObjects: unknown[] }[] }
    const ab = { connectedObjects: [a, b] }
    const bc = { connectedObjects: [b, c] }
    const aViaCtoB = { connectedObjects: [a, c, b] }
    a.connections.push(ab, aViaCtoB)
    b.connections.push(ab, bc, aViaCtoB)
    c.connections.push(bc)

    test('is the bonds with both ends among the objects, once each', () => {
        expect(bondsWithin([a, b])).toEqual([ab, aViaCtoB])
    })
    test('leaves out a bond with only one end among them', () => {
        expect(bondsWithin([a, b])).not.toContain(bc)
        expect(bondsWithin([a, c])).toEqual([])
    })
})

describe('aligning', () => {
    test('straightens the bonds between aligned components, keeps others\' bends, and undoes as one step', async () => {
        const diagram = await openFixture('enzyme.celldl')
        offset(diagram, VR1F, 60)
        const [b1, b2, b3] = [bondBetween(diagram, US, VR1F), bondBetween(diagram, VR1F, R1), bondBetween(diagram, R1, VR1R)]
        const c = (id: string) => centroid(diagram.objectById(id)!)
        bend(b1, { x: c(US).x + 10, y: c(US).y + 80 })
        bend(b2, { x: c(R1).x - 20, y: c(R1).y + 70 }, { x: c(R1).x - 10, y: c(R1).y + 40 })
        bend(b3, { x: c(R1).x + 20, y: c(R1).y - 50 })
        const before = [b1, b2, b3].map(paths)
        const bendOfB3 = controlPoints(b3)
        const positions = [US, VR1F, R1, VR1R].map(c)

        select(diagram, US, VR1F, R1)
        expect(editor.arrangeSelection('middle')).toBe(true)
        expect(c(VR1F).y).toBeCloseTo(c(US).y, 6)
        expect(pointCount(b1)).toBe(2)
        expect(pointCount(b2)).toBe(2)
        expect(paths(b3)).not.toEqual(before[2])         // its arranged end moved
        expect(pointCount(b3)).toBe(3)                    // ...but it keeps its bend
        expect(controlPoints(b3)).toBe(bendOfB3)
        const after = [b1, b2, b3].map(paths)
        const arranged = [US, VR1F, R1, VR1R].map(c)

        editor.undo()
        await settle()
        expect([US, VR1F, R1, VR1R].map(c)).toEqual(positions)
        expect([b1, b2, b3].map(paths)).toEqual(before)
        editor.redo()
        await settle()
        expect([US, VR1F, R1, VR1R].map(c)).toEqual(arranged)
        expect([b1, b2, b3].map(paths)).toEqual(after)
    })

    test('what is already aligned, but with a bent bond, is one undo step that only straightens', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const bond = bondBetween(diagram, US, VR1F)
        const c = centroid(diagram.objectById(US)!)
        bend(bond, { x: c.x + 20, y: c.y + 40 }, { x: c.x + 40, y: c.y + 30 })
        const before = paths(bond)
        const positions = [US, VR1F, R1].map(id => centroid(diagram.objectById(id)!))

        select(diagram, US, VR1F, R1)
        expect(editor.arrangeSelection('middle')).toBe(true)
        expect([US, VR1F, R1].map(id => centroid(diagram.objectById(id)!))).toEqual(positions)
        expect(pointCount(bond)).toBe(2)
        const straight = paths(bond)
        expect(undoRedoState.canUndo).toBe(true)
        expect(undoRedoState.canRedo).toBe(false)

        editor.undo()
        await settle()
        expect(paths(bond)).toEqual(before)
        expect(undoRedoState.canRedo).toBe(true)
        editor.redo()
        await settle()
        expect(paths(bond)).toEqual(straight)
    })

    test('when nothing would change records nothing', async () => {
        const diagram = await openFixture('enzyme.celldl')
        offset(diagram, VR1F, 60)
        const offsetPosition = centroid(diagram.objectById(VR1F)!)
        select(diagram, US, VR1F, R1)
        expect(editor.arrangeSelection('middle')).toBe(true)
        expect(centroid(diagram.objectById(VR1F)!)).not.toEqual(offsetPosition)
        select(diagram, US, VR1F, R1)
        expect(editor.arrangeSelection('middle')).toBe(false)
        // so one undo takes back the align that did something
        editor.undo()
        await settle()
        expect(centroid(diagram.objectById(VR1F)!)).toEqual(offsetPosition)
    })

    test('distributing straightens too', async () => {
        const diagram = await openFixture('enzyme.celldl')
        offset(diagram, VR1F, 0)
        const bond = bondBetween(diagram, VR1F, R1)
        const c = centroid(diagram.objectById(R1)!)
        bend(bond, { x: c.x - 30, y: c.y - 50 })
        select(diagram, US, VR1F, R1)
        editor.arrangeSelection('distribute-h')
        expect(pointCount(bond)).toBe(2)
    })
})

describe('aligning composite elements', () => {
    test('straightens a bent bond between a species and a reaction node', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const [s1] = await placeEntry('chemical/species', { x: 100, y: 500 })
        const [rx] = await placeEntry('chemical/reaction-node', { x: 260, y: 540 })
        const [s2] = await placeEntry('chemical/species', { x: 420, y: 500 })
        const into = addBond(s1 as never, rx as never) as CellDLConnection
        const out = addBond(rx as never, s2 as never) as CellDLConnection
        const r = centroid(rx!)
        bend(into, { x: r.x - 80, y: r.y + 60 })
        bend(out, { x: r.x + 80, y: r.y - 80 })
        const before = [into, out].map(paths)

        select(diagram, s1!.id, rx!.id, s2!.id)
        expect(editor.arrangeSelection('middle')).toBe(true)
        expect(centroid(rx!).y).toBeCloseTo(centroid(s1!).y, 6)
        expect(pointCount(into)).toBe(2)
        expect(pointCount(out)).toBe(2)
        editor.undo()
        await settle()
        expect([into, out].map(paths)).toEqual(before)
    })
})

//==============================================================================

const ends = (bond: CellDLConnection) => {
    const pathArray = svgConnection(bond).pathElements[0]!.pathArray
    const [start, end] = [pathArray.at(0)!, pathArray.at(-1)!]
    return { start: { x: start.at(-2) as number, y: start.at(-1) as number }, end: { x: end.at(-2) as number, y: end.at(-1) as number } }
}
const slope = (bond: CellDLConnection) => { const { start, end } = ends(bond); return end.y - start.y }

/** Moves an object down by a few pixels, off the grid */
function nudge(diagram: CellDLDiagram, id: string, dy: number) {
    const object = diagram.objectById(id)!
    const start = centroid(object)
    object.reposition(start, { x: start.x, y: start.y + dy }, { noAlign: true })
    object.finaliseMove()
    diagram.objectMoved(object)
}

/** The enzyme fixture with its elements' images sized, as a browser measures them */
async function openSizedEnzyme(): Promise<CellDLDiagram> {
    const sized = fixture('enzyme.celldl').replaceAll('<image href=', '<image x="-22" y="-15" width="44" height="30" href=')
    const diagram = new CellDLDiagram('enzyme.celldl', sized, editor)
    await editor.editDiagram(diagram)
    return diagram
}

describe('aligning centres', () => {
    measureSvgRects()

    test('puts a row of different elements\' centres on one line, and their straight bonds exactly level', async () => {
        const diagram = await openFixture('enzyme.celldl')
        // As in the report: a species, a reaction with sides, and a species, slightly out of line
        const [s1] = await placeEntry('chemical/species', { x: 100, y: 600 })
        const side = await placeEntry('chemical/reaction-sides', { x: 300, y: 605 })
        const [s2] = await placeEntry('chemical/species', { x: 520, y: 597 })
        const components = side.filter(object => !object.isConnection)
        const byX = [...components].sort((a, b) => centroid(a).x - centroid(b).x)
        const [reactants, products] = [byX[0]!, byX.at(-1)!]
        const into = addBond(s1 as never, reactants as never) as CellDLConnection
        const out = addBond(products as never, s2 as never) as CellDLConnection
        const row = [s1!, ...components, s2!]
        const bonds = [into, out, ...side.filter(object => object.isConnection) as CellDLConnection[]]
        expect(bonds.some(bond => Math.abs(slope(bond)) > 1)).toBe(true)

        select(diagram, ...row.map(object => object.id))
        expect(editor.arrangeSelection('middle')).toBe(true)
        const y = centroid(s1!).y
        expect(row.map(object => centroid(object).y)).toEqual(row.map(() => y))
        for (const bond of bonds) {
            expect(pointCount(bond)).toBe(2)
            expect(slope(bond)).toBe(0)
        }
        // Again changes nothing, and records nothing
        select(diagram, ...row.map(object => object.id))
        expect(editor.arrangeSelection('middle')).toBe(false)
    })

    test('redraws a straight bond to an element left out between centres', async () => {
        const diagram = await openFixture('enzyme.celldl')
        offset(diagram, R1, 40)
        const bond = bondBetween(diagram, R1, VR1R)          // straight, with only r1 being aligned
        expect(pointCount(bond)).toBe(2)
        select(diagram, US, VR1F, R1)
        expect(editor.arrangeSelection('middle')).toBe(true)
        const [r, v] = [centroid(diagram.objectById(R1)!), centroid(diagram.objectById(VR1R)!)]
        const { start, end } = ends(bond)
        // Both ends lie on the line between the two centroids
        const across = (p: { x: number, y: number }) => (p.x - r.x) * (v.y - r.y) - (p.y - r.y) * (v.x - r.x)
        expect(Math.abs(across(start)) / Math.hypot(v.x - r.x, v.y - r.y)).toBeLessThan(1e-3)
        expect(Math.abs(across(end)) / Math.hypot(v.x - r.x, v.y - r.y)).toBeLessThan(1e-3)
    })

    test('squares up a nearly level bond between aligned elements, as part of the same undo step', async () => {
        const diagram = await openSizedEnzyme()
        nudge(diagram, VR1F, 4)                               // within the tolerance of level
        const bond = bondBetween(diagram, US, VR1F)
        bend(bond, { x: centroid(diagram.objectById(US)!).x + 30, y: centroid(diagram.objectById(US)!).y + 30 })
        const before = paths(bond)
        const positions = [US, VR1F, R1].map(id => centroid(diagram.objectById(id)!))
        select(diagram, US, VR1F, R1)
        expect(editor.arrangeSelection('distribute-h')).toBe(true)
        // Distributing doesn't move anything across, so the centres stay 4px apart
        expect(centroid(diagram.objectById(VR1F)!).y - centroid(diagram.objectById(US)!).y).toBeCloseTo(4, 6)
        expect(pointCount(bond)).toBe(2)
        expect(slope(bond)).toBe(0)
        expect(slope(bondBetween(diagram, VR1F, R1))).toBe(0)
        editor.undo()
        await settle()
        expect([US, VR1F, R1].map(id => centroid(diagram.objectById(id)!))).toEqual(positions)
        expect(paths(bond)).toEqual(before)
    })

    test('leaves a bond further from level than the tolerance sloping', async () => {
        const diagram = await openSizedEnzyme()
        nudge(diagram, VR1F, 10)
        const bond = bondBetween(diagram, US, VR1F)
        select(diagram, US, VR1F, R1)
        editor.arrangeSelection('distribute-h')
        expect(Math.abs(slope(bond))).toBeGreaterThan(1)
    })
})

describe('the Straighten action', () => {
    test('removes the bends of a selected bond as one undo step, and is offered only when there are bends', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const bond = bondBetween(diagram, VR1F, R1)
        select(diagram, bond.id)
        expect(editor.canStraighten()).toBe(false)
        expect(editor.straightenSelection()).toBe(false)
        expect(undoRedoState.canUndo).toBe(false)

        const c = centroid(diagram.objectById(R1)!)
        bend(bond, { x: c.x - 30, y: c.y + 40 }, { x: c.x - 10, y: c.y + 50 })
        const before = paths(bond)
        const positions = [VR1F, R1].map(id => centroid(diagram.objectById(id)!))
        select(diagram, bond.id)
        expect(editor.canStraighten()).toBe(true)
        expect(editor.straightenSelection()).toBe(true)
        expect(pointCount(bond)).toBe(2)
        expect([VR1F, R1].map(id => centroid(diagram.objectById(id)!))).toEqual(positions)
        expect(editor.canStraighten()).toBe(false)
        const straight = paths(bond)
        editor.undo()
        await settle()
        expect(paths(bond)).toEqual(before)
        expect(undoRedoState.canRedo).toBe(true)
        editor.redo()
        await settle()
        expect(paths(bond)).toEqual(straight)
    })

    test('straightens the bonds between selected elements, not those leaving them', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const [inside, leaving] = [bondBetween(diagram, US, VR1F), bondBetween(diagram, R1, VR1R)]
        const c = centroid(diagram.objectById(VR1F)!)
        bend(inside, { x: c.x - 30, y: c.y + 40 })
        bend(leaving, { x: c.x + 120, y: c.y - 40 })
        const leavingBefore = paths(leaving)
        select(diagram, US, VR1F, R1)
        expect(editor.canStraighten()).toBe(true)
        expect(editor.straightenSelection()).toBe(true)
        expect(pointCount(inside)).toBe(2)
        expect(paths(leaving)).toEqual(leavingBefore)
        editor.undo()
        await settle()
        expect(pointCount(inside)).toBe(3)
    })
})
