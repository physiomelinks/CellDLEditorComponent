import { describe, expect, test } from 'bun:test'

import PanZoom, { isZoomWheel, PINCH_MAX_DELTA, PINCH_RATE, pinchZoomFactor } from '../../src/CellDL/editor/panzoom'

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

    test('a plain wheel still zooms the diagram but leaves the page its scroll', () => {
        const { panzoom, container } = diagram()
        const before = panzoom.scale
        const event = wheel({ deltaY: -10 })
        container.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(false)
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
