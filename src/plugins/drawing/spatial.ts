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

// The palette's spatial entries: drawn boxes that show where elements are, as the drawing tools drew them. A
// compartment has a double membrane wall, a region a single dashed outline. Neither is a bond graph element, so
// they're shown whatever the palette's domain filter, and a conversion to CellML leaves them out.

import {
    COMPARTMENT_BACKGROUND,
    MEMBRANE_COLOUR,
    MEMBRANE_CORNER_RADIUS,
    MEMBRANE_GAP,
    MEMBRANE_STROKE_WIDTH
} from '#root/utils/styling'

//==============================================================================

export type SpatialKind = 'compartment' | 'region'

export interface SpatialEntry {
    /** Unique, e.g. `spatial/compartment` */
    id: string
    /** The tile's text */
    label: string
    /** A distinct name, for the tile's tooltip */
    name: string
    kind: SpatialKind
    /** The drawing tool (./drawing.vue) that clicking its tile arms */
    drawingTool: string
    /** The tile's glyph, as a data URL */
    imageData: string
}

/** How a kind's boundary is drawn */
export interface SpatialStyle {
    cornerRadius: number
    strokeColour: string
    strokeDashed: boolean
    strokeGap: number
    strokeWidth: number
    fill: string
}

export const SPATIAL_STYLES: Record<SpatialKind, SpatialStyle> = {
    compartment: {
        cornerRadius: MEMBRANE_CORNER_RADIUS,
        strokeColour: MEMBRANE_COLOUR,
        strokeDashed: false,
        strokeGap: MEMBRANE_GAP,
        strokeWidth: MEMBRANE_STROKE_WIDTH,
        fill: COMPARTMENT_BACKGROUND
    },
    region: {
        cornerRadius: 12,
        strokeColour: '#808080',
        strokeDashed: true,
        strokeGap: 0,
        strokeWidth: 2,
        fill: '#eee'
    }
}

/** The size of a box placed by a click or a drop, rather than drawn */
export const DEFAULT_SPATIAL_SIZE = { width: 240, height: 160 }

/** A drawn box smaller than this either way is taken as a click */
export const MIN_SPATIAL_SIZE = 20

/** The drawing tools' ids (../drawing/drawing.vue) for each kind */
export const DRAWING_TOOLS: Record<string, SpatialKind> = {
    'draw-closed-compartment': 'compartment',
    'draw-background-region': 'region'
}

//==============================================================================

function glyph(kind: SpatialKind): string {
    const style = SPATIAL_STYLES[kind]
    const dash = style.strokeDashed ? ' stroke-dasharray="4 3"' : ''
    const walls = style.strokeGap > 0
        ? `<rect x="2" y="2" width="36" height="22" rx="8" fill="none" stroke="${style.strokeColour}" stroke-width="1.6"/>`
        + `<rect x="5" y="5" width="30" height="16" rx="5" fill="${style.fill}" stroke="${style.strokeColour}" stroke-width="1.6"/>`
        : `<rect x="2" y="2" width="36" height="22" rx="6" fill="${style.fill}" stroke="${style.strokeColour}" stroke-width="1.6"${dash}/>`
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="26" viewBox="0 0 40 26">${walls}</svg>`
    return `data:image/svg+xml;base64,${btoa(svg)}`
}

const ENTRIES: SpatialEntry[] = [
    { id: 'spatial/compartment', label: 'Compartment', kind: 'compartment', drawingTool: 'draw-closed-compartment',
      imageData: glyph('compartment'),
      name: 'Compartment: a box with a membrane wall, drawn round elements. Click or drop to place, or drag on the canvas to draw' },
    { id: 'spatial/region', label: 'Region', kind: 'region', drawingTool: 'draw-background-region',
      imageData: glyph('region'),
      name: 'Region: a dashed box, drawn round elements. Click or drop to place, or drag on the canvas to draw' }
]

//==============================================================================

/** The spatial entries, shown whatever the domain filter */
export function spatialEntries(): SpatialEntry[] {
    return ENTRIES
}

/** The spatial entry with id `entryId` */
export function spatialEntry(entryId: string): SpatialEntry | undefined {
    return ENTRIES.find(e => e.id === entryId)
}

/** Whether `entryId` is a spatial entry's */
export function isSpatialEntry(entryId: string|undefined): boolean {
    return !!entryId && spatialEntry(entryId) !== undefined
}

/** Spatial entries matching a search: by label, then by name, as the palette's are */
export function searchSpatialEntries(query: string): SpatialEntry[] {
    const words = query.toLowerCase().split(/\s+/).filter(w => w)
    if (!words.length) return ENTRIES
    const matches = (text: string) => words.every(w => text.toLowerCase().includes(w))
    return [...ENTRIES.filter(e => matches(e.label)), ...ENTRIES.filter(e => !matches(e.label) && matches(e.name))]
}

//==============================================================================
//==============================================================================
