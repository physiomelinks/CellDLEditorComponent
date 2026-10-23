/** biome-ignore-all lint/style/noNonNullAssertion: the fixture's objects are there */

import { describe, expect, test } from 'bun:test'

import { openFixture } from './support/editor'

import type { CellDLObject } from '#editor/celldlObjects'
import type { CellDLDiagram } from '#editor/diagram'
import { BondDrag } from '#editor/editor/bonddrag'
import { EditorFrame } from '#editor/editor/editorframe'
import { getElementId } from '#editor/editor'

//==============================================================================

// In the enzyme fixture, u_S (a 0-junction) can bond to r2's reactants side, and r1's reactants side can't bond to
// u_P, as a reactants side's bonds come from its species
const U_S = 'ID-00000002'
const R1_REACTANTS = 'ID-00000005'
const R2_REACTANTS = 'ID-00000010'
const U_P = 'ID-00000013'
const REFUSAL = 'This is a reactants side: drag from the species to it.'

const bondCount = (diagram: CellDLDiagram) => diagram.objects.filter(o => o.isConnection).length

type HostCall = ['suppress', boolean] | ['flash', string, { x: number, y: number }]

async function bondDrag(): Promise<{ drag: BondDrag, diagram: CellDLDiagram, calls: HostCall[] }> {
    const diagram = await openFixture('enzyme.celldl')
    const frame = new EditorFrame(diagram)
    const calls: HostCall[] = []
    const drag = new BondDrag({
        celldlDiagram: diagram,
        editorFrame: frame,
        canStartBond: true,
        bondStyle: 'linear',
        svgPoint: (event) => new DOMPoint(event.clientX, event.clientY),
        objectAt: (element) => diagram.objectById(getElementId(element)) as CellDLObject|null,
        suppressTooltips: (suppress) => { calls.push(['suppress', suppress]) },
        flashError: (message, at) => { calls.push(['flash', message, at]) },
        click: () => {}
    })
    return { drag, diagram, calls }
}

function pointer(id: string, x: number, y: number, buttons = 1): PointerEvent {
    return { target: document.getElementById(id), clientX: x, clientY: y, button: 0, buttons,
             metaKey: true, ctrlKey: true, shiftKey: false } as unknown as PointerEvent
}

/** Starts a bond by Cmd/Ctrl-dragging from an element */
function start(drag: BondDrag, from: string) {
    expect(drag.pointerDown(pointer(from, 0, 0))).toBe(true)
    drag.pointerMove(pointer(from, 20, 20))
    expect(drag.active).toBe(true)
}

describe('Tooltips while drawing a bond', () => {
    test('are suppressed from the start of the drag until it ends', async () => {
        const { drag, calls } = await bondDrag()
        start(drag, U_S)
        expect(calls).toEqual([['suppress', true]])
        drag.cancel()
        expect(calls).toEqual([['suppress', true], ['suppress', false]])
    })

    test('say nothing while the pointer is over an invalid target', async () => {
        const { drag, calls } = await bondDrag()
        start(drag, R1_REACTANTS)
        expect(drag.validTargetIds).not.toContain(U_P)
        expect(drag.pointerOver(pointer(U_P, 40, 40))).toBe(true)
        expect(calls.filter(c => c[0] === 'flash')).toEqual([])
        drag.cancel()
    })

    test('flash why an invalid target is refused, where the bond is released', async () => {
        const { drag, diagram, calls } = await bondDrag()
        const bonds = bondCount(diagram)
        start(drag, R1_REACTANTS)
        drag.pointerOver(pointer(U_P, 40, 40))
        drag.pointerUp(pointer(U_P, 40, 40, 0))
        expect(calls).toEqual([
            ['suppress', true],
            ['suppress', false],
            ['flash', REFUSAL, { x: 40, y: 40 }]
        ])
        expect(bondCount(diagram)).toBe(bonds)
    })

    // Making a bond needs the browser's SVG geometry, so is checked in the dev app
    test('say nothing when released on its start or on empty canvas', async () => {
        const { drag, diagram, calls } = await bondDrag()
        const bonds = bondCount(diagram)
        start(drag, U_S)
        expect(drag.validTargetIds).toContain(R2_REACTANTS)
        drag.pointerOver(pointer(R2_REACTANTS, 60, 60))
        drag.pointerUp(pointer(U_S, 60, 60, 0))
        start(drag, U_S)
        drag.pointerUp({ ...pointer(U_S, 80, 80, 0), target: diagram.svgDiagram } as unknown as PointerEvent)
        expect(calls).toEqual([['suppress', true], ['suppress', false], ['suppress', true], ['suppress', false]])
        expect(bondCount(diagram)).toBe(bonds)
    })
})
