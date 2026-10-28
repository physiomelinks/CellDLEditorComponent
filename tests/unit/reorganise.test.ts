/** biome-ignore-all lint/style/noNonNullAssertion: <the fixture's nodes are drawn> */

// Reorganise by location for a host (src/CellDL/editor/reorganise.ts): `chrome.reorganise`, the `reorganise-state`
// event's modes and state, and the `edit` command's `reorganise`, which is one undo step.

import { afterEach, describe, expect, test } from 'bun:test'

import { editor, openFixture, settle } from './support/editor'

import { CellDLDiagram } from '#editor/diagram'
import { undoRedo } from '#editor/diagram/undoredo'
import { diagramLayout } from '#editor/editor/regions'
import {
    DEFAULT_REORGANISE_MODE, reorganiseChromeState, reorganiseProgress, reorganiseState, runReorganise,
    setReorganiseChrome
} from '#editor/editor/reorganise'
import { LAYOUT_PRESETS } from '#root/plugins/bondgraph/layout'

afterEach(() => setReorganiseChrome(undefined))

// Where each of the diagram's laid out nodes is
function positions(_diagram: CellDLDiagram): Map<string, string> {
    const at = new Map<string, string>()
    for (const [id, object] of diagramLayout().objects) {
        const c = object.celldlSvgElement!.centroid
        at.set(id, `${c.x.toFixed(1)},${c.y.toFixed(1)}`)
    }
    expect(at.size).toBeGreaterThan(0)
    return at
}

// Swap the nodes' places, end for end, so a reorganise has something to tidy
function scramble() {
    const objects = [...diagramLayout().objects.values()]
    const from = objects.map(o => ({ ...o.celldlSvgElement!.centroid }))
    objects.forEach((object, n) => {
        const to = from[objects.length - 1 - n]!
        const undoState = undoRedo.setMoveUndoState(object, from[n]!)
        object.reposition(from[n]!, to, { snapGrid: false, noAlign: true })
        undoState.endMove(to)
    })
}

describe('chrome.reorganise', () => {
    test('the controls are in the Reactions panel by default, and hidden with `false`', () => {
        setReorganiseChrome(undefined)
        expect(reorganiseChromeState.inPanel).toBe(true)
        setReorganiseChrome('panel')
        expect(reorganiseChromeState.inPanel).toBe(true)
        setReorganiseChrome(false)
        expect(reorganiseChromeState.inPanel).toBe(false)
    })
})

describe('reorganise state', () => {
    test('offers the dropdown\'s modes, in its order, with their labels', () => {
        const { modes } = reorganiseState()
        expect(modes.map(m => m.id)).toEqual(LAYOUT_PRESETS.map(p => p.id))
        expect(modes.map(m => m.label)).toEqual(LAYOUT_PRESETS.map(p => p.name))
        expect(modes.every(m => m.description.length > 0)).toBe(true)
        expect(modes.some(m => m.id === DEFAULT_REORGANISE_MODE)).toBe(true)
    })

    test('is disabled for an empty diagram, enabled with reactions, and disabled while busy', async () => {
        await editor.editDiagram(new CellDLDiagram('', '', editor))
        expect(reorganiseState()).toMatchObject({ enabled: false, busy: false })
        await openFixture('enzyme.celldl')
        expect(reorganiseState()).toMatchObject({ enabled: true, busy: false })
        reorganiseProgress.busy = true
        try {
            expect(reorganiseState()).toMatchObject({ enabled: false, busy: true })
        } finally {
            reorganiseProgress.busy = false
        }
    })
})

describe('reorganise command', () => {
    test('fails, moving nothing, for an unknown mode, while busy, or with no reactions', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const before = positions(diagram)
        expect(await runReorganise('nonsense')).toMatchObject({ ok: false, improved: false })
        reorganiseProgress.busy = true
        try {
            expect((await runReorganise()).error).toContain('already running')
        } finally {
            reorganiseProgress.busy = false
        }
        expect(positions(diagram)).toEqual(before)
        await editor.editDiagram(new CellDLDiagram('', '', editor))
        expect((await runReorganise()).error).toContain('no reactions')
    })

    test('runs as one undo step that Undo reverses', async () => {
        const diagram = await openFixture('enzyme.celldl')
        scramble()
        const before = positions(diagram)
        const lastStep = undoRedo.lastStep
        const result = await runReorganise('balanced')
        expect(result.ok).toBe(true)
        expect(result.improved).toBe(true)
        expect(result.mode).toBe('balanced')
        expect(result.status.length).toBeGreaterThan(0)
        expect(reorganiseProgress.busy).toBe(false)
        if (result.improved) {
            expect(undoRedo.lastStep).not.toBe(lastStep)
            expect(positions(diagram)).not.toEqual(before)
            editor.undo()
            await settle()
            expect(positions(diagram)).toEqual(before)
        } else {
            expect(undoRedo.lastStep).toBe(lastStep)
            expect(positions(diagram)).toEqual(before)
        }
    }, 60000)
})
