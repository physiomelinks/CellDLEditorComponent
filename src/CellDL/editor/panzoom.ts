/******************************************************************************

CellDL Editor

Copyright (c) 2022 - 2025 David Brooks

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

******************************************************************************/

import type { Bounds, Extent } from '#editor/geometry'

import { getViewbox } from '#root/utils/svgUtils'
import { Point, type PointLike } from '#root/utils/points'

import { editGuides } from './editguides'

//==============================================================================

/** How much a zoom button or key changes the scale */
export const ZOOM_STEP = 1.25

/** The margin around the diagram when zooming to fit, as a fraction of its size */
export const FIT_MARGIN = 0.05

/** How far one pixel of a pinch, or of Ctrl/Cmd+wheel, zooms, as a power of e */
export const PINCH_RATE = 0.01

/** The most one pinch or Ctrl/Cmd+wheel event zooms by, in pixels of `deltaY` */
export const PINCH_MAX_DELTA = 25

/** Pixels per line, for a wheel that reports its deltas in lines */
const LINE_HEIGHT = 16

/**
 * Whether a wheel event is a zoom gesture: a trackpad pinch, which browsers send as a wheel event with
 * `ctrlKey` set, or a wheel turned with Ctrl or Cmd held. The browser would zoom the page for these.
 */
export function isZoomWheel(event: Pick<WheelEvent, 'ctrlKey' | 'metaKey'>): boolean {
    return event.ctrlKey || event.metaKey
}

/**
 * How far a plain wheel or two-finger scroll pans the view, in screen pixels: its deltas, from lines
 * or pages if that's how the wheel reports them. Shift+wheel with only a vertical delta, as a mouse
 * wheel sends, pans across.
 */
export function wheelPanDelta(event: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode' | 'shiftKey'>,
                              pageSize: PointLike): Point {
    let delta = new Point(event.deltaX, event.deltaY)
    if (event.shiftKey && delta.x === 0) {
        delta = new Point(delta.y, 0)
    }
    if (event.deltaMode === 1) {
        delta = delta.scalarScale(LINE_HEIGHT)
    } else if (event.deltaMode === 2) {
        delta = new Point(delta.x * pageSize.x, delta.y * pageSize.y)
    }
    return delta
}

/**
 * The factor a pinch, or Ctrl/Cmd+wheel, zooms by: in proportion to how far it moved, so a pinch
 * follows the fingers, and at most a step's worth for a mouse wheel's notch.
 */
export function pinchZoomFactor(event: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode'>): number {
    let delta = event.deltaY === 0 && event.deltaX ? event.deltaX : event.deltaY
    if (event.deltaMode === 1) {
        delta *= LINE_HEIGHT
    } else if (event.deltaMode === 2) {
        delta = Math.sign(delta) * PINCH_MAX_DELTA
    }
    delta = Math.min(Math.max(delta, -PINCH_MAX_DELTA), PINCH_MAX_DELTA)
    return Math.exp(-delta * PINCH_RATE)
}

//==============================================================================

/**
 * What a plain wheel (no Ctrl/Cmd) does over the diagram: `'auto'` zooms for a
 * mouse wheel and pans for a trackpad's two-finger scroll, `'pan'` always pans
 * and `'zoom'` always zooms. A pinch and Ctrl/Cmd+wheel zoom whatever the mode,
 * and Shift+wheel pans across.
 */
export type WheelMode = 'auto' | 'pan' | 'zoom'

export const WHEEL_MODES: readonly WheelMode[] = ['auto', 'pan', 'zoom']

export const DEFAULT_WHEEL_MODE: WheelMode = 'auto'

export function wheelModeOrDefault(mode: string | undefined | null): WheelMode {
    return WHEEL_MODES.includes(mode as WheelMode) ? mode as WheelMode : DEFAULT_WHEEL_MODE
}

/** What sent a wheel event */
export type WheelDevice = 'mouse' | 'trackpad'

/** A wheel event, with the non-standard `wheelDeltaY` most browsers still send */
export type WheelLike = Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode'> & { wheelDeltaY?: number }

/** One notch of a mouse wheel, in the non-standard `wheelDeltaY` */
const WHEEL_DELTA_NOTCH = 120

/** Chromium's and Safari's `deltaY` per notch of a mouse wheel on macOS, which isn't a whole number */
const MAC_NOTCH_DELTA = 4.000244140625

/** A whole-pixel `deltaY` at least this large, with no `deltaX`, is a mouse wheel's notch */
const MOUSE_MIN_PIXEL_DELTA = 40

/**
 * Whether a wheel event came from a mouse wheel or a trackpad. Browsers don't say, so this goes by
 * what each sends, in order:
 *
 * - `deltaMode` in lines or pages: a mouse (Firefox, unless its pixel mode is on). Firefox reports
 *   lines only when `deltaMode` is read before the deltas, so it's read first.
 * - any `deltaX`: a trackpad, as a mouse wheel scrolls only one way (macOS turns Shift+wheel into
 *   `deltaX`, which pans either way).
 * - `wheelDeltaY` a non-zero multiple of 120: a mouse's notches (Chromium on Windows and macOS,
 *   Safari, Firefox). A trackpad's `wheelDeltaY` is `-3 * deltaY`, which is seldom a multiple of 120
 *   in a gesture's first event.
 * - `deltaY` a multiple of 4.000244140625: a mouse on macOS in Chromium or Safari.
 * - a fractional `deltaY`: a trackpad (also covers Windows' scaled deltas without `wheelDeltaY`).
 * - a whole `deltaY` of 40 pixels or more: a mouse (Chromium on Windows sends 100 a notch, Firefox
 *   in pixel mode about 48 to 57). Smaller whole deltas: a trackpad.
 *
 * It's a guess, so the first event of a gesture decides it for the whole gesture: see `WheelGestures`.
 */
export function wheelDevice(event: WheelLike): WheelDevice {
    const deltaMode = event.deltaMode
    if (deltaMode === 1 || deltaMode === 2) {
        return 'mouse'
    }
    if (event.deltaX) {
        return 'trackpad'
    }
    const deltaY = event.deltaY
    const wheelDeltaY = event.wheelDeltaY
    if (wheelDeltaY && wheelDeltaY % WHEEL_DELTA_NOTCH === 0) {
        return 'mouse'
    }
    const macNotches = Math.abs(deltaY) / MAC_NOTCH_DELTA
    if (deltaY && Math.abs(macNotches - Math.round(macNotches)) < 1e-9) {
        return 'mouse'
    }
    if (!Number.isInteger(deltaY)) {
        return 'trackpad'
    }
    return Math.abs(deltaY) >= MOUSE_MIN_PIXEL_DELTA ? 'mouse' : 'trackpad'
}

/** Wheel events closer together than this, in milliseconds, are one gesture */
export const WHEEL_GESTURE_GAP = 200

/**
 * Wheel events grouped into gestures: a burst with gaps of less than `WHEEL_GESTURE_GAP`, such as a
 * trackpad scroll and its momentum tail, or a mouse wheel spun. Each gesture keeps the device its
 * first event was taken for, so a scroll never switches between panning and zooming part way.
 */
export class WheelGestures {
    #device: WheelDevice | null = null
    #lastTime: number = -Infinity

    /** The device of the gesture that a wheel event, at a time in milliseconds, is part of */
    device(event: WheelLike, time: number): WheelDevice {
        if (this.#device === null || time - this.#lastTime >= WHEEL_GESTURE_GAP || time < this.#lastTime) {
            this.#device = wheelDevice(event)
        }
        this.#lastTime = time
        return this.#device
    }

    reset() {
        this.#device = null
        this.#lastTime = -Infinity
    }
}

/** How much one notch of a mouse wheel zooms by: two notches make a zoom button's step */
export const WHEEL_ZOOM_STEP = Math.sqrt(ZOOM_STEP)

/**
 * The factor a mouse wheel zooms by, `WHEEL_ZOOM_STEP` a notch, rolling forward (away from you) to
 * zoom in. Its notches come from `wheelDeltaY` or, in lines, three lines a notch; otherwise it's one.
 */
export function wheelZoomFactor(event: WheelLike): number {
    const deltaMode = event.deltaMode
    const deltaY = event.deltaY
    if (!deltaY) {
        return 1
    }
    let notches = 1
    if (event.wheelDeltaY && event.wheelDeltaY % WHEEL_DELTA_NOTCH === 0) {
        notches = Math.abs(event.wheelDeltaY) / WHEEL_DELTA_NOTCH
    } else if (deltaMode === 1) {
        notches = Math.max(1, Math.round(Math.abs(deltaY) / 3))
    }
    // However many notches a coalesced event carries, at most a few at once
    notches = Math.min(notches, 4)
    return WHEEL_ZOOM_STEP ** (-Math.sign(deltaY) * notches)
}

/** Safari's pinch event, which isn't in TypeScript's DOM types */
interface GestureEvent extends UIEvent {
    readonly scale: number
    readonly clientX: number
    readonly clientY: number
}

/** Told the view's scale after each change of view */
export type ViewChangedHandler = (scale: number) => void

//==============================================================================

export default class PanZoom {
    #panning: boolean = false
    #pointerDownPosition: Point = new Point()

    #svgDiagram: SVGSVGElement | null = null
    #container: HTMLElement
    #containerId: string
    #containerSize: Point = new Point()
    #resizeObserver: ResizeObserver

    #minScale: number = 0.125
    #scale: number = 1
    #maxScale: number = 32

    #viewChanged: ViewChangedHandler | null = null

    /** Safari's pinch scale at its last event, while a pinch is under way */
    #gestureScale: number | null = null

    #wheelMode: WheelMode = DEFAULT_WHEEL_MODE
    #wheelGestures = new WheelGestures()

    constructor(container: HTMLElement, viewChanged: ViewChangedHandler | null = null) {
        this.#viewChanged = viewChanged
        // Not passive, so that a pinch or Ctrl/Cmd+wheel over the diagram zooms only the diagram,
        // and not the page as well, and so that a plain wheel or two-finger scroll pans or zooms the
        // diagram, as `wheelMode` says, rather than scrolling the page.
        container.addEventListener('wheel', this.#wheelEvent.bind(this), { passive: false })
        // Safari sends a trackpad pinch as gesture events, and zooms the page unless they're cancelled
        container.addEventListener('gesturestart', this.#gestureEvent.bind(this) as EventListener)
        container.addEventListener('gesturechange', this.#gestureEvent.bind(this) as EventListener)
        container.addEventListener('gestureend', this.#gestureEvent.bind(this) as EventListener)
        this.#container = container
        this.#containerId = container.id
        this.#containerSize = new Point(container.clientWidth, container.clientHeight)
        this.#resizeObserver = new ResizeObserver(this.#resizeObservation.bind(this))
        this.#resizeObserver.observe(container)
    }

    get panning() {
        return this.#panning
    }

    get scale() {
        return this.#scale
    }

    /** What a plain wheel does over the diagram */
    get wheelMode(): WheelMode {
        return this.#wheelMode
    }

    set wheelMode(mode: WheelMode) {
        this.#wheelMode = wheelModeOrDefault(mode)
        this.#wheelGestures.reset()
    }

    #currentViewbox(): Extent {
        return getViewbox(this.#svgDiagram as SVGSVGElement)
    }

    #setViewbox(viewbox: Extent) {
        editGuides.viewboxUpdated(viewbox)
        this.#svgDiagram?.setAttribute('viewBox', viewbox.map((n) => String(n)).join(' '))
        this.#viewChanged?.(this.#scale)
    }

    enable(svgDiagram: SVGSVGElement) {
        // Scale large diagrams down to fit container
        let viewbox = getViewbox(svgDiagram)
        if (viewbox[2] * this.#containerSize.y >= viewbox[3] * this.#containerSize.x) {
            // Too wide, so scale width
            this.#scale = this.#containerSize.x / viewbox[2]
            viewbox[1] -= (this.#containerSize.y / this.#scale - viewbox[3]) / 2
            viewbox[3] = this.#containerSize.y / this.#scale
        } else {
            // Too high, so scale height
            this.#scale = this.#containerSize.y / viewbox[3]
            viewbox[0] -= (this.#containerSize.x / this.#scale - viewbox[2]) / 2
            viewbox[2] = this.#containerSize.x / this.#scale
        }
        if (this.#minScale > this.#scale) {
            this.#minScale = this.#scale
        }

        // Otherwise centre small diagrams that don't require scaling down
        if (this.#scale >= 1) {
            this.#scale = 1
            viewbox = getViewbox(svgDiagram)
            const delta = this.#containerSize.subtract({ x: viewbox[2], y: viewbox[3] })
            viewbox[0] -= delta.x / 2
            viewbox[1] -= delta.y / 2
            viewbox[2] = this.#containerSize.x
            viewbox[3] = this.#containerSize.y
        }

        this.#svgDiagram = svgDiagram
        this.#setViewbox(viewbox)
        this.#panning = false
    }

    disable() {
        this.#svgDiagram = null
        this.#panning = false
        this.#gestureScale = null
        this.#scale = 1.0
        this.#viewChanged?.(this.#scale)
    }

    /**
     * Zooms by a factor, keeping a point (in SVG coordinates) where it is in the
     * view, by default the view's centre. The scale stays within its limits.
     */
    zoomBy(factor: number, about: PointLike|null = null) {
        if (!this.#svgDiagram) {
            return
        }
        const viewbox = this.#currentViewbox()
        const centre = about ?? { x: viewbox[0] + viewbox[2] / 2, y: viewbox[1] + viewbox[3] / 2 }
        this.#scale = Math.min(Math.max(this.#scale * factor, this.#minScale), this.#maxScale)
        const width = this.#containerSize.x / this.#scale
        const height = this.#containerSize.y / this.#scale
        viewbox[0] = centre.x - (centre.x - viewbox[0]) * width / viewbox[2]
        viewbox[1] = centre.y - (centre.y - viewbox[1]) * height / viewbox[3]
        viewbox[2] = width
        viewbox[3] = height
        this.#setViewbox(viewbox)
    }

    /**
     * The scale at which bounds (in SVG coordinates) fill the view, with a margin
     * around them, at most `maxScale`; null with no diagram, bounds or container size.
     */
    fitScale(bounds: Bounds|null, margin: number = FIT_MARGIN, maxScale: number = this.#maxScale): number|null {
        this.#measureContainer()
        if (!this.#svgDiagram || bounds === null || this.#containerSize.x === 0 || this.#containerSize.y === 0) {
            return null
        }
        const width = Math.max(bounds.right - bounds.left, 1) * (1 + 2 * margin)
        const height = Math.max(bounds.bottom - bounds.top, 1) * (1 + 2 * margin)
        return Math.min(this.#containerSize.x / width, this.#containerSize.y / height, maxScale, this.#maxScale)
    }

    /**
     * Zooms and pans so that bounds (in SVG coordinates) fill the view, with a
     * margin around them, zooming in no further than `maxScale`. The smallest
     * scale is lowered if need be.
     */
    zoomToFit(bounds: Bounds|null, margin: number = FIT_MARGIN, maxScale: number = this.#maxScale) {
        const scale = this.fitScale(bounds, margin, maxScale)
        if (scale === null || bounds === null) {
            return
        }
        if (this.#minScale > scale) {
            this.#minScale = scale
        }
        this.zoomTo(scale, { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 })
    }

    /**
     * Zooms to a scale, within its limits, with a point (in SVG coordinates) at the
     * centre of the view, by default the view's centre.
     */
    zoomTo(scale: number, centre: PointLike|null = null) {
        if (!this.#svgDiagram || !Number.isFinite(scale) || scale <= 0) {
            return
        }
        this.#measureContainer()
        const about = centre ?? this.centre
        this.#scale = Math.min(Math.max(scale, this.#minScale), this.#maxScale)
        const viewWidth = this.#containerSize.x / this.#scale
        const viewHeight = this.#containerSize.y / this.#scale
        this.#setViewbox([about.x - viewWidth / 2, about.y - viewHeight / 2, viewWidth, viewHeight])
    }

    /**
     * Takes the container's size as it is now, as a host may set the view as soon as it has moved the editor,
     * before the resize is observed, which would then keep the view's top left rather than its centre.
     */
    #measureContainer() {
        const size = new Point(this.#container.clientWidth, this.#container.clientHeight)
        if (size.x > 0 && size.y > 0 && (size.x !== this.#containerSize.x || size.y !== this.#containerSize.y)) {
            const viewbox = this.#svgDiagram ? this.#currentViewbox() : null
            this.#containerSize = size
            if (viewbox) {
                // The view as the resize would leave it, so its centre is where it shows
                viewbox[2] = size.x / this.#scale
                viewbox[3] = size.y / this.#scale
                this.#setViewbox(viewbox)
            }
        }
    }

    /** The point (in SVG coordinates) at the centre of the view */
    get centre(): Point {
        if (!this.#svgDiagram) {
            return new Point()
        }
        const [x, y, width, height] = this.#currentViewbox()
        return new Point(x + width / 2, y + height / 2)
    }

    /** Pans so that a point is at the centre of the view, without zooming. */
    centreOn(point: PointLike) {
        if (this.#svgDiagram) {
            const viewbox = this.#currentViewbox()
            viewbox[0] = point.x - viewbox[2] / 2
            viewbox[1] = point.y - viewbox[3] / 2
            this.#setViewbox(viewbox)
        }
    }

    /** Whether bounds, in SVG coordinates, are wholly in view. */
    inView(bounds: Bounds): boolean {
        if (!this.#svgDiagram) {
            return false
        }
        const [x, y, width, height] = this.#currentViewbox()
        return bounds.left >= x && bounds.right <= x + width
            && bounds.top >= y && bounds.bottom <= y + height
    }

    pointerDown(event: PointerEvent) {
        this.#panning = true
        this.#pointerDownPosition = Point.fromPoint(event)
    }

    pointerMove(event: PointerEvent): boolean {
        if (this.#svgDiagram && this.#panning) {
            const delta = this.#pointerDownPosition.subtract(event)
            if (!delta.isZero()) {
                this.panBy(delta)
                this.#pointerDownPosition = Point.fromPoint(event)
                return true
            }
        }
        return false
    }

    pointerUp(_event: PointerEvent) {
        this.#panning = false
    }

    #resizeObservation(entries: ResizeObserverEntry[]) {
        if (this.#svgDiagram) {
            for (const entry of entries) {
                if (entry.target.id === this.#containerId) {
                    const containerSize = new Point(entry.contentRect.width, entry.contentRect.height)
                    // Don't do anything if the container has no size...
                    if (containerSize.x === 0 ||containerSize.y === 0) {
                        return
                    }
                    // Keep the scale and the view's top left, so the diagram stays where it is
                    const viewbox = this.#currentViewbox()
                    viewbox[2] = containerSize.x / this.#scale
                    viewbox[3] = containerSize.y / this.#scale
                    this.#containerSize = containerSize
                    this.#setViewbox(viewbox)
                }
            }
        }
    }

    #wheelEvent(event: WheelEvent) {
        if (!this.#svgDiagram) {
            return
        }
        // Firefox reports a mouse wheel in lines only when deltaMode is read before the deltas
        void event.deltaMode
        if (isZoomWheel(event)) {
            // Keep the browser from zooming the page as well
            event.preventDefault()
            if (this.#gestureScale === null) {
                // Safari's gesture events are already zooming a pinch
                this.#zoomAboutClient(pinchZoomFactor(event), event.clientX, event.clientY)
            }
        } else if (event.target === this.#container
                || (event.target instanceof Node && this.#svgDiagram.contains(event.target))) {
            // Over the diagram, not an overlay such as a menu, which keeps its own scroll
            event.preventDefault()
            // Every event joins its gesture, so one with Shift held part way doesn't start a new one
            const device = this.#wheelGestures.device(event as WheelLike, event.timeStamp)
            const zoom = !event.shiftKey && event.deltaY !== 0
                      && (this.#wheelMode === 'zoom' || (this.#wheelMode === 'auto' && device === 'mouse'))
            if (!zoom) {
                this.panBy(wheelPanDelta(event, this.#containerSize))
            } else if (device === 'mouse') {
                this.#zoomAboutClient(wheelZoomFactor(event as WheelLike), event.clientX, event.clientY)
            } else {
                // A trackpad scroll, in zoom mode, zooms smoothly as a pinch does
                this.#zoomAboutClient(pinchZoomFactor(event), event.clientX, event.clientY)
            }
        }
    }

    /** Pans the view by a distance in screen pixels, without zooming, as dragging the canvas does. */
    panBy(delta: PointLike) {
        if (this.#svgDiagram && (delta.x || delta.y)) {
            const viewbox = this.#currentViewbox()
            viewbox[0] += delta.x / this.#scale
            viewbox[1] += delta.y / this.#scale
            this.#setViewbox(viewbox)
        }
    }

    #gestureEvent(event: GestureEvent) {
        // Track the pinch even with no diagram open, so that a pinch's end always clears it and
        // Ctrl/Cmd+wheel isn't left thinking a pinch is still under way
        const lastScale = this.#gestureScale
        if (event.type === 'gesturestart') {
            this.#gestureScale = event.scale || 1
        } else if (event.type === 'gesturechange') {
            this.#gestureScale = event.scale
        } else {
            this.#gestureScale = null
        }
        if (!this.#svgDiagram) {
            return
        }
        event.preventDefault()
        if (event.type === 'gesturechange' && lastScale !== null && lastScale > 0 && event.scale > 0) {
            this.#zoomAboutClient(event.scale / lastScale, event.clientX, event.clientY)
        }
    }

    /**
     * Zooms by a factor, keeping the point under a position in the window (such as the pointer's)
     * where it is. The scale stays within its limits.
     */
    #zoomAboutClient(factor: number, clientX: number, clientY: number) {
        if (!this.#svgDiagram || !Number.isFinite(factor) || factor <= 0) {
            return
        }
        this.#scale = Math.min(Math.max(this.#scale * factor, this.#minScale), this.#maxScale)
        const viewSize = this.#containerSize.scalarScale(1.0 / this.#scale)
        const viewbox = this.#currentViewbox()
        // Where the container is now, as the page may have scrolled or its layout changed
        const rect = this.#container.getBoundingClientRect()
        const origin = new Point(rect.left + this.#container.clientLeft, rect.top + this.#container.clientTop)
        viewbox[0] += ((viewbox[2] - viewSize.x) * (clientX - origin.x)) / this.#containerSize.x
        viewbox[1] += ((viewbox[3] - viewSize.y) * (clientY - origin.y)) / this.#containerSize.y
        viewbox[2] = viewSize.x
        viewbox[3] = viewSize.y
        this.#setViewbox(viewbox)
    }
}

//==============================================================================
