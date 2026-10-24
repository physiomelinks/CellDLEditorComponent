/** biome-ignore-all lint/style/noNonNullAssertion: the fixture's objects are there */

// A plain click on empty canvas closes the panels showing the selection, Properties and Style, but a press that
// lands on an element, pans or draws a selection box leaves them open (src/CellDL/editor/index.ts,
// src/components/toolbar/selectionPanels.ts). A half-typed value in a panel is committed by a canvas press.

import { afterEach, describe, expect, test } from 'bun:test'

import { countEdits, editor, openFixture } from './support/editor'

import { CANVAS_EMPTY_CLICK_EVENT } from '#editor/editor'
import { undoRedoState } from '#editor/diagram/undoredo'
import { PANEL_ID } from '#root/utils/editor-types'
import { closeSelectionPanels, commitFocusedField } from '#root/components/toolbar/selectionPanels'

// In the enzyme fixture, u_S is a 0-junction bonded to r1 and r2
const U_S = 'ID-00000002'

const element = (id: string) => document.getElementById(id)!

const pointer = (type: string, x: number, y: number, buttons = 1, init: PointerEventInit = {}) =>
    new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, buttons, pointerId: 1, ...init })

/** Presses at (x, y), moves to (toX, toY) and releases, with the click a browser then sends */
function press(target: Element, x: number, y: number, toX = x, toY = y, init: PointerEventInit = {}) {
    target.dispatchEvent(pointer('pointerover', x, y, 0, init))
    target.dispatchEvent(pointer('pointerdown', x, y, 1, init))
    if (toX !== x || toY !== y) {
        target.dispatchEvent(pointer('pointermove', toX, toY, 1, init))
    }
    target.dispatchEvent(pointer('pointerup', toX, toY, 0, init))
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: toX, clientY: toY, ...init }))
    target.dispatchEvent(pointer('pointerout', toX, toY, 0, init))
}

/** Counts the empty-canvas clicks the editor reports */
function countEmptyClicks(): { readonly count: number, stop: () => void } {
    let count = 0
    const listener = () => { count += 1 }
    document.addEventListener(CANVAS_EMPTY_CLICK_EVENT, listener)
    return {
        get count() { return count },
        stop: () => document.removeEventListener(CANVAS_EMPTY_CLICK_EVENT, listener)
    }
}

let clicks = countEmptyClicks()

afterEach(() => {
    clicks.stop()
    document.body.dispatchEvent(pointer('pointerup', 0, 0, 0))
})

async function openAndSelect() {
    const diagram = await openFixture('enzyme.celldl')
    clicks.stop()
    clicks = countEmptyClicks()
    press(element(U_S), 10, 10)
    expect(editor.selectionSet.size).toBe(1)
    return diagram
}

describe('A click on empty canvas', () => {
    test('clears the selection and reports the click, editing nothing', async () => {
        const diagram = await openAndSelect()
        const edits = countEdits()
        press(diagram.svgDiagram, 300, 300)
        edits.stop()
        expect(editor.selectionSet.size).toBe(0)
        expect(clicks.count).toBe(1)
        expect(edits.count).toBe(0)
        expect(undoRedoState.canUndo).toBe(false)
    })

    test('is not reported for a click on an element', async () => {
        await openAndSelect()
        press(element(U_S), 10, 10)
        expect(clicks.count).toBe(0)
    })

    test('is not reported for a pan', async () => {
        const diagram = await openAndSelect()
        press(diagram.svgDiagram, 300, 300, 360, 340)
        expect(clicks.count).toBe(0)
    })

    test('is not reported for a shift-press, which draws a selection box', async () => {
        const diagram = await openAndSelect()
        press(diagram.svgDiagram, 300, 300, 300, 300, { shiftKey: true })
        expect(clicks.count).toBe(0)
    })
})

describe('Closing the selection panels', () => {
    test('closes Properties and Style, leaving Metadata and Reactions', () => {
        const buttons = [
            { toolId: PANEL_ID.PROPERTIES_PANEL, active: true },
            { toolId: PANEL_ID.METADATA_PANEL, active: false },
            { toolId: PANEL_ID.STYLE_PANEL, active: false },
            { toolId: PANEL_ID.REACTIONS_PANEL, active: false }
        ]
        expect(closeSelectionPanels(buttons)).toEqual([PANEL_ID.PROPERTIES_PANEL])
        expect(buttons.every(button => !button.active)).toBe(true)

        buttons[2]!.active = true
        expect(closeSelectionPanels(buttons)).toEqual([PANEL_ID.STYLE_PANEL])

        buttons[1]!.active = true
        expect(closeSelectionPanels(buttons)).toEqual([])
        expect(buttons[1]!.active).toBe(true)
        buttons[1]!.active = false
        buttons[3]!.active = true
        expect(closeSelectionPanels(buttons)).toEqual([])
        expect(buttons[3]!.active).toBe(true)
    })
})

describe('A half-typed value in a panel', () => {
    test('is committed, by taking focus from its field, when the canvas is pressed', () => {
        const panel = document.createElement('div')
        const input = document.createElement('input')
        panel.appendChild(input)
        document.body.appendChild(panel)
        let committed = ''
        input.addEventListener('focusout', () => { committed = input.value })
        input.focus()
        input.value = '4.2'
        expect(commitFocusedField(panel)).toBe(true)
        expect(committed).toBe('4.2')
        expect(document.activeElement).not.toBe(input)
        // Nothing is focused in the panel now
        expect(commitFocusedField(panel)).toBe(false)
        panel.remove()
    })

    test('is left alone when focus is elsewhere', () => {
        const panel = document.createElement('div')
        const other = document.createElement('input')
        document.body.append(panel, other)
        other.focus()
        expect(commitFocusedField(panel)).toBe(false)
        expect(document.activeElement).toBe(other)
        panel.remove()
        other.remove()
    })
})
