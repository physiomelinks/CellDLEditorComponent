/** biome-ignore-all lint/style/noNonNullAssertion: <the elements looked up exist> */

// PhLynx's arrowhead on bonds (src/utils/arrows.ts): as a marker in the editor and generated documents, and as a
// plain shape in exported figures.

import { describe, expect, test } from 'bun:test'

import { DOMParser } from '@xmldom/xmldom'

import {
    ARROW_POINTS,
    arrowMarker,
    arrowShape,
    arrowStyleClass,
    arrowStyleOrDefault,
    DEFAULT_ARROW_STYLE,
    displayArrowDefinitions,
    displayArrowId
} from '#root/utils/arrows'
import { BondgraphPlugin } from '#root/plugins/bondgraph'

const parse = (xml: string) => new DOMParser().parseFromString(xml, 'image/svg+xml').documentElement!

describe('arrows', () => {
    test('the marker is PhLynx\'s closed arrow, its tip at the end of the connection', () => {
        const marker = parse(arrowMarker('end', 'bondgraph'))
        // PhLynx's CouplingEdge: viewBox -10 -10 20 20, tip (0, 0) at refX 0, 12.5 stroke widths, one head per edge
        expect(marker.getAttribute('viewBox')).toBe('-10 -10 20 20')
        expect([marker.getAttribute('refX'), marker.getAttribute('refY')]).toEqual(['0', '0'])
        expect(marker.getAttribute('markerUnits')).toBe('strokeWidth')
        expect([marker.getAttribute('markerWidth'), marker.getAttribute('markerHeight')]).toEqual(['12.5', '12.5'])
        expect(marker.getAttribute('orient')).toBe('auto-start-reverse')
        const polyline = marker.getElementsByTagName('polyline')[0]!
        expect(polyline.getAttribute('points')).toBe('-5,-4 0,0 -5,4 -5,-4')
        expect(polyline.getAttribute('fill')).toBe('context-stroke')
    })

    test('as a shape, the head points along the line with its tip on the line\'s end', () => {
        const shape = parse(arrowShape(0, 0, 0, 50, 2, '#333'))
        expect(shape.getAttribute('points')).toBe(ARROW_POINTS)
        // pointing down (90 degrees), at (0, 50), as large as the marker on a line 2 wide: 2 * 12.5 / 20
        expect(shape.getAttribute('transform')).toBe('translate(0,50) rotate(90) scale(1.25)')
        expect(shape.getAttribute('fill')).toBe('#333')
    })

    test('\'bond\' is the default, and anything else is the default', () => {
        expect(DEFAULT_ARROW_STYLE).toBe('bond')
        expect(arrowStyleOrDefault('classic')).toBe('classic')
        expect(arrowStyleOrDefault('bond')).toBe('bond')
        expect(arrowStyleOrDefault(undefined)).toBe('bond')
        expect(arrowStyleOrDefault('harpoon')).toBe('bond')
    })

    test('each style has a display-only marker, \'bond\' the editor\'s notched head', () => {
        const svg = parse(`<svg xmlns="http://www.w3.org/2000/svg">${displayArrowDefinitions()}</svg>`)
        const markers = Array.from(svg.getElementsByTagName('marker'))
        expect(markers.map((m) => m.getAttribute('id'))).toEqual([displayArrowId('bond'), displayArrowId('classic')])
        // The head the editor drew before PhLynx's: viewBox 0 0 5.5 5, tip at (5, 2.5), notched back
        const bond = markers[0]!
        expect(bond.getAttribute('viewBox')).toBe('0 0 5.5 5')
        expect([bond.getAttribute('refX'), bond.getAttribute('refY')]).toEqual(['5', '2.5'])
        expect(bond.getElementsByTagName('path')[0]!.getAttribute('d')).toBe('M0,0 L5.05,2.2 L5.05,2.8 L0,5 L1,2.5 z')
        // PhLynx's closed arrow
        const classic = markers[1]!
        expect(classic.getElementsByTagName('polyline')[0]!.getAttribute('points')).toBe(ARROW_POINTS)
    })

    test('the style rules outrank a document\'s own marker rule', () => {
        const css = parse(`<svg xmlns="http://www.w3.org/2000/svg">${displayArrowDefinitions()}</svg>`)
            .getElementsByTagName('style')[0]!.textContent!
        const documentRule = new BondgraphPlugin().styleRules()
        const documentSelector = documentRule.split('{')[0]!.trim()
        for (const style of ['bond', 'classic'] as const) {
            // Scoped by the editor's root class, so one more class than the document's selector
            expect(css).toContain(`.celldl-editor.${arrowStyleClass(style)} ${documentSelector}{marker-end:url(#${displayArrowId(style)})}`)
        }
    })

    test('a document is saved with the plugin\'s own marker, not a display one', () => {
        const definitions = new BondgraphPlugin().svgDefinitions()
        expect(definitions).toContain('id="connection-end-arrow-bondgraph"')
        expect(definitions).not.toContain('celldl-display-arrow')
    })
})
