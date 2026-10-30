/** biome-ignore-all lint/style/noNonNullAssertion: the fixture's objects are there */

// Location shading (src/CellDL/editor/regions.ts): on by default, drawn over compartment and region boxes and under
// the diagram's other elements, and off
// with `chrome.locationShading: false`, when nothing is drawn. Reorganise keeps boxes round their contents, as one
// undo step with the layout (src/CellDL/editor/boxfit.ts).

import { afterEach, describe, expect, test } from 'bun:test'

import { editor, openFixture, settle } from './support/editor'
import { measureSvgRects } from './support/svgRects'

import type { CellDLCompartment } from '#editor/celldlObjects'
import type { CellDLDiagram } from '#editor/diagram'
import { undoRedo } from '#editor/diagram/undoredo'
import { Bounds } from '#editor/geometry'
import { boxContents, boxMargins, fitBoxes, fittedBox, MIN_BOX_MARGIN, nestedBoxes } from '#editor/editor/boxfit'
import { boxOf, placeSpatial, resizeCompartment } from '#editor/editor/compartments'
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

/** The diagram layer's children: 'box' for a compartment or region box, 'shading', or the element's id */
function layerOrder(diagram: CellDLDiagram): string[] {
    const layer = diagram.svgDiagram.querySelector('svg > g.celldl-Layer')!
    return [...layer.children].map(child => child.classList.contains('celldl-Compartment') ? 'box'
                                           : child.id === REGION_LAYER_ID ? 'shading' : child.id)
}

function elementsAfter(diagram: CellDLDiagram): string[] {
    return layerOrder(diagram).filter(id => id !== 'box' && id !== 'shading')
}

afterEach(() => setLocationShading(true))

describe('location shading', () => {
    test('is on by default, and draws the locations over the diagram\'s boxes, under its other elements', async () => {
        const diagram = await openFixture('enzyme.celldl')
        expect(locationShadingEnabled()).toBe(true)
        const compartment = placeSpatial(diagram, 'compartment', new Bounds(0, 0, 400, 300))
        const summary = drawRegions()
        expect(summary.regions.length).toBeGreaterThan(0)
        const layer = diagram.svgDiagram.getElementById(REGION_LAYER_ID)!
        expect(layer.querySelectorAll('[data-region]').length).toBeGreaterThan(0)
        // boxes, then the shading, then everything else, in the diagram's layer
        expect(layerOrder(diagram)).toEqual(['box', 'shading', ...elementsAfter(diagram)])
        expect(compartment.svgElement!.nextElementSibling).toBe(layer)
        // it takes no clicks and isn't saved
        expect(layer.getAttribute('pointer-events')).toBe('none')
        expect(layer.classList.contains('editor-specific')).toBe(true)
    })

    test('is first in a diagram without boxes', async () => {
        const diagram = await openFixture('enzyme.celldl')
        drawRegions()
        const layer = diagram.svgDiagram.getElementById(REGION_LAYER_ID)!
        expect(layer.parentElement!.firstElementChild).toBe(layer)
        expect(layer.parentElement!.classList.contains('celldl-Layer')).toBe(true)
    })

    test('stays over boxes placed, nested, resized, deleted and undone after it was drawn', async () => {
        const diagram = await openFixture('enzyme.celldl')
        drawRegions()
        const outer = placeSpatial(diagram, 'compartment', new Bounds(-200, -200, 600, 500))
        placeSpatial(diagram, 'region', new Bounds(0, 0, 200, 150))
        expect(layerOrder(diagram).slice(0, 3)).toEqual(['box', 'box', 'shading'])
        // the inner one grown larger than the outer goes behind it, still under the shading
        const inner = [...diagram.svgDiagram.querySelectorAll('.celldl-Compartment')][1]!
        resizeCompartment(diagram.objectById(inner.id) as CellDLCompartment, { x: -300, y: -300, width: 1000, height: 900 })
        expect(layerOrder(diagram).slice(0, 3)).toEqual(['box', 'box', 'shading'])
        expect(diagram.svgDiagram.querySelector('.celldl-Compartment')!.id).toBe(inner.id)
        editor.selectionSet.clear()
        editor.setSelectedObject(outer)
        editor.selectionSet.deleteObjects()
        await settle()
        expect(layerOrder(diagram).slice(0, 2)).toEqual(['box', 'shading'])
        editor.undo()
        await settle()
        drawRegions()
        expect(layerOrder(diagram).slice(0, 3)).toEqual(['box', 'box', 'shading'])
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
