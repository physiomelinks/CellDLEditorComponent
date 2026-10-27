/** biome-ignore-all lint/style/noNonNullAssertion: the fixtures' elements are there */

import { describe, expect, test } from 'bun:test'

import { openFixture } from './support/editor'

import { diagramLayout, reorganiseDiagram, reorganisingLayout, undoReorganise } from '#editor/editor/regions'
import { componentLibraryPlugin } from '#root/plugins'

//==============================================================================

// Copies of RAAS6 modules' bond graphs (circulatory-autogen-modules), drawn as their bond graph above rows of signal
// blocks, with no compartments: a vessel terminal (hydraulic elements and signal blocks, no reactions) and RAAS
// (reactions and signal blocks)
const TERMINAL = 'raas6-terminal.celldl'
const RAAS = 'raas6-raas.celldl'

function positions(): Map<string, { x: number, y: number }> {
    return new Map(diagramLayout().nodes.map(n => [n.id, { x: n.x, y: n.y }]))
}

/** Reorganises the open diagram, checking its rows are kept and its inputs and outputs put at its sides. */
async function reorganiseKeepingRows() {
    const layout = reorganisingLayout()
    const before = positions()
    const result = (await reorganiseDiagram(undefined, { steps: 400 }))!
    expect(result.measures.improved).toBe(true)
    expect(result.after.crossings).toBeLessThan(result.before.crossings)
    const after = positions()
    // rows kept: nodes (other than inputs and outputs) in a row before are in one after, in the same order of rows
    const ids = layout.nodes.filter(n => !n.side).map(n => n.id)
    for (const a of ids) for (const b of ids) {
        const was = before.get(b)!.y - before.get(a)!.y, now = after.get(b)!.y - after.get(a)!.y
        if (Math.abs(was) < 1) expect(Math.abs(now)).toBeLessThan(1.5)
        else expect(Math.sign(now)).toBe(Math.sign(was))
    }
    const xs = [...after.values()].map(p => p.x)
    for (const n of layout.nodes) {
        if (n.kind === 'input') expect(after.get(n.id)!.x).toBeLessThanOrEqual(Math.min(...xs) + 1)
        if (n.kind === 'output') expect(after.get(n.id)!.x).toBeGreaterThanOrEqual(Math.max(...xs) - 1)
    }
    return { before, after }
}

describe('reorganising a module drawn in rows', () => {
    test('its signal blocks and bonds are laid out with its bond graph, in rows', async () => {
        await openFixture(TERMINAL)
        const plain = diagramLayout(), layout = reorganisingLayout()
        const kinds = new Map(layout.nodes.map(n => [n.id, n.kind]))
        expect(new Set(kinds.values())).toEqual(new Set(['source', 'store', 'other', 'signal', 'input']))
        expect(layout.nodes.filter(n => n.kind === 'input').every(n => n.side === 'left')).toBe(true)
        expect(layout.bonds.length).toBeGreaterThan(plain.bonds.length)
        expect(layout.options).toEqual({ rows: true })
    })

    test('a vessel without reactions is reorganised, and the reorganise undone', async () => {
        await openFixture(TERMINAL)
        expect(componentLibraryPlugin.reactionEquations()).toEqual([])
        const { before, after } = await reorganiseKeepingRows()
        expect([...after].some(([id, p]) => Math.abs(p.x - before.get(id)!.x) > 1)).toBe(true)
        expect(undoReorganise()).toBe(true)
        for (const [id, p] of positions()) {
            expect(p.x).toBeCloseTo(before.get(id)!.x, 0)
            expect(p.y).toBeCloseTo(before.get(id)!.y, 0)
        }
    })

    test('reactions and signal blocks are reorganised, the outputs to the right', async () => {
        await openFixture(RAAS)
        expect(componentLibraryPlugin.reactionEquations().length).toBeGreaterThan(0)
        expect(reorganisingLayout().nodes.some(n => n.kind === 'output' && n.side === 'right')).toBe(true)
        await reorganiseKeepingRows()
    })

    test('a diagram without signal blocks is laid out as before', async () => {
        await openFixture('enzyme.celldl')
        const plain = diagramLayout(), layout = reorganisingLayout()
        expect(layout.nodes).toEqual(plain.nodes)
        expect(layout.bonds).toEqual(plain.bonds)
        expect(layout.options).toBeUndefined()
    })
})
