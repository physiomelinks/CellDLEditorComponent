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

//==============================================================================

// PhLynx's arrowhead (its CouplingEdge, a copy of Vue Flow's closed arrow): one head at a connection's target end,
// its tip where the path ends, sized in stroke widths. As a <marker> for documents the editor draws, and as a plain
// shape for exported figures (PhLynx's SVG export draws heads as shapes too: some editors mishandle <marker>).

export const ARROW_POINTS = '-5,-4 0,0 -5,4 -5,-4'
export const ARROW_VIEWBOX = [-10, -10, 20, 20] as const
export const ARROW_SIZE = 12.5                    // markerWidth and markerHeight, in stroke widths

/** The arrowhead as an SVG marker with `id`, filled and outlined in the connection's colour. */
export function arrowMarker(id: string, className = '', colour = 'context-stroke'): string {
    return `<marker id="${id}"${className ? ` class="${className}"` : ''} viewBox="${ARROW_VIEWBOX.join(' ')}" refX="0" refY="0" `
         + `markerWidth="${ARROW_SIZE}" markerHeight="${ARROW_SIZE}" markerUnits="strokeWidth" orient="auto-start-reverse">`
         + `<polyline points="${ARROW_POINTS}" fill="${colour}" stroke="${colour}" stroke-width="1" `
         + `stroke-linecap="round" stroke-linejoin="round"/></marker>`
}

/**
 * The arrowhead as a plain shape at the end (x2, y2) of a line from (x1, y1), for a line `strokeWidth` wide: the
 * marker's polyline, turned along the line and scaled as the marker would be.
 */
export function arrowShape(x1: number, y1: number, x2: number, y2: number, strokeWidth: number, colour: string): string {
    const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI
    const scale = strokeWidth * ARROW_SIZE / ARROW_VIEWBOX[2]
    const r = (x: number) => Math.round(1000 * x) / 1000
    return `<polyline points="${ARROW_POINTS}" fill="${colour}" stroke="${colour}" stroke-width="${r(1 / scale)}" `
         + `stroke-linecap="round" stroke-linejoin="round" `
         + `transform="translate(${r(x2)},${r(y2)}) rotate(${r(angle)}) scale(${r(scale)})"/>`
}

//==============================================================================

// The bond-graph half arrow (harpoon) that shows a bond's power direction: one barb, at the bond's end, on the left
// of the bond as you look along it, so a bond drawn left to right ends in ⇀ (barb up) and one drawn downwards has
// its barb to the right of the line. That is how bond graphs are usually drawn, though the side is a drawing choice
// that carries no meaning (some texts put the barb on the side the flow is written), so it is fixed here, not set.
// Drawn in stroke widths at one stroke wide, so it is as heavy as the bond at any thickness and zoom, and coloured
// with the bond (`context-stroke`) in either theme. Its tip is on the end of the bond, as the other heads' are, and
// `orient="auto"` turns it with the bond's last segment, straight or routed.

export const HARPOON_PATH = 'M-0.5,0 L-4.5,-3'      // tip to barb, in stroke widths; -y is the bond's left
export const HARPOON_VIEWBOX = [-5.5, -4, 6, 5] as const

/** The half arrow as an SVG marker with `id`, stroked in the connection's colour */
export function harpoonMarker(id: string, className = '', colour = 'context-stroke'): string {
    return `<marker id="${id}"${className ? ` class="${className}"` : ''} viewBox="${HARPOON_VIEWBOX.join(' ')}" refX="0" refY="0" `
         + `markerWidth="${HARPOON_VIEWBOX[2]}" markerHeight="${HARPOON_VIEWBOX[3]}" markerUnits="strokeWidth" orient="auto">`
         + `<path d="${HARPOON_PATH}" fill="none" stroke="${colour}" stroke-width="1" `
         + `stroke-linecap="round" stroke-linejoin="round"/></marker>`
}

//==============================================================================

// How bonds' arrowheads are shown, whatever marker a document saved: `'bond'`, the bond-graph half arrow above, or
// `'classic'`, PhLynx's closed arrow. The choice is the viewer's, so it is applied with display-only markers and
// style rules outside the document's SVG, and a saved document keeps its own marker.

export type ArrowStyle = 'bond' | 'classic'

export const ARROW_STYLES: readonly ArrowStyle[] = ['bond', 'classic']
export const DEFAULT_ARROW_STYLE: ArrowStyle = 'bond'

/** The class, on the editor's root element, that selects arrow style `style` */
export const arrowStyleClass = (style: ArrowStyle) => `celldl-arrow-${style}`

/** The id of the display-only marker for arrow style `style` */
export const displayArrowId = (style: ArrowStyle) => `celldl-display-arrow-${style}`

/** `style` if it is an arrow style, else the default */
export function arrowStyleOrDefault(style: string | undefined | null): ArrowStyle {
    return ARROW_STYLES.includes(style as ArrowStyle) ? style as ArrowStyle : DEFAULT_ARROW_STYLE
}

/**
 * The display-only markers and the rules that draw bonds with them, as the content of an `<svg>` in the page beside
 * (not inside) the diagram. The rules are more specific than a document's own `.celldl-Connection.bondgraph.arrow`.
 */
export function displayArrowDefinitions(): string {
    const markers = [
        harpoonMarker(displayArrowId('bond'), 'bondgraph'),
        arrowMarker(displayArrowId('classic'), 'bondgraph')
    ]
    // a signal bond (class `signal`) keeps the closed arrow, whichever style power bonds are shown in
    const rules = ARROW_STYLES.map((style) =>
        `.celldl-editor.${arrowStyleClass(style)} .celldl-Connection.bondgraph.arrow:not(.signal){marker-end:url(#${displayArrowId(style)})}`
    )
    rules.push(`.celldl-editor .celldl-Connection.bondgraph.signal.arrow{marker-end:url(#${displayArrowId('classic')})}`)
    return `<defs>${markers.join('')}</defs><style>${rules.join('')}</style>`
}
