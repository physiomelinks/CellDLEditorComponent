/** biome-ignore-all lint/style/noNonNullAssertion: the fixture's objects are there */

// A move's undo step: a click or a drag back to where it started records none, and keeps redo

import { describe, expect, test } from 'bun:test'

import { editor, openFixture, settle } from './support/editor'

import type { CellDLDiagram } from '#editor/diagram'
import { undoRedo, undoRedoState } from '#editor/diagram/undoredo'
import { setElements } from '#root/plugins/bondgraph/elements'

//==============================================================================

// In the enzyme fixture
const STORE_S = 'ID-00000001'
const STORE_E = 'ID-00000003'

/** Makes an edit and undoes it, so there is something to redo */
async function editAndUndo(diagram: CellDLDiagram) {
    await setElements(editor, diagram, [{ id: STORE_S, field: 'species', value: 'Glc' }])
    editor.undo()
    await settle()
    expect(undoRedoState.canRedo).toBe(true)
}

/** Moves an object by pointer from `from` to `to`, as a drag does, ending the move's undo step */
function drag(diagram: CellDLDiagram, id: string, from: { x: number, y: number }, ...to: { x: number, y: number }[]) {
    const object = diagram.objectById(id)!
    const undoState = undoRedo.setMoveUndoState(object, from)
    object.startMove(from)
    for (const point of to) {
        object.move(point)
        diagram.objectMoved(object)
    }
    object.endMove()
    object.finaliseMove()
    return undoRedo.endMove(undoState, to.at(-1) ?? from)
}

//==============================================================================

describe('a move', () => {
    test('that doesn\'t move, as a click to select, records no edit and keeps redo', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const before = await diagram.rdf()
        await editAndUndo(diagram)
        const undoable = undoRedoState.canUndo
        expect(drag(diagram, STORE_E, { x: 10, y: 10 })).toBe(false)
        expect(undoRedoState.canRedo).toBe(true)
        expect(undoRedoState.canUndo).toBe(undoable)
        expect(await diagram.rdf()).toBe(before)
        editor.redo()
        await settle()
        expect(await diagram.rdf()).toContain('Glc')
    })

    test('that ends where it started records no edit and keeps redo', async () => {
        const diagram = await openFixture('enzyme.celldl')
        await editAndUndo(diagram)
        const undoable = undoRedoState.canUndo
        expect(drag(diagram, STORE_E, { x: 10, y: 10 }, { x: 40, y: 30 }, { x: 10, y: 10 })).toBe(false)
        expect(undoRedoState.canRedo).toBe(true)
        expect(undoRedoState.canUndo).toBe(undoable)
    })

    test('whose pointer moved but that left everything where it was records no edit and keeps redo', async () => {
        const diagram = await openFixture('enzyme.celldl')
        await editAndUndo(diagram)
        const undoable = undoRedoState.canUndo
        const object = diagram.objectById(STORE_E)!
        const start = { ...object.celldlSvgElement!.centroid }
        // As when a short drag snaps back to the same grid point
        const undoState = undoRedo.setMoveUndoState(object, { x: 10, y: 10 })
        expect(undoRedo.endMove(undoState, { x: 12, y: 11 })).toBe(false)
        expect(undoRedoState.canRedo).toBe(true)
        expect(undoRedoState.canUndo).toBe(undoable)
        expect({ ...object.celldlSvgElement!.centroid }).toEqual(start)
    })

    test('that moves is one undo step, and clears redo', async () => {
        const diagram = await openFixture('enzyme.celldl')
        await editAndUndo(diagram)
        const object = diagram.objectById(STORE_E)!
        const start = { ...object.celldlSvgElement!.centroid }
        expect(drag(diagram, STORE_E, { x: 10, y: 10 }, { x: 40, y: 30 })).toBe(true)
        expect(undoRedoState.canRedo).toBe(false)
        expect(undoRedoState.canUndo).toBe(true)
        const moved = { ...object.celldlSvgElement!.centroid }
        expect(moved).not.toEqual(start)

        editor.undo()
        await settle()
        expect({ ...object.celldlSvgElement!.centroid }).toEqual(start)
        expect(undoRedoState.canRedo).toBe(true)
        editor.redo()
        await settle()
        expect({ ...object.celldlSvgElement!.centroid }).toEqual(moved)
    })

    test('in a group that moves nothing adds no undo step', async () => {
        const diagram = await openFixture('enzyme.celldl')
        await editAndUndo(diagram)
        const object = diagram.objectById(STORE_E)!
        undoRedo.beginGroup()
        const undoState = undoRedo.setMoveUndoState(object, { x: 5, y: 5 })
        undoState.endMove({ x: 5, y: 5 })
        expect(undoRedo.endGroup()).toBe(false)
        expect(undoRedoState.canRedo).toBe(true)
    })
})
