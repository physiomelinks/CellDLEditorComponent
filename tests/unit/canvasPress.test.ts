/** biome-ignore-all lint/style/noNonNullAssertion: the fixture's objects are there */

// A press on the canvas tells open menus to close, before the editor handles it and without stopping it, so the
// press still selects or drags and a host still sees it (src/CellDL/editor/index.ts). A browser check covers the
// menus themselves closing.

import { afterEach, describe, expect, test } from 'bun:test'

import { editor, openFixture } from './support/editor'

import { CANVAS_PRESS_EVENT } from '#editor/editor'

// In the enzyme fixture, u_S is a 0-junction bonded to r1 and r2
const U_S = 'ID-00000002'

const pointer = (type: string, buttons = 1) =>
    new PointerEvent(type, { bubbles: true, cancelable: true, clientX: 10, clientY: 10, button: 0, buttons, pointerId: 1 })

afterEach(() => {
    document.body.dispatchEvent(pointer('pointerup', 0))
})

/** Presses on `target`, returning what the canvas press and a host's document listener saw */
function press(target: Element) {
    const seen: string[] = []
    const onPress = (event: Event) => seen.push(`press:${(event as CustomEvent).detail.event.type}`)
    const onHost = (event: Event) => seen.push(`host:${event.defaultPrevented ? 'prevented' : 'open'}`)
    document.addEventListener(CANVAS_PRESS_EVENT, onPress)
    document.addEventListener('pointerdown', onHost)
    target.dispatchEvent(pointer('pointerover', 0))
    target.dispatchEvent(pointer('pointerdown'))
    document.removeEventListener(CANVAS_PRESS_EVENT, onPress)
    document.removeEventListener('pointerdown', onHost)
    return seen
}

describe('A press on the canvas', () => {
    test('is announced before it reaches the document, which still sees it', async () => {
        await openFixture('enzyme.celldl')
        expect(press(document.getElementById(U_S)!)).toEqual(['press:pointerdown', 'host:open'])
    })

    test('still starts a drag', async () => {
        await openFixture('enzyme.celldl')
        const element = document.getElementById(U_S)!
        press(element)
        element.dispatchEvent(pointer('pointermove'))
        expect(editor.dragging).toBe(true)
    })

    test('is not announced for a press outside the canvas', () => {
        const outside = document.createElement('div')
        document.body.appendChild(outside)
        expect(press(outside)).toEqual(['host:open'])
        outside.remove()
    })
})
