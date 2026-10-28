/** biome-ignore-all lint/style/noNonNullAssertion: the fixture's objects are there */

// The palette's spatial entries: compartments and regions placed, resized, moved with what's inside them and deleted,
// each as one undo step

import { describe, expect, test } from 'bun:test'

import { editor, openFixture, settle } from './support/editor'
import { measureSvgRects } from './support/svgRects'

import type { CellDLDiagram } from '#editor/diagram'
import { undoRedo, undoRedoState } from '#editor/diagram/undoredo'
import { Bounds } from '#editor/geometry'
import { EditorFrame } from '#editor/editor/editorframe'
import {
    boxOf,
    CompartmentHandles,
    compartmentContents,
    compartmentMoveGroup,
    placeSpatial,
    resizeCompartment,
    resizedBox
} from '#editor/editor/compartments'
import { DEFAULT_SPATIAL_SIZE, searchSpatialEntries, spatialEntries, spatialEntry } from '#root/plugins/drawing/spatial'

//==============================================================================

// happy-dom doesn't measure SVG
measureSvgRects()

//==============================================================================

// In the enzyme fixture
const STORE_E = 'ID-00000003'

function centreOf(diagram: CellDLDiagram, id: string) {
    return { ...diagram.objectById(id)!.celldlSvgElement!.centroid }
}

/** A box round the point, `half` either side of it */
function boundsRound(point: { x: number, y: number }, half: number) {
    return new Bounds(point.x - half, point.y - half, point.x + half, point.y + half)
}

function compartments(diagram: CellDLDiagram): string[] {
    return [...diagram.svgDiagram.querySelectorAll('.celldl-Compartment')].map(element => element.id)
}

//==============================================================================

describe('the spatial entries', () => {
    test('are a compartment and a region, found by search whatever the domain', () => {
        expect(spatialEntries().map(entry => entry.kind)).toEqual(['compartment', 'region'])
        expect(spatialEntry('spatial/region')?.drawingTool).toBe('draw-background-region')
        expect(searchSpatialEntries('membrane').map(entry => entry.id)).toEqual(['spatial/compartment'])
        expect(searchSpatialEntries('').length).toBe(2)
        expect(searchSpatialEntries('capacitor')).toEqual([])
    })
})

describe('a compartment', () => {
    test('placed by a click is its default size, centred there, and is one undo step', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const before = await diagram.rdf()
        const compartment = placeSpatial(diagram, 'compartment', new Bounds(400, 300, 400, 300))
        const box = boxOf(compartment)
        expect(box.width).toBe(DEFAULT_SPATIAL_SIZE.width)
        expect(box.height).toBe(DEFAULT_SPATIAL_SIZE.height)
        expect(Math.abs(box.x + box.width/2 - 400)).toBeLessThanOrEqual(10)
        // a double membrane wall
        expect(compartment.svgElement!.querySelectorAll('rect:not(.editor-specific)').length).toBe(2)
        expect(compartments(diagram)).toEqual([compartment.id])
        editor.undo()
        await settle()
        expect(compartments(diagram)).toEqual([])
        expect(await diagram.rdf()).toBe(before)
        editor.redo()
        await settle()
        expect(compartments(diagram)).toEqual([compartment.id])
    })

    test('drawn as a box keeps it, and a region has one dashed wall', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const region = placeSpatial(diagram, 'region', new Bounds(100, 100, 300, 260))
        expect(boxOf(region)).toEqual({ x: 100, y: 100, width: 200, height: 160 })
        const walls = region.svgElement!.querySelectorAll('rect:not(.editor-specific)')
        expect(walls.length).toBe(1)
        expect(walls[0]!.getAttribute('stroke-dasharray')).not.toBeNull()
    })

    test('drawn inside another is in front of it, behind the diagram\'s elements', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const outer = placeSpatial(diagram, 'compartment', new Bounds(0, 0, 800, 600))
        const inner = placeSpatial(diagram, 'compartment', new Bounds(100, 100, 300, 300))
        const order = [...outer.svgElement!.parentNode!.children].map(element => element.id)
        expect(order.indexOf(outer.id)).toBeLessThan(order.indexOf(inner.id))
        expect(order.indexOf(inner.id)).toBeLessThan(order.indexOf(STORE_E))
    })

    test('resized round a larger one goes behind it', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const small = placeSpatial(diagram, 'compartment', new Bounds(100, 100, 200, 200))
        const large = placeSpatial(diagram, 'compartment', new Bounds(300, 100, 600, 400))
        const ids = () => [...small.svgElement!.parentNode!.children].map(element => element.id)
        expect(ids().indexOf(large.id)).toBeLessThan(ids().indexOf(small.id))
        resizeCompartment(small, { x: 50, y: 50, width: 800, height: 600 })
        expect(ids().indexOf(small.id)).toBeLessThan(ids().indexOf(large.id))
    })

    test('resized by a handle is one undo step', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const compartment = placeSpatial(diagram, 'compartment', new Bounds(100, 100, 340, 260))
        const start = boxOf(compartment)
        const frame = new EditorFrame(diagram)
        const handles = new CompartmentHandles({ editorFrame: frame, selectedCompartment: compartment })
        handles.refresh()
        const drawn = [...diagram.svgDiagram.querySelectorAll('.compartment-handle')]
        expect(drawn.length).toBe(8)
        const undoable = undoRedoState.canUndo
        // Drag the bottom right corner's handle
        expect(handles.pointerEvent('pointerdown', drawn[4]!, { x: 340, y: 260 })).toBe(true)
        handles.pointerEvent('pointermove', null, { x: 420, y: 330 })
        handles.pointerEvent('pointermove', null, { x: 500, y: 400 })
        expect(handles.pointerEvent('pointerup', null, { x: 500, y: 400 })).toBe(true)
        expect(handles.pointerEvent('click', drawn[4]!, { x: 500, y: 400 })).toBe(true)
        const resized = boxOf(compartment)
        expect(resized.x).toBe(start.x)
        expect(resized.width).toBeGreaterThan(start.width + 100)
        expect(undoRedoState.canUndo).toBe(true)
        editor.undo()
        await settle()
        expect(boxOf(compartment)).toEqual(start)
        expect(undoRedoState.canUndo).toBe(undoable)
        editor.redo()
        await settle()
        expect(boxOf(compartment)).toEqual(resized)
        expect(diagram.objectById(compartment.id)?.isCompartment).toBe(true)
        frame.clear()
    })

    test('keeps no less than its smallest size, whichever handle is dragged', () => {
        const box = { x: 0, y: 0, width: 100, height: 100 }
        expect(resizedBox(box, 0, { x: 200, y: 200 })).toEqual({ x: 80, y: 80, width: 20, height: 20 })
        expect(resizedBox(box, 1, { x: 50, y: -40 })).toEqual({ x: 0, y: -40, width: 100, height: 140 })
        expect(resizedBox(box, 7, { x: 30, y: 999 })).toEqual({ x: 30, y: 0, width: 70, height: 100 })
    })

    test('moves with what is inside it, and the move is one undo step', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const centre = centreOf(diagram, STORE_E)
        const compartment = placeSpatial(diagram, 'compartment', boundsRound(centre, 80))
        const contents = compartmentContents(diagram, compartment).map(object => object.id)
        expect(contents).toContain(STORE_E)
        expect(contents).not.toContain(compartment.id)

        const group = compartmentMoveGroup(diagram, compartment, editor.selectionSet)!
        expect(group.objects[0]).toBe(compartment)
        expect(group.objects.map(object => object.id)).toContain(STORE_E)

        const startBox = boxOf(compartment)
        const from = { x: centre.x, y: centre.y }
        const to = { x: centre.x + 100, y: centre.y + 60 }
        const undoState = undoRedo.setMoveUndoState(compartment, from, editor.selectionSet, group)
        editor.selectionSet.startMove(from, compartment, group)
        editor.selectionSet.move(to)
        editor.selectionSet.endMove()
        expect(undoRedo.endMove(undoState, to)).toBe(true)
        const moved = centreOf(diagram, STORE_E)
        expect(moved.x - centre.x).toBeCloseTo(100, 0)
        expect(boxOf(compartment).x - startBox.x).toBeCloseTo(100, 0)

        editor.undo()
        await settle()
        expect(centreOf(diagram, STORE_E).x).toBeCloseTo(centre.x, 0)
        expect(boxOf(compartment).x).toBeCloseTo(startBox.x, 0)
        editor.redo()
        await settle()
        expect(centreOf(diagram, STORE_E).x).toBeCloseTo(moved.x, 0)
    })

    test('deleted leaves its contents, and undoing puts it back behind them', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const compartment = placeSpatial(diagram, 'compartment', boundsRound(centreOf(diagram, STORE_E), 80))
        const layer = compartment.svgElement!.parentNode!
        // (the location shading, drawn over the boxes when it is next redrawn, isn't part of the diagram)
        const ids = () => [...layer.children].filter(element => !element.classList.contains('editor-specific'))
                                             .map(element => element.id)
        const order = ids()
        editor.selectionSet.clear()
        editor.setSelectedObject(compartment)
        editor.selectionSet.deleteObjects()
        expect(compartments(diagram)).toEqual([])
        expect(diagram.objectById(STORE_E)).not.toBeNull()
        editor.undo()
        await settle()
        expect(ids()).toEqual(order)
        expect(diagram.objectById(compartment.id)?.isCompartment).toBe(true)
    })

    test('is saved as a CellDL compartment, with its walls in the diagram', async () => {
        // (happy-dom can't serialise a diagram's CDATA metadata, so a save and reopen is checked in a browser)
        const diagram = await openFixture('enzyme.celldl')
        const region = placeSpatial(diagram, 'region', new Bounds(40, 40, 240, 200))
        const rdf = await diagram.rdf()
        expect(rdf).toContain(region.id)
        expect(rdf).toMatch(/celldl:Compartment/)
        expect(diagram.svgDiagram.querySelector(`#${region.id}`)?.classList.contains('celldl-Compartment')).toBe(true)
    })
})
