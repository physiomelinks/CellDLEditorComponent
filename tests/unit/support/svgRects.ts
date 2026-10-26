// happy-dom doesn't measure SVG, and a compartment's walls, added as markup, aren't SVG graphics elements to it, so
// a test file measures rectangles and groups of them

import { afterAll, beforeAll } from 'bun:test'

type Box = { x: number, y: number, width: number, height: number }

const elementPrototype = Element.prototype as Element & { getBBox?: () => DOMRect }
const graphicsGetBBox = SVGGraphicsElement.prototype.getBBox
const elementGetBBox = elementPrototype.getBBox

function attribute(element: Element, name: string): number {
    return Number.parseFloat(element.getAttribute(name) ?? '0')
}

function measure(element: Element): Box|null {
    const tag = element.tagName.toLowerCase()
    if (tag === 'rect') {
        return { x: attribute(element, 'x'), y: attribute(element, 'y'),
                 width: attribute(element, 'width'), height: attribute(element, 'height') }
    } else if (tag === 'g') {
        const boxes = [...element.children].map(measure).filter((box): box is Box => box !== null && box.width > 0)
        if (boxes.length === 0) {
            return null
        }
        const left = Math.min(...boxes.map(box => box.x))
        const top = Math.min(...boxes.map(box => box.y))
        const right = Math.max(...boxes.map(box => box.x + box.width))
        const bottom = Math.max(...boxes.map(box => box.y + box.height))
        return { x: left, y: top, width: right - left, height: bottom - top }
    }
    return null
}

function getBBox(this: Element): DOMRect {
    const box = measure(this)
    if (box) {
        return new DOMRect(box.x, box.y, box.width, box.height)
    }
    return this instanceof SVGGraphicsElement ? graphicsGetBBox.call(this) : new DOMRect(0, 0, 0, 0)
}

/** Measures rectangles, and groups of them, for the tests in the calling file */
export function measureSvgRects() {
    beforeAll(() => {
        SVGGraphicsElement.prototype.getBBox = getBBox
        elementPrototype.getBBox = getBBox
    })

    afterAll(() => {
        SVGGraphicsElement.prototype.getBBox = graphicsGetBBox
        if (elementGetBBox) {
            elementPrototype.getBBox = elementGetBBox
        } else {
            delete elementPrototype.getBBox
        }
    })
}
