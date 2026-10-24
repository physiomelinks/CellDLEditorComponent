//==============================================================================

import type { CellDLObject } from '#editor/celldlObjects'
import type { CellDLDiagram } from '#editor/diagram'

import type { PointLike } from '#root/utils/points'
import {
    COMPARTMENT_BACKGROUND,
    MEMBRANE_COLOUR,
    MEMBRANE_CORNER_RADIUS,
    MEMBRANE_DASH,
    MEMBRANE_GAP,
    MEMBRANE_STROKE_WIDTH,
    type Styling,
    STYLE_STRING_FIELD_SEPARATOR
} from '#root/utils/styling'
import {
    getFillFromString,
    getStrokeString,
    setStrokeFromString,
    SVG_URI,
    svgRect
} from '#root/utils/svgUtils'

//==============================================================================

type CompartmentStyling = {
    cornerRadius: number
    fill: string[]
    strokeGap: number,
    strokeColour: string
    strokeDashed: boolean
    strokeWidth: number
}

const DEFAULT_COMPARTMENT_STYLE: CompartmentStyling = {
    cornerRadius: MEMBRANE_CORNER_RADIUS,
    fill: [COMPARTMENT_BACKGROUND],      // WIP -- gradient fill
    strokeGap: MEMBRANE_GAP,
    strokeColour: MEMBRANE_COLOUR,
    strokeDashed: false,
    strokeWidth: MEMBRANE_STROKE_WIDTH
}

//==============================================================================

// Top, centre
const DEFAULT_TEXT_STYLE = ['0', '-1'].join(STYLE_STRING_FIELD_SEPARATOR)

const FONT_PIXEL_SIZE = 24
const FONT = `bold ${FONT_PIXEL_SIZE}px sans-serif`

const PADDING = 24

//==============================================================================

export function createCompartmentSvgElement(id: string, topLeft: PointLike, bottomRight: PointLike): SVGGElement {
    const styling = DEFAULT_COMPARTMENT_STYLE
    const svgElement = document.createElementNS(SVG_URI, 'g')
    svgElement.id = id
    svgElement.insertAdjacentHTML('beforeend', createRectAsString(topLeft, bottomRight, styling, styling.strokeGap/2))
    if (styling.strokeGap > 0) {
        svgElement.insertAdjacentHTML('beforeend', createRectAsString(topLeft, bottomRight, styling, -styling.strokeGap/2))
        svgElement.setAttribute('data-stroke-gap', String(styling.strokeGap))
    }
    return svgElement
}

//==============================================================================

function createRectAsString(topLeft: PointLike, bottomRight: PointLike,
                            styling: CompartmentStyling, offset: number=0): string {
    const attributes: Record<string, string> = {
        stroke: styling.strokeColour,
        'stroke-width': String(styling.strokeWidth)
    }
    const radius = styling.cornerRadius + offset
    if (radius > 0) {
        attributes.rx = String(radius)
    }
    if (styling.strokeDashed) {
        attributes['stroke-dasharray'] = String(MEMBRANE_DASH*styling.strokeWidth)
    }
    // Background only when a single compartment boundary or this is the innermost boundary
    if (offset <= 0) {
        attributes.fill = COMPARTMENT_BACKGROUND
        attributes['fill-opacity'] = '0.8'
    } else {
        attributes.fill = 'none'
    }
    return svgRect(
        { x: topLeft.x - offset, y: topLeft.y - offset },
        { x: bottomRight.x + offset, y: bottomRight.y + offset },
        attributes
    )
}

//==============================================================================

type RectDimensions = {
    x: number
    y: number
    width: number
    height: number
}

function getRectDimensions(rect: SVGRectElement): RectDimensions {
    return {
        x: Number(rect.getAttribute('x')),
        y: Number(rect.getAttribute('y')),
        width: Number(rect.getAttribute('width')),
        height: Number(rect.getAttribute('height'))
    }
}

function updateRectDimensions(rect: SVGRectElement, delta: number) {  // -ve `delta` will shrink
    const dims = getRectDimensions(rect)
    rect.setAttribute('x', `${dims.x - delta}`)
    rect.setAttribute('y', `${dims.y - delta}`)
    rect.setAttribute('width', `${Math.max(0, dims.width + 2*delta)}`)
    rect.setAttribute('height', `${Math.max(0, dims.height + 2*delta)}`)
}

//==============================================================================

function escapeHtml(str: string): string {
  return str.replace(/[&<>'"]/g,
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  )
}

//==============================================================================

class TextElement {
    #canvas: HTMLCanvasElement
    #containerSize: RectDimensions
    #svgTextElement: SVGTextElement
    #text: string|undefined
    #xHeight: number
    #hAlign: string = '0'
    #vAlign: string = '0'
    #xPos: number = 0
    #yPos: number = 0

    constructor(parent: SVGGElement, containerSize: RectDimensions) {
        this.#containerSize = containerSize
        this.#canvas = document.createElement('canvas')
        this.#setStyle(parent.getAttribute('data-text-style') || DEFAULT_TEXT_STYLE)
        const xMetrics = this.#getTextSize('x', FONT)
        this.#xHeight = xMetrics?.actualBoundingBoxAscent || FONT_PIXEL_SIZE/2
        this.#setPosition()
        const textElement = parent.querySelector('text')
        if (textElement) {
            this.#svgTextElement = textElement
            this.#text = textElement.textContent
        } else {
            this.#svgTextElement = document.createElementNS(SVG_URI, 'text')
            parent.appendChild(this.#svgTextElement)
        }
    }

    get svgElement() {
        return this.#svgTextElement
    }

    get text() {
        return this.#text
    }

    getStyle(): string {
        return [
            this.#hAlign,
            this.#vAlign
        ].join(STYLE_STRING_FIELD_SEPARATOR)
    }

    setStyle(style: string) {
        this.#setStyle(style)
        this.#setPosition()
        this.#updateText()
    }

    #setPosition() {
        this.#xPos = this.#containerSize.x
        if (this.#hAlign === '-1') {
            this.#xPos += PADDING
        } else if (this.#hAlign === '1') {
            this.#xPos += this.#containerSize.width - PADDING
        } else {
            this.#xPos += this.#containerSize.width/2
        }
        this.#yPos = this.#containerSize.y
        if (this.#vAlign === '-1') {
            this.#yPos += PADDING
        } else if (this.#vAlign === '1') {
            this.#yPos += this.#containerSize.height - PADDING
        } else {
            this.#yPos += this.#containerSize.height/2
        }
    }

    #setStyle(style: string) {
        const fields = style.split(STYLE_STRING_FIELD_SEPARATOR)
        this.#hAlign = fields.at(0) || '0'
        this.#vAlign = fields.at(1) || '0'
    }

    resize(_size: PointLike) {
    }

    updateText(text: string|undefined) {
        this.#text = text
        this.#updateText()
    }

    #updateText() {
        if (!this.#text) {
            this.#svgTextElement.innerHTML = ''
            return
        }
        const cleanText = escapeHtml(this.#text)
        this.#svgTextElement.setAttribute('style', `font: ${FONT};`)
        let xPos = this.#xPos
        let yPos = this.#yPos
        const textMetrics = this.#getTextSize(this.#text, FONT)
        if (textMetrics) {
            if (this.#hAlign === '0') {
                xPos -= textMetrics.width/2
            } else if (this.#hAlign === '1') {
                xPos -= textMetrics.width
            }
            if (this.#vAlign === '-1') {
                yPos += this.#xHeight
            } else if (this.#vAlign === '0') {
                yPos += this.#xHeight/2
            }
        }
        this.#svgTextElement.setAttribute('x', String(xPos))
        this.#svgTextElement.setAttribute('y', String(yPos))
        this.#svgTextElement.textContent = cleanText
    }

    #getTextSize(text: string, font: string): TextMetrics|undefined {
        const context = this.#canvas.getContext("2d")
        if (context) {
            context.font = font
            return context.measureText(text)
        }
    }
}

//==============================================================================

export class Compartment {
    #boundary0: SVGRectElement
    #boundary1: SVGRectElement|undefined
    #celldlDiagram: CellDLDiagram
    #celldlObject: CellDLObject
    #objectId: string
    #styling: Styling = {}
    #svgElement: SVGGElement
    #textElement: TextElement

    constructor(celldlObject: CellDLObject) {
        this.#celldlObject = celldlObject
        this.#celldlDiagram = celldlObject.celldlDiagram
        this.#objectId = celldlObject.id
        this.#svgElement = celldlObject.svgElement as SVGGElement
        const innerRects = [...this.#svgElement.querySelectorAll('rect').values()]
        this.#boundary0 = innerRects[0] as SVGRectElement
        this.#boundary1 = innerRects[1]
        const strokeGap = Number(this.#svgElement.getAttribute('data-stroke-gap')) || 0
        this.#styling.gapStyle = String(strokeGap)
        let fillString = this.#svgElement.getAttribute('data-fill-style')
        if (!fillString) {
            if (innerRects.length) {
                if (strokeGap === 0) {
                    fillString = this.#boundary0.getAttribute('fill') as string
                } else if (this.#boundary1) {
                    fillString = this.#boundary1.getAttribute('fill') as string
                }
            }
            if (!fillString) {
                fillString = COMPARTMENT_BACKGROUND
            } else if (fillString.startsWith('url(') && fillString.endsWith(')')) {
                fillString = 'yellow'
            }
        }
        // As saved in `data-fill-style`, so the Style panel and undo know a styled fill
        this.#styling.fillStyle = fillString
        let cornerRadius = 0
        if (innerRects.length) {
            this.#styling.pathStyle = getStrokeString(this.#boundary0 as SVGRectElement, {
                colour: MEMBRANE_COLOUR,
                width: MEMBRANE_STROKE_WIDTH,
                dashScale: MEMBRANE_DASH
            })
            cornerRadius = Number(this.#boundary0.getAttribute('rx') as string)
            if (this.#boundary1) {
                cornerRadius = (cornerRadius + Number(this.#boundary1.getAttribute('rx') as string))/2
            }
        }
        this.#styling.cornerStyle = String(cornerRadius)
        this.#textElement = new TextElement(this.#svgElement, getRectDimensions(this.#boundary0))
    }

    get styling() {
        if (this.#textElement.text) {
            this.#styling.textStyle = this.#textElement.getStyle()
        }
        return this.#styling
    }

    setStyling(styling: Styling) {
        let strokeGap = Number(this.#svgElement.getAttribute('data-stroke-gap')) || 0
        if (styling.gapStyle && strokeGap !== Number(styling.gapStyle)) {
            this.#styling.gapStyle = styling.gapStyle
            const newGap = Number(styling.gapStyle)
            if (newGap === 0) {
                // Double to single boundary
                updateRectDimensions(this.#boundary0, 0)
                if (this.#boundary1) {
                    this.#svgElement.removeChild(this.#boundary1)
                    this.#boundary1 = undefined
                }
                this.#svgElement.removeAttribute('data-stroke-gap')
            } else if (strokeGap === 0) {
                // Single to double boundary
                if (!this.#boundary1) {
                    this.#boundary1 = this.#boundary0.cloneNode() as SVGRectElement
                    this.#svgElement.appendChild(this.#boundary1)
                    updateRectDimensions(this.#boundary1, -newGap/2)
                }
                updateRectDimensions(this.#boundary0, newGap/2)
                this.#svgElement.setAttribute('data-stroke-gap', String(newGap))
            } else {
                // adjust
                const delta = (newGap - strokeGap)/2
                updateRectDimensions(this.#boundary0, delta)
                if (this.#boundary1) {
                    updateRectDimensions(this.#boundary1, -delta)
                }
                this.#svgElement.setAttribute('data-stroke-gap', String(newGap))
            }
            strokeGap = newGap
        }

        if (styling.fillStyle) {
            this.#styling.fillStyle = styling.fillStyle
            const gradientId = `fill-${this.#objectId}`
            const fill = getFillFromString(styling.fillStyle, gradientId)
            this.#svgElement.setAttribute('data-fill-style', fill.dataFillStyle)
            if (strokeGap === 0) {
                this.#boundary0.setAttribute('fill', fill.fillAttribute)
            } else if (this.#boundary1) {
                this.#boundary1.setAttribute('fill', fill.fillAttribute)
            }
            if (fill.gradient.length) {  // and it has been changed...
                this.#celldlDiagram.addDefinition(gradientId, fill.gradient.join(''))
            } else {
                this.#celldlDiagram.removeDefinition(gradientId)
            }
        }

        if (styling.pathStyle) {
            this.#styling.pathStyle = styling.pathStyle
            setStrokeFromString(this.#boundary0, styling.pathStyle)
            if (this.#boundary1) {
                setStrokeFromString(this.#boundary1, styling.pathStyle)
            }
        }

        if (styling.cornerStyle) {
            this.#styling.cornerStyle = styling.cornerStyle
            const radius = Number(styling.cornerStyle)
            this.#boundary0.setAttribute('rx', String(radius + strokeGap/2))
            if (this.#boundary1) {
                if (radius > strokeGap/2) {
                    this.#boundary1.setAttribute('rx', String(radius - strokeGap/2))
                } else {
                    this.#boundary1.removeAttribute('rx')
                }
            }
        }

        if (styling.textStyle) {
            this.#textElement.setStyle(styling.textStyle)
            this.#svgElement.setAttribute('data-text-style', styling.textStyle)
        }
    }

    update() {
        this.#updateTextElement()
    }

    #updateTextElement() {
        this.#textElement.updateText(this.#celldlObject.label)
    }
}

//==============================================================================
//==============================================================================
