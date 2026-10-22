/** biome-ignore-all lint/style/noNonNullAssertion: <the elements looked up exist> */

// PhLynx's arrowhead on bonds (src/utils/arrows.ts): as a marker in the editor and generated documents, and as a
// plain shape in exported figures.

import { describe, expect, test } from 'bun:test'

import { DOMParser } from '@xmldom/xmldom'

import { ARROW_POINTS, arrowMarker, arrowShape } from '#root/utils/arrows'

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
})
