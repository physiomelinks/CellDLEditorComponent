/** biome-ignore-all lint/style/noNonNullAssertion: the fixture's objects are there */

// Location shading (src/CellDL/editor/regions.ts): on by default, drawn under compartment and region boxes, and off
// with `chrome.locationShading: false`, when nothing is drawn. Reorganise keeps boxes round their contents, as one
// undo step with the layout (src/CellDL/editor/boxfit.ts).

import { afterEach, describe, expect, test } from 'bun:test'

import { editor, openFixture, settle } from './support/editor'
import { measureSvgRects } from './support/svgRects'

import type { CellDLDiagram } from '#editor/diagram'
import { undoRedo } from '#editor/diagram/undoredo'
import { Bounds } from '#editor/geometry'
import { boxContents, boxMargins, fitBoxes, fittedBox, MIN_BOX_MARGIN, nestedBoxes } from '#editor/editor/boxfit'
import { boxOf, placeSpatial } from '#editor/editor/compartments'
import { drawRegions, locationShadingEnabled, REGION_LAYER_ID, setLocationShading } from '#editor/editor/regions'

measureSvgRects()

// In the enzyme fixture
const STORE_E = 'ID-00000003'

function centreOf(diagram: CellDLDiagram, id: string) {
    return { ...diagram.objectById(id)!.celldlSvgElement!.centroid }
}

function moveBy(diagram: CellDLDiagram, id: string, dx: number, dy: number) {
    const object = diagram.objectById(id)!
    const from = object.celldlSvgElement!.centroid
    const to = { x: from.x + dx, y: from.y + dy }
    const undoState = undoRedo.setMoveUndoState(object, from)
    object.reposition(from, to, { snapGrid: false, noAlign: true })
    undoState.endMove(to)
}

afterEach(() => setLocationShading(true))

describe('location shading', () => {
    test('is on by default, and draws the locations behind the diagram, under its boxes', async () => {
        const diagram = await openFixture('enzyme.celldl')
        expect(locationShadingEnabled()).toBe(true)
        const compartment = placeSpatial(diagram, 'compartment', new Bounds(0, 0, 400, 300))
        const summary = drawRegions()
        expect(summary.regions.length).toBeGreaterThan(0)
        const layer = diagram.svgDiagram.getElementById(REGION_LAYER_ID)!
        expect(layer.querySelectorAll('[data-region]').length).toBeGreaterThan(0)
        // the layer comes before the box in the document, so is drawn under it
        expect(layer.compareDocumentPosition(compartment.svgElement!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    test('turned off removes the shading and draws nothing', async () => {
        const diagram = await openFixture('enzyme.celldl')
        drawRegions()
        expect(diagram.svgDiagram.getElementById(REGION_LAYER_ID)).not.toBeNull()
        setLocationShading(false)
        expect(diagram.svgDiagram.getElementById(REGION_LAYER_ID)).toBeNull()
        expect(drawRegions().regions).toEqual([])
        expect(diagram.svgDiagram.getElementById(REGION_LAYER_ID)).toBeNull()
        setLocationShading(true)
        await new Promise(resolve => setTimeout(resolve, 20))
        expect(diagram.svgDiagram.getElementById(REGION_LAYER_ID)).not.toBeNull()
    })
})

describe('boxes kept round their contents', () => {
    test('a box keeps its margins, at least the smallest', () => {
        const margins = boxMargins({ x: 0, y: 0, width: 100, height: 100 }, { left: 30, top: 5, right: 70, bottom: 99 })
        expect(margins).toEqual({ left: 30, top: MIN_BOX_MARGIN, right: 30, bottom: MIN_BOX_MARGIN })
        expect(fittedBox({ left: 200, top: 200, right: 240, bottom: 260 }, margins))
            .toEqual({ x: 170, y: 184, width: 100, height: 92 })
    })

    test('a box is nested in another when its centre is inside it and it is smaller', () => {
        const { order, members } = nestedBoxes([
            { x: 0, y: 0, width: 400, height: 400 }, { x: 50, y: 50, width: 100, height: 100 },
            { x: 350, y: 350, width: 200, height: 200 }
        ])
        expect(order).toEqual([1, 2, 0])
        expect(members).toEqual([[1], [], []])
    })

    test('moved contents take their box with them, nested boxes too, as one undo step', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const centre = centreOf(diagram, STORE_E)
        const inner = placeSpatial(diagram, 'region', new Bounds(centre.x - 60, centre.y - 60, centre.x + 60, centre.y + 60))
        const outer = placeSpatial(diagram, 'compartment',
                                   new Bounds(centre.x - 120, centre.y - 120, centre.x + 120, centre.y + 120))
        const innerStart = boxOf(inner), outerStart = boxOf(outer)
        const records = boxContents(diagram)
        expect(records.find(r => r.compartment === outer)!.boxes).toEqual([inner])
        expect(records.find(r => r.compartment === inner)!.objects.map(o => o.id)).toContain(STORE_E)

        undoRedo.beginGroup()
        moveBy(diagram, STORE_E, 300, 200)
        expect(fitBoxes(records)).toBeGreaterThan(0)
        expect(undoRedo.endGroup()).toBe(true)
        const moved = centreOf(diagram, STORE_E)
        const box = boxOf(inner), outerBox = boxOf(outer)
        expect(moved.x).toBeGreaterThan(box.x)
        expect(moved.x).toBeLessThan(box.x + box.width)
        expect(moved.y).toBeGreaterThan(box.y)
        expect(moved.y).toBeLessThan(box.y + box.height)
        // the outer box still encloses the inner one
        expect(outerBox.x).toBeLessThanOrEqual(box.x)
        expect(outerBox.y).toBeLessThanOrEqual(box.y)
        expect(outerBox.x + outerBox.width).toBeGreaterThanOrEqual(box.x + box.width)
        expect(outerBox.y + outerBox.height).toBeGreaterThanOrEqual(box.y + box.height)

        editor.undo()
        await settle()
        expect(centreOf(diagram, STORE_E).x).toBeCloseTo(centre.x, 0)
        expect(boxOf(inner)).toEqual(innerStart)
        expect(boxOf(outer)).toEqual(outerStart)
        editor.redo()
        await settle()
        expect(boxOf(inner)).toEqual(box)
        expect(boxOf(outer)).toEqual(outerBox)
    })
})
