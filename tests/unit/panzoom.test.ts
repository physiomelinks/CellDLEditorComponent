import { describe, expect, test } from 'bun:test'

import PanZoom, { isZoomWheel, PINCH_MAX_DELTA, PINCH_RATE, pinchZoomFactor, wheelPanDelta } from '../../src/CellDL/editor/panzoom'

function diagram(): { panzoom: PanZoom, container: HTMLElement, svg: SVGSVGElement } {
    const container = document.createElement('div')
    container.id = `panzoom-${Math.random()}`
    // happy-dom does no layout, so give the container a size
    Object.defineProperty(container, 'clientWidth', { value: 200 })
    Object.defineProperty(container, 'clientHeight', { value: 200 })
    document.body.appendChild(container)
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 100 100')
    container.appendChild(svg)
    const panzoom = new PanZoom(container)
    panzoom.enable(svg)
    return { panzoom, container, svg }
}

function wheel(init: WheelEventInit): WheelEvent {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init })
    // happy-dom's WheelEvent leaves out the modifier keys
    Object.defineProperty(event, 'ctrlKey', { value: !!init.ctrlKey })
    Object.defineProperty(event, 'metaKey', { value: !!init.metaKey })
    Object.defineProperty(event, 'shiftKey', { value: !!init.shiftKey })
    return event
}

describe('zooming the diagram with a pinch or Ctrl/Cmd+wheel', () => {
    test('a pinch, Ctrl+wheel and Cmd+wheel are zoom gestures; a plain wheel is not', () => {
        expect(isZoomWheel({ ctrlKey: true, metaKey: false })).toBe(true)
        expect(isZoomWheel({ ctrlKey: false, metaKey: true })).toBe(true)
        expect(isZoomWheel({ ctrlKey: false, metaKey: false })).toBe(false)
    })

    test('a pinch zooms in proportion to how far it moves, and a wheel notch by no more than a step', () => {
        expect(pinchZoomFactor({ deltaX: 0, deltaY: -4, deltaMode: 0 })).toBeCloseTo(Math.exp(4 * PINCH_RATE))
        expect(pinchZoomFactor({ deltaX: 0, deltaY: 4, deltaMode: 0 })).toBeCloseTo(Math.exp(-4 * PINCH_RATE))
        expect(pinchZoomFactor({ deltaX: 0, deltaY: -100, deltaMode: 0 })).toBeCloseTo(Math.exp(PINCH_MAX_DELTA * PINCH_RATE))
        expect(pinchZoomFactor({ deltaX: 0, deltaY: 3, deltaMode: 1 })).toBeCloseTo(Math.exp(-PINCH_MAX_DELTA * PINCH_RATE))
        expect(pinchZoomFactor({ deltaX: 0, deltaY: 0, deltaMode: 0 })).toBe(1)
    })

    test('over the diagram, a pinch zooms the diagram and keeps the browser from zooming the page', () => {
        const { panzoom, container } = diagram()
        const before = panzoom.scale
        const event = wheel({ deltaY: -10, ctrlKey: true })
        container.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(true)
        expect(panzoom.scale).toBeGreaterThan(before)
    })

    test('with no diagram open, the browser keeps its own pinch zoom', () => {
        const { panzoom, container } = diagram()
        panzoom.disable()
        const event = wheel({ deltaY: -10, ctrlKey: true })
        container.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(false)
    })

    test('Safari\'s pinch gestures zoom the diagram by their change of scale, not the page', () => {
        const { panzoom, container } = diagram()
        const before = panzoom.scale
        const gesture = (type: string, scale: number) => {
            const event = Object.assign(new UIEvent(type, { bubbles: true, cancelable: true }), { scale, clientX: 0, clientY: 0 })
            container.dispatchEvent(event)
            return event
        }
        expect(gesture('gesturestart', 1).defaultPrevented).toBe(true)
        expect(gesture('gesturechange', 1.5).defaultPrevented).toBe(true)
        // Safari's own wheel events for the same pinch are cancelled but don't zoom again
        const duplicate = wheel({ deltaY: -10, ctrlKey: true })
        container.dispatchEvent(duplicate)
        expect(duplicate.defaultPrevented).toBe(true)
        expect(gesture('gesturechange', 2).defaultPrevented).toBe(true)
        expect(gesture('gestureend', 2).defaultPrevented).toBe(true)
        expect(panzoom.scale).toBeCloseTo(Math.min(before * 2, 32))
    })

    test('a Safari pinch that ends after its diagram closes still lets Ctrl/Cmd+wheel zoom the next one', () => {
        const { panzoom, container, svg } = diagram()
        const gesture = (type: string, scale: number) => {
            const event = Object.assign(new UIEvent(type, { bubbles: true, cancelable: true }), { scale, clientX: 0, clientY: 0 })
            container.dispatchEvent(event)
            return event
        }
        gesture('gesturestart', 1)
        panzoom.disable()
        expect(gesture('gestureend', 1.5).defaultPrevented).toBe(false)
        panzoom.enable(svg)
        const before = panzoom.scale
        container.dispatchEvent(wheel({ deltaY: -10, ctrlKey: true }))
        expect(panzoom.scale).toBeGreaterThan(before)
    })
})

describe('panning the diagram with a plain wheel or two-finger scroll', () => {
    const viewbox = (svg: SVGSVGElement) => svg.getAttribute('viewBox')!.split(' ').map(Number)

    test('a wheel pans by its deltas, in pixels, lines or pages', () => {
        const page = { x: 300, y: 200 }
        expect(wheelPanDelta({ deltaX: 5, deltaY: -7, deltaMode: 0, shiftKey: false }, page)).toEqual(expect.objectContaining({ x: 5, y: -7 }))
        expect(wheelPanDelta({ deltaX: 0, deltaY: 3, deltaMode: 1, shiftKey: false }, page)).toEqual(expect.objectContaining({ x: 0, y: 48 }))
        expect(wheelPanDelta({ deltaX: 1, deltaY: -1, deltaMode: 2, shiftKey: false }, page)).toEqual(expect.objectContaining({ x: 300, y: -200 }))
    })

    test('Shift+wheel with only a vertical delta pans across', () => {
        const page = { x: 300, y: 200 }
        expect(wheelPanDelta({ deltaX: 0, deltaY: 10, deltaMode: 0, shiftKey: true }, page)).toEqual(expect.objectContaining({ x: 10, y: 0 }))
        expect(wheelPanDelta({ deltaX: 0, deltaY: 2, deltaMode: 1, shiftKey: true }, page)).toEqual(expect.objectContaining({ x: 32, y: 0 }))
        // A browser that has already turned it into a horizontal delta is left as it is
        expect(wheelPanDelta({ deltaX: 10, deltaY: 0, deltaMode: 0, shiftKey: true }, page)).toEqual(expect.objectContaining({ x: 10, y: 0 }))
    })

    test('over the diagram, a plain wheel pans it without zooming, and keeps the page from scrolling', () => {
        const { panzoom, svg } = diagram()
        const before = viewbox(svg)
        const scale = panzoom.scale
        const event = wheel({ deltaX: 20, deltaY: -40 })
        svg.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(true)
        expect(panzoom.scale).toBe(scale)
        const after = viewbox(svg)
        // Screen pixels, so the view moves by less of the diagram the further it's zoomed in
        expect(after[0] - before[0]).toBeCloseTo(20 / scale)
        expect(after[1] - before[1]).toBeCloseTo(-40 / scale)
        expect(after.slice(2)).toEqual(before.slice(2))
    })

    test('a wheel pans the same distance on screen whatever the zoom', () => {
        const { panzoom, container, svg } = diagram()
        panzoom.zoomBy(4)
        const before = viewbox(svg)
        container.dispatchEvent(wheel({ deltaY: 3, deltaMode: 1 }))
        expect(viewbox(svg)[1] - before[1]).toBeCloseTo(48 / panzoom.scale)
    })

    test('Ctrl+wheel zooms rather than pans', () => {
        const { panzoom, container } = diagram()
        const before = panzoom.scale
        const event = wheel({ deltaY: 40, ctrlKey: true })
        container.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(true)
        expect(panzoom.scale).toBeLessThan(before)
    })

    test('with no diagram open, a wheel scrolls the page as usual', () => {
        const { panzoom, container } = diagram()
        panzoom.disable()
        const event = wheel({ deltaY: 40 })
        container.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(false)
    })

    test('over an overlay on the canvas, such as a menu, a wheel is left for it to scroll', () => {
        const { container, svg } = diagram()
        const menu = document.createElement('div')
        container.appendChild(menu)
        const before = viewbox(svg)
        const event = wheel({ deltaY: 40 })
        menu.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(false)
        expect(viewbox(svg)).toEqual(before)
    })
})
