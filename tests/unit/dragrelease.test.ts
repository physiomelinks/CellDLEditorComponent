/** biome-ignore-all lint/style/noNonNullAssertion: the fixture's objects are there */

// A component's drag ends cleanly wherever the pointer is released, and Undo and Redo move it back and forth
// between where it was drawn (src/CellDL/editor/index.ts, src/CellDL/diagram/undoredo.ts). The headless DOM
// has no layout, so components don't move here: a browser check covers what is drawn.

import { afterEach, describe, expect, test } from 'bun:test'

import { editor, openFixture } from './support/editor'

import type { CellDLObject } from '#editor/celldlObjects'
import { MoveUndoState, undoRedoState } from '#editor/diagram/undoredo'
import type { ElementMoveOptions } from '#editor/SVGElements'

// In the enzyme fixture, u_S is a 0-junction bonded to r1 and r2
const U_S = 'ID-00000002'

// Somewhere outside the canvas, as the palette above it is
const outside = document.createElement('div')
document.body.appendChild(outside)

const element = (id: string) => document.getElementById(id)!

const pointer = (type: string, x: number, y: number, buttons = 1) =>
    new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, buttons, pointerId: 1 })

const pressEscape = () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

/** Presses on a component and drags it in the canvas */
async function startDrag() {
    await openFixture('enzyme.celldl')
    expect(undoRedoState.canUndo).toBe(false)
    element(U_S).dispatchEvent(pointer('pointerover', 10, 10, 0))
    element(U_S).dispatchEvent(pointer('pointerdown', 10, 10))
    element(U_S).dispatchEvent(pointer('pointermove', 30, 20))
    element(U_S).dispatchEvent(pointer('pointermove', 50, 40))
    expect(editor.dragging).toBe(true)
}

afterEach(() => {
    // Leave no press outstanding for the next test
    document.body.dispatchEvent(pointer('pointerup', 0, 0, 0))
})

describe('A drag released outside the canvas', () => {
    test('ends as a move, with an undo step', async () => {
        await startDrag()
        // Out over the palette and released there, which the canvas doesn't see
        outside.dispatchEvent(pointer('pointermove', 600, -20))
        outside.dispatchEvent(pointer('pointerup', 600, -20, 0))
        expect(editor.dragging).toBe(false)
        expect(undoRedoState.canUndo).toBe(true)
        // Coming back over the canvas and released again starts nothing
        element(U_S).dispatchEvent(pointer('pointermove', 10, 10, 0))
        element(U_S).dispatchEvent(pointer('pointerup', 10, 10, 0))
        expect(editor.dragging).toBe(false)
        editor.undo()
        expect(undoRedoState.canUndo).toBe(false)
        expect(undoRedoState.canRedo).toBe(true)
    })

    test('ends on the next move with no button held, when its release was never seen', async () => {
        await startDrag()
        element(U_S).dispatchEvent(pointer('pointermove', 300, 300, 0))
        expect(editor.dragging).toBe(false)
        expect(undoRedoState.canUndo).toBe(true)
    })

    test('ends when the pointer is cancelled, even over the canvas', async () => {
        await startDrag()
        element(U_S).dispatchEvent(pointer('pointercancel', 50, 40, 0))
        expect(editor.dragging).toBe(false)
        expect(undoRedoState.canUndo).toBe(true)
    })

    test('ends when the window loses focus', async () => {
        await startDrag()
        window.dispatchEvent(new Event('blur'))
        expect(editor.dragging).toBe(false)
        expect(undoRedoState.canUndo).toBe(true)
    })
})

describe('Escape while dragging a component', () => {
    test('cancels the move, leaving nothing to undo, and the release then does nothing', async () => {
        await startDrag()
        pressEscape()
        expect(editor.dragging).toBe(false)
        expect(undoRedoState.canUndo).toBe(false)
        element(U_S).dispatchEvent(pointer('pointermove', 80, 60))
        element(U_S).dispatchEvent(pointer('pointerup', 80, 60, 0))
        expect(editor.dragging).toBe(false)
        expect(undoRedoState.canUndo).toBe(false)
    })

    test('as does Undo', async () => {
        await startDrag()
        editor.undo()
        expect(editor.dragging).toBe(false)
        expect(undoRedoState.canUndo).toBe(false)
    })
})

describe('Undoing a move', () => {
    // A component whose centroid is where it was drawn, recording how it is moved back and forth
    function component(x: number, y: number) {
        const moves: [{ x: number, y: number }, { x: number, y: number }, ElementMoveOptions][] = []
        const object = {
            isConnection: false,
            isConnectable: false,
            celldlSvgElement: { centroid: { x, y } },
            reposition: (start: { x: number, y: number }, end: { x: number, y: number }, options: ElementMoveOptions) => {
                moves.push([{ x: start.x, y: start.y }, { x: end.x, y: end.y }, options])
            }
        }
        return { object, moves }
    }

    test('moves a component between where it was drawn, not where the pointer was, without snapping', () => {
        // Pressed at (10, 10) on a component drawn off the grid at (3, 4), and dropped at (43, 34) when
        // the pointer was released at (50, 40)
        const { object, moves } = component(3, 4)
        const undoState = new MoveUndoState(object as unknown as CellDLObject, { x: 10, y: 10 }, undefined)
        object.celldlSvgElement.centroid = { x: 43, y: 34 }
        undoState.endMove({ x: 50, y: 40 })
        undoState.reposition('backwards')
        undoState.reposition('forwards')
        expect(moves).toEqual([
            [{ x: 43, y: 34 }, { x: 3, y: 4 }, { noAlign: true }],
            [{ x: 3, y: 4 }, { x: 43, y: 34 }, { noAlign: true }]
        ])
    })

    test('keeps its own move options', () => {
        const { object, moves } = component(0, 0)
        const undoState = new MoveUndoState(object as unknown as CellDLObject, { x: 0, y: 0 }, undefined)
        undoState.moveOptions = { noOffset: true }
        object.celldlSvgElement.centroid = { x: 5, y: 0 }
        undoState.endMove({ x: 5, y: 0 })
        undoState.reposition('backwards')
        expect(moves[0]![2]).toEqual({ noOffset: true, noAlign: true })
    })
})
