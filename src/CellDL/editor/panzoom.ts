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
    #step: number = 0.15

    #viewChanged: ViewChangedHandler | null = null

    constructor(container: HTMLElement, viewChanged: ViewChangedHandler | null = null) {
        this.#viewChanged = viewChanged
        // options
        container.addEventListener('wheel', this.#wheelEvent.bind(this), { passive: true })
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
     * Zooms and pans so that bounds (in SVG coordinates) fill the view, with a
     * margin around them. The smallest scale is lowered if need be.
     */
    zoomToFit(bounds: Bounds|null, margin: number = FIT_MARGIN) {
        if (!this.#svgDiagram || bounds === null || this.#containerSize.x === 0 || this.#containerSize.y === 0) {
            return
        }
        const width = Math.max(bounds.right - bounds.left, 1) * (1 + 2 * margin)
        const height = Math.max(bounds.bottom - bounds.top, 1) * (1 + 2 * margin)
        this.#scale = Math.min(this.#containerSize.x / width, this.#containerSize.y / height, this.#maxScale)
        if (this.#minScale > this.#scale) {
            this.#minScale = this.#scale
        }
        const viewWidth = this.#containerSize.x / this.#scale
        const viewHeight = this.#containerSize.y / this.#scale
        this.#setViewbox([
            (bounds.left + bounds.right - viewWidth) / 2,
            (bounds.top + bounds.bottom - viewHeight) / 2,
            viewWidth,
            viewHeight
        ])
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
            const delta = this.#pointerDownPosition.subtract(event).scalarScale(1.0 / this.#scale)
            if (!delta.isZero()) {
                const viewbox = this.#currentViewbox()
                viewbox[0] += delta.x
                viewbox[1] += delta.y
                this.#setViewbox(viewbox)
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
        if (this.#svgDiagram) {
            // Normalise in case shift modifier is used on macOS
            const delta = event.deltaY === 0 && event.deltaX ? event.deltaX : event.deltaY
            const wheel = delta < 0 ? 1 : -1
            const toScale = this.#scale * Math.exp((wheel * this.#step) / 3)
            this.#scale = Math.min(Math.max(toScale, this.#minScale), this.#maxScale)
            const viewSize = this.#containerSize.scalarScale(1.0 / this.#scale)
            const viewbox = this.#currentViewbox()
            // Where the container is now, as the page may have scrolled or its layout changed
            const rect = this.#container.getBoundingClientRect()
            const origin = new Point(rect.left + this.#container.clientLeft, rect.top + this.#container.clientTop)
            viewbox[0] +=
                ((viewbox[2] - viewSize.x) * (event.clientX - origin.x)) / this.#containerSize.x
            viewbox[1] +=
                ((viewbox[3] - viewSize.y) * (event.clientY - origin.y)) / this.#containerSize.y
            viewbox[2] = viewSize.x
            viewbox[3] = viewSize.y
            this.#setViewbox(viewbox)
        }
    }
}

//==============================================================================
