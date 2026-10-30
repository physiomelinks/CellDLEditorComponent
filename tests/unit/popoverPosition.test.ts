import { describe, expect, test } from 'bun:test'

import { popoverPosition, topZIndex } from '../../src/components/palette/popoverPosition'

const viewport = { width: 1100, height: 750 }
const size = { width: 240, height: 327 }

describe('the Add element popover\'s position', () => {
    test('opens at the click', () => {
        expect(popoverPosition({ x: 209, y: 300 }, size, viewport)).toEqual({ left: 209, top: 300 })
    })
    test('stays inside the window near its edges', () => {
        expect(popoverPosition({ x: 1000, y: 700 }, size, viewport)).toEqual({ left: 856, top: 419 })
        expect(popoverPosition({ x: -10, y: 0 }, size, viewport)).toEqual({ left: 4, top: 4 })
    })
    test('keeps its top left in view when the window is smaller than it', () => {
        expect(popoverPosition({ x: 100, y: 100 }, size, { width: 200, height: 200 })).toEqual({ left: 4, top: 4 })
    })
})

describe('the Add element popover\'s z-index', () => {
    test('is above an open dialog', () => {
        expect(topZIndex(['auto', '1101', '0', '1103'])).toBe(1104)
    })
    test('is at least its own when nothing is above it', () => {
        expect(topZIndex([])).toBe(1100)
        expect(topZIndex(['auto', '5'])).toBe(1100)
    })
})
