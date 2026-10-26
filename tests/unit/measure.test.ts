import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { editor, openFixture } from './support/editor'

import type { CellDLDiagram } from '#editor/diagram'
import type { CellDLObject } from '#editor/celldlObjects'
import type { CellDLSVGElement } from '#editor/SVGElements'
import { setElements } from '#root/plugins/bondgraph/elements'
import type { Point } from '#root/utils/points'

//==============================================================================

// In the enzyme fixture: S's store, drawn at `matrix(1,0,0,1,0,-100)`, and its bond to its 0-junction
const STORE_S = 'ID-00000001'
const BOND_S = 'ID-00000015'

// The fixture's pictures are 44 x 30; a typeset one is 36 x 28 here
const FIXTURE_SIZE = { width: 44, height: 30 }
const TYPESET_SIZE = { width: 36, height: 28 }
const LOAD_DELAY = 10

//==============================================================================

// Measure as Safari and Firefox do: an `<image>` has no size until its picture
// loads, and a group's transform attribute isn't in its computed style (as in
// happy-dom too)

type Box = { x: number, y: number, width: number, height: number }
type Decode = (this: SVGImageElement) => Promise<void>

const NO_BOX: Box = { x: 0, y: 0, width: 0, height: 0 }

const loaded: WeakSet<Element> = new WeakSet()
const getBBox = SVGGraphicsElement.prototype.getBBox
// happy-dom has `decode()`, TypeScript's DOM types don't
const imagePrototype = SVGImageElement.prototype as SVGImageElement & { decode?: Decode }
const decode = imagePrototype.decode

function attribute(element: Element, name: string): number {
    return Number.parseFloat(element.getAttribute(name) ?? '0')
}

function measure(element: Element): Box|null {
    const tag = element.tagName.toLowerCase()
    if (tag === 'image') {
        const size = (element.getAttribute('href') ?? '').includes(';base64,') ? FIXTURE_SIZE : TYPESET_SIZE
        return loaded.has(element) ? { x: 0, y: 0, ...size } : NO_BOX
    } else if (tag === 'rect') {
        return {
            x: attribute(element, 'x'),
            y: attribute(element, 'y'),
            width: attribute(element, 'width'),
            height: attribute(element, 'height')
        }
    } else if (tag === 'g') {
        const boxes = [...element.children].map(measure)
                                           .filter((box): box is Box => box !== null && (box.width > 0 || box.height > 0))
        if (boxes.length === 0) {
            return NO_BOX
        }
        const left = Math.min(...boxes.map(box => box.x))
        const top = Math.min(...boxes.map(box => box.y))
        const right = Math.max(...boxes.map(box => box.x + box.width))
        const bottom = Math.max(...boxes.map(box => box.y + box.height))
        return { x: left, y: top, width: right - left, height: bottom - top }
    }
    return null
}

beforeAll(() => {
    SVGGraphicsElement.prototype.getBBox = function (this: SVGGraphicsElement) {
        const box = measure(this)
        return box ? new DOMRect(box.x, box.y, box.width, box.height) : getBBox.call(this)
    }
    imagePrototype.decode = function (this: SVGImageElement) {
        return new Promise<void>(resolve => setTimeout(() => {
            loaded.add(this)
            resolve()
        }, LOAD_DELAY))
    }
})

afterAll(() => {
    SVGGraphicsElement.prototype.getBBox = getBBox
    imagePrototype.decode = decode
})

//==============================================================================

function object(diagram: CellDLDiagram, id: string): CellDLObject {
    const found = diagram.objectById(id)
    expect(found).not.toBeNull()
    return found as CellDLObject
}

function svgElement(object: CellDLObject): CellDLSVGElement {
    expect(object.celldlSvgElement).not.toBeNull()
    return object.celldlSvgElement as CellDLSVGElement
}

function selectionSize(diagram: CellDLDiagram, id: string): { width: number, height: number } {
    const rect = diagram.svgDiagram?.querySelector(`[id="${id}"] > rect.selection-element`)
    expect(rect).toBeDefined()
    return { width: attribute(rect as Element, 'width'), height: attribute(rect as Element, 'height') }
}

function pathPoints(diagram: CellDLDiagram, id: string): Point[] {
    const d = diagram.svgDiagram?.querySelector(`path[id="${id}"]`)?.getAttribute('d') ?? ''
    return [...d.matchAll(/[ML]\s*(-?[\d.]+)[ ,](-?[\d.]+)/g)].map(match => ({ x: Number(match[1]), y: Number(match[2]) }) as Point)
}

function first(points: Point[]): Point {
    expect(points.length).toBeGreaterThan(1)
    return points[0] as Point
}

function last(points: Point[]): Point {
    expect(points.length).toBeGreaterThan(1)
    return points[points.length - 1] as Point
}

//==============================================================================

describe('measuring elements whose pictures load late', () => {
    test("a diagram's elements are measured once their pictures load", async () => {
        const diagram = await openFixture('enzyme.celldl')
        const size = selectionSize(diagram, STORE_S)
        expect(size.width).toBeGreaterThan(FIXTURE_SIZE.width)
        expect(size.height).toBeGreaterThan(FIXTURE_SIZE.height)
        // Where its transform attribute puts it
        const centroid = svgElement(object(diagram, STORE_S)).centroid
        expect(centroid.x).toBeCloseTo(FIXTURE_SIZE.width / 2)
        expect(centroid.y).toBeCloseTo(FIXTURE_SIZE.height / 2 - 100)
    })

    test('a set stays where it was, sized to its new picture, keeping its bonds', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const store = svgElement(object(diagram, STORE_S))
        const centroid = store.centroid
        const before = pathPoints(diagram, BOND_S)

        const result = await setElements(editor, diagram, [{ id: STORE_S, field: 'species', value: 'Glc' }])
        expect(result).toEqual({ ok: true })

        const size = selectionSize(diagram, STORE_S)
        expect(size.width).toBeGreaterThan(TYPESET_SIZE.width)
        expect(size.width).toBeLessThan(FIXTURE_SIZE.width)
        expect(size.height).toBeGreaterThan(TYPESET_SIZE.height)
        expect(store.centroid.x).toBeCloseTo(centroid.x)
        expect(store.centroid.y).toBeCloseTo(centroid.y)
        expect(store.svgElement.getAttribute('transform')).toMatch(/,-99(\.\d+)?\)$/)

        // The bond keeps its route: only its end at the store moves, to the store's new edge
        const after = pathPoints(diagram, BOND_S)
        expect(after).toHaveLength(before.length)
        expect(first(after).x).toBeCloseTo(first(before).x)
        expect(last(after).x).toBeCloseTo(last(before).x)
        expect(Math.abs(last(after).y - (store.centroid.y + TYPESET_SIZE.height / 2))).toBeLessThanOrEqual(3)
    })

    test('it can still be selected and dragged, and its bond follows', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const store = object(diagram, STORE_S)
        await setElements(editor, diagram, [{ id: STORE_S, field: 'location', value: 'cyt' }])
        const element = svgElement(store)
        const start = element.centroid
        const before = pathPoints(diagram, BOND_S)

        // Where it is drawn, not just at its centre
        expect(store.containsPoint(start)).toBe(true)
        expect(store.containsPoint(start.add({ x: TYPESET_SIZE.width / 2 - 2, y: TYPESET_SIZE.height / 2 - 2 }))).toBe(true)
        expect(element.isMoveable(element.svgElement)).toBe(true)

        store.initialiseMove(element.svgElement)
        store.startMove(start)
        store.move(start.add({ x: 40, y: 0 }))
        store.endMove()
        store.finaliseMove()

        // (to the nearest grid point)
        expect(Math.abs(element.centroid.x - (start.x + 40))).toBeLessThanOrEqual(10)
        expect(Math.abs(element.centroid.y - start.y)).toBeLessThanOrEqual(10)
        expect(last(pathPoints(diagram, BOND_S)).x).toBeGreaterThan(last(before).x + 10)
    })
})
