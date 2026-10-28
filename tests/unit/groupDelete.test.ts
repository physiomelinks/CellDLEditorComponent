/** biome-ignore-all lint/style/noNonNullAssertion: what a test adds is there */

// Deleting elements, a group of them included, takes them out of the diagram's RDF (so the host's element list and
// the Reactions panel drop them), with undo and redo; no bond is ever added to an element that isn't there; and
// location shading follows every change, an unbonded reaction in its own location included.

import { describe, expect, test } from 'bun:test'

import { countEdits, editor, openFixture, settle } from './support/editor'
import { measureSvgRects } from './support/svgRects'

import type { CellDLConnectedObject, CellDLObject } from '#editor/celldlObjects'
import { MISSING_BOND_END } from '#editor/diagram'
import { undoRedo } from '#editor/diagram/undoredo'
import { notifyChanges } from '#editor/editor'
import { addBond, addElement } from '#editor/editor/placing'
import { addReaction, applyEquation, NEW_REACTION_TYPE, STEP_NOT_IN_DIAGRAM } from '#editor/editor/reactions'
import { diagramLayout, drawRegions, REGION_LAYER_ID } from '#editor/editor/regions'
import { Bounds } from '#editor/geometry'
import { componentLibraryPlugin } from '#root/plugins'
import { listElements } from '#root/plugins/bondgraph/elements'

measureSvgRects()

const BGF = 'https://bg-rdf.org/ontologies/bondgraph-framework#'

function speciesOf(object: CellDLObject): string|undefined {
    return object.rdfStore.query(`SELECT ?s WHERE { ${object.uri.toString()} <${BGF}hasSpecies> ?s }`)[0]?.get('s')?.value
}

// The diagram's listed elements' species, as the host's Parameters tab shows them
function listedSpecies(): string[] {
    return listElements(editor.celldlDiagram).map(e => e.species ?? '').filter(s => s).sort()
}

function stepIds(): string[] {
    return componentLibraryPlugin.reactionEquations().map(eq => eq.id)
}

// A reaction R1: S1[c] ⇌ S2[c], its elements and bonds
async function addR1(): Promise<{ step: string, objects: CellDLObject[] }> {
    const step = await addReaction('S1[c] => S2[c]', 'R1')
    const diagram = editor.celldlDiagram!
    const ids = new Set(['S1', 'S2', 'R1'])
    const components = [...diagram.svgDiagram.querySelectorAll('g.celldl-Component')]
        .map(e => diagram.objectById(e.id)!).filter(o => o && ids.has(speciesOf(o) ?? ''))
    const bonds = components.flatMap(c => (c as CellDLConnectedObject).connections)
    return { step, objects: [...components, ...new Set(bonds)] }
}

function boundsOf(objects: CellDLObject[]): Bounds {
    const points = objects.filter(o => o.isComponent).map(o => o.celldlSvgElement!.centroid)
    const xs = points.map(p => p.x), ys = points.map(p => p.y)
    return new Bounds(Math.min(...xs) - 60, Math.min(...ys) - 60, Math.max(...xs) + 60, Math.max(...ys) + 60)
}

async function undo() { editor.undo(); await settle() }
async function redo() { editor.redo(); await settle() }

describe('deleting elements', () => {
    test('a group of a reaction and its stores, deleted, leaves the RDF, the element list and the steps', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const before = listedSpecies()
        const { step, objects } = await addR1()
        expect(listedSpecies()).toEqual([...before, 'R1', 'S1', 'S2'].sort())
        const group = diagram.groupComponents(boundsOf(objects), objects)
        const edits = countEdits()
        diagram.removeObject(group, undoRedo.setDeleteUndoState(group))
        edits.stop()
        expect(edits.count).toBeGreaterThan(0)
        expect(listedSpecies()).toEqual(before)
        expect(stepIds()).not.toContain(step)
        for (const object of objects) expect(diagram.objectById(object.id)).toBeNull()
        // editing the gone step is refused, and adds nothing
        const count = diagram.svgDiagram.querySelectorAll('.celldl-Connection').length
        await expect(applyEquation(step, 'S1[c] + X[c] => S2[c]')).rejects.toThrow(STEP_NOT_IN_DIAGRAM)
        expect(diagram.svgDiagram.querySelectorAll('.celldl-Connection').length).toBe(count)

        await undo()
        expect(listedSpecies()).toEqual([...before, 'R1', 'S1', 'S2'].sort())
        expect(stepIds()).toContain(step)
        for (const object of objects) {
            expect(diagram.objectById(object.id)).not.toBeNull()
            expect(object.celldlSvgElement!.svgElement.isConnected).toBe(true)
        }
        await redo()
        expect(listedSpecies()).toEqual(before)
        expect(stepIds()).not.toContain(step)
    })

    test('selected elements, deleted together, go, and come back on undo', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const before = listedSpecies()
        const { step, objects } = await addR1()
        editor.selectionSet.clear()
        for (const object of objects.filter(o => o.isComponent)) editor.selectionSet.select(object)
        editor.selectionSet.deleteObjects()
        expect(listedSpecies()).toEqual(before)
        expect(stepIds()).not.toContain(step)
        await undo()
        expect(listedSpecies()).toEqual([...before, 'R1', 'S1', 'S2'].sort())
        expect(stepIds()).toContain(step)
        await redo()
        expect(listedSpecies()).toEqual(before)
        expect(diagram.objectById(objects[0]!.id)).toBeNull()
    })

    test('a single element, deleted, goes with its bonds, and comes back on undo', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const { step, objects } = await addR1()
        const reaction = objects.find(o => speciesOf(o) === 'R1')!
        diagram.removeObject(reaction, undoRedo.setDeleteUndoState(reaction))
        expect(listedSpecies()).not.toContain('R1')
        expect(stepIds()).not.toContain(step)
        await undo()
        expect(stepIds()).toContain(step)
        expect(componentLibraryPlugin.reactionEquations().find(eq => eq.id === step)!.substrates.map(p => p.species))
            .toEqual(['S1'])
        await redo()
        expect(stepIds()).not.toContain(step)
    })
})

describe('no bond to nothing', () => {
    test('a bond to a deleted element is refused, and nothing is drawn', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const a = await addElement(`${BGF}ChemicalStorageNode`, { x: 100, y: 600 }, 'A', 'c')
        const b = await addElement(`${BGF}ChemicalStorageNode`, { x: 300, y: 600 }, 'B', 'c')
        diagram.removeObject(b, undoRedo.setDeleteUndoState(b))
        const count = diagram.svgDiagram.querySelectorAll('.celldl-Connection').length
        expect(() => addBond(a, b)).toThrow(MISSING_BOND_END)
        expect(diagram.svgDiagram.querySelectorAll('.celldl-Connection').length).toBe(count)
        expect(a.connections.length).toBe(0)
    })
})

describe('location shading follows changes', () => {
    test('an unbonded reaction is shaded in its own location, along with a store there', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const store = await addElement(`${BGF}ChemicalStorageNode`, { x: 100, y: 700 }, 'S1', 'c')
        const reaction = await addElement(NEW_REACTION_TYPE, { x: 400, y: 700 }, 'R1', 'c')
        const labels = new Map(diagramLayout().nodes.map(n => [n.id, n.labels]))
        expect(labels.get(store.uri.value)).toEqual(['c'])
        expect(labels.get(reaction.uri.value)).toEqual(['c'])
        drawRegions()
        const region = diagram.svgDiagram.getElementById(REGION_LAYER_ID)!.querySelector('rect[data-region="c"], path[data-region="c"]')
        expect(region).not.toBeNull()
        if (region!.tagName === 'rect') {
            const x1 = Number(region!.getAttribute('x')) + Number(region!.getAttribute('width'))
            expect(x1).toBeGreaterThan(reaction.celldlSvgElement!.centroid.x)
        }
    })

    test('a burst of changes redraws once, in the next frame, and a delete or undo redraws', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const layer = () => diagram.svgDiagram.getElementById(REGION_LAYER_ID)
        const frame = () => new Promise(resolve => setTimeout(resolve, 250))
        await frame()
        layer()?.remove()
        for (let n = 0; n < 20; n += 1) notifyChanges()
        await frame()
        expect(layer()).not.toBeNull()
        const reaction = await addElement(NEW_REACTION_TYPE, { x: 900, y: 900 }, 'Rx', 'q')
        await frame()
        expect(layer()!.querySelector('[data-region="q"]')).not.toBeNull()
        diagram.removeObject(reaction, undoRedo.setDeleteUndoState(reaction))
        await frame()
        expect(layer()!.querySelector('[data-region="q"]')).toBeNull()
        await undo()
        await frame()
        expect(layer()!.querySelector('[data-region="q"]')).not.toBeNull()
    })
})
