/** biome-ignore-all lint/style/noNonNullAssertion: indices are in range */

// Aligning and distributing selected components (src/CellDL/editor/arrange.ts)

import { describe, expect, test } from 'bun:test'

import { ARRANGE_OPS, type ArrangeBounds, arrangeTargets, centreLine, minimumForArrange } from '#editor/editor/arrange'

const box = (left: number, top: number, width: number, height: number): ArrangeBounds =>
    ({ left, top, right: left + width, bottom: top + height })

// Three boxes of different sizes, unevenly spread
const BOXES: ArrangeBounds[] = [
    box(10, 100, 20, 10),   // x 10..30, y 100..110
    box(100, 20, 40, 30),   // x 100..140, y 20..50
    box(50, 60, 10, 50)     // x 50..60, y 60..110
]

const moved = (bounds: ArrangeBounds[], op: Parameters<typeof arrangeTargets>[1]) =>
    arrangeTargets(bounds, op).map((d, i) => ({
        left: bounds[i]!.left + d.dx,
        top: bounds[i]!.top + d.dy,
        right: bounds[i]!.right + d.dx,
        bottom: bounds[i]!.bottom + d.dy
    }))

describe('arrangeTargets', () => {
    test('align left moves every left edge to the leftmost one, and nothing vertically', () => {
        const deltas = arrangeTargets(BOXES, 'left')
        expect(deltas).toEqual([{ dx: 0, dy: 0 }, { dx: -90, dy: 0 }, { dx: -40, dy: 0 }])
        expect(new Set(moved(BOXES, 'left').map(b => b.left))).toEqual(new Set([10]))
    })

    test('align right uses the rightmost edge', () => {
        expect(arrangeTargets(BOXES, 'right')).toEqual([{ dx: 110, dy: 0 }, { dx: 0, dy: 0 }, { dx: 80, dy: 0 }])
    })

    test('align centre uses the centre of the selection\'s bounding box', () => {
        // The box spans x 10..140, so its centre is 75
        expect(moved(BOXES, 'centre').map(b => (b.left + b.right) / 2)).toEqual([75, 75, 75])
        expect(arrangeTargets(BOXES, 'centre').every(d => d.dy === 0)).toBe(true)
    })

    test('align top, middle and bottom act vertically', () => {
        expect(arrangeTargets(BOXES, 'top')).toEqual([{ dx: 0, dy: -80 }, { dx: 0, dy: 0 }, { dx: 0, dy: -40 }])
        expect(arrangeTargets(BOXES, 'bottom')).toEqual([{ dx: 0, dy: 0 }, { dx: 0, dy: 60 }, { dx: 0, dy: 0 }])
        // The box spans y 20..110, so its middle is 65
        expect(moved(BOXES, 'middle').map(b => (b.top + b.bottom) / 2)).toEqual([65, 65, 65])
    })

    test('distribute horizontally keeps the outermost fixed and makes the gaps equal', () => {
        const deltas = arrangeTargets(BOXES, 'distribute-h')
        // Ordered by centre: 0 (x 10..30), 2 (x 50..60), 1 (x 100..140). Widths 20 + 10 + 40 in a span of 130,
        // so each of the two gaps is 30, and box 2 goes to x 60..70
        expect(deltas[0]).toEqual({ dx: 0, dy: 0 })
        expect(deltas[1]).toEqual({ dx: 0, dy: 0 })
        expect(deltas[2]).toEqual({ dx: 10, dy: 0 })
        const after = moved(BOXES, 'distribute-h').sort((a, b) => a.left - b.left)
        expect(after[1]!.left - after[0]!.right).toBe(after[2]!.left - after[1]!.right)
    })

    test('distribute vertically does the same for heights', () => {
        // Ordered by centre: 1 (y 20..50), 2 (y 60..110), 0 (y 100..110). Heights 30 + 50 + 10 in a span of 90,
        // so there's no gap: box 2 goes to y 50..100
        const deltas = arrangeTargets(BOXES, 'distribute-v')
        expect(deltas).toEqual([{ dx: 0, dy: 0 }, { dx: 0, dy: 0 }, { dx: 0, dy: -10 }])
    })

    test('distribute spreads four boxes evenly', () => {
        const boxes = [box(0, 0, 10, 10), box(15, 0, 10, 10), box(20, 0, 10, 10), box(90, 0, 10, 10)]
        const lefts = moved(boxes, 'distribute-h').map(b => b.left)
        expect(lefts).toEqual([0, 30, 60, 90])
    })

    test('distribute with two items does nothing, as does any op with one', () => {
        const two = BOXES.slice(0, 2)
        expect(arrangeTargets(two, 'distribute-h')).toEqual([{ dx: 0, dy: 0 }, { dx: 0, dy: 0 }])
        expect(arrangeTargets(two, 'distribute-v')).toEqual([{ dx: 0, dy: 0 }, { dx: 0, dy: 0 }])
        for (const op of ARRANGE_OPS) {
            expect(arrangeTargets(BOXES.slice(0, 1), op)).toEqual([{ dx: 0, dy: 0 }])
            expect(arrangeTargets([], op)).toEqual([])
        }
    })

    test('align needs two items and distribute three', () => {
        expect(ARRANGE_OPS.map(minimumForArrange)).toEqual([2, 2, 2, 2, 2, 2, 3, 3])
    })
})

describe('aligning by centres', () => {
    test('align middle and centre move each object\'s own centre onto the line', () => {
        const bounds = [
            { left: 0, top: 0, right: 20, bottom: 40, centre: { x: 10, y: 10 } },   // centre off the middle
            { left: 50, top: 5, right: 70, bottom: 25 }
        ]
        expect(centreLine(bounds, 'middle')).toBe(20)
        expect(arrangeTargets(bounds, 'middle').map(d => d.dy)).toEqual([10, 5])
        expect(centreLine(bounds, 'centre')).toBe(35)
        expect(arrangeTargets(bounds, 'centre').map(d => d.dx)).toEqual([25, -25])
    })
    test('there is no centre line for edges, distributing, or too few objects', () => {
        const box = { left: 0, top: 0, right: 10, bottom: 10 }
        expect(centreLine([box, box], 'left')).toBeNull()
        expect(centreLine([box, box, box], 'distribute-h')).toBeNull()
        expect(centreLine([box], 'middle')).toBeNull()
    })
})
