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

// Keeping compartment and region boxes round their contents when a layout (Reorganise, ./regions.ts) moves the
// components. A box contains the elements whose centres are inside it, nested boxes included. Before the layout,
// boxContents() records each box's contents and its margins round them; after it, fitBoxes() redraws each box round
// where its contents now are, with the same margins, innermost first so a box encloses the boxes nested in it. Each
// redrawn box is an undo change, made inside the layout's undo group.

/** biome-ignore-all lint/style/noNonNullAssertion: <indices are within the lists of boxes> */

import type { CellDLCompartment, CellDLObject } from '#editor/celldlObjects'
import type { CellDLDiagram } from '#editor/diagram'
import { undoRedo } from '#editor/diagram/undoredo'
import type { Box } from '#editor/SVGElements/utils/compartment'

import { boxOf, resizeCompartment } from './compartments'

//==============================================================================

/** A box's margins round its contents are kept within these, in pixels */
export const MIN_BOX_MARGIN = 16
export const MAX_BOX_MARGIN = 80

export type Rect = { left: number, top: number, right: number, bottom: number }

export type Margins = Rect

/** The smallest rectangle round some rectangles, or null when there are none */
export function unionRect(rects: Rect[]): Rect|null {
    if (rects.length === 0) return null
    return {
        left: Math.min(...rects.map(r => r.left)), top: Math.min(...rects.map(r => r.top)),
        right: Math.max(...rects.map(r => r.right)), bottom: Math.max(...rects.map(r => r.bottom))
    }
}

/** A box's margins round its contents, each kept between MIN_BOX_MARGIN and MAX_BOX_MARGIN */
export function boxMargins(box: Box, contents: Rect): Margins {
    const clamp = (m: number) => Math.min(MAX_BOX_MARGIN, Math.max(MIN_BOX_MARGIN, m))
    return {
        left: clamp(contents.left - box.x), top: clamp(contents.top - box.y),
        right: clamp(box.x + box.width - contents.right), bottom: clamp(box.y + box.height - contents.bottom)
    }
}

/** The box round `contents` with `margins`, on whole pixels */
export function fittedBox(contents: Rect, margins: Margins): Box {
    const x = Math.floor(contents.left - margins.left), y = Math.floor(contents.top - margins.top)
    return {
        x, y,
        width: Math.ceil(contents.right + margins.right) - x,
        height: Math.ceil(contents.bottom + margins.bottom) - y
    }
}

function insideBox(box: Box, point: { x: number, y: number }): boolean {
    return point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height
}

function boxRect(box: Box): Rect {
    return { left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height }
}

function area(box: Box): number {
    return box.width * box.height
}

/**
 * Which boxes are inside which, by their centres: each box's contents are its index's `members` (other boxes'
 * indices), smaller boxes only, so two boxes can't contain each other. Boxes are listed smallest first.
 */
export function nestedBoxes(boxes: Box[]): { order: number[], members: number[][] } {
    const order = boxes.map((_, k) => k).sort((a, b) => area(boxes[a]!) - area(boxes[b]!))
    const members = boxes.map((box, k) => boxes.flatMap((other, j) => {
        if (j === k || area(other) >= area(box)) return []
        return insideBox(box, { x: other.x + other.width/2, y: other.y + other.height/2 }) ? [j] : []
    }))
    return { order, members }
}

//==============================================================================

function objectRect(object: CellDLObject): Rect|null {
    const svg = object.celldlSvgElement
    if (!svg?.centroid) return null
    const c = svg.centroid, nc = svg.normalisedCentre, w = svg.width, h = svg.height
    const left = c.x - w * (nc?.x ?? 0.5), top = c.y - h * (nc?.y ?? 0.5)
    return { left, top, right: left + w, bottom: top + h }
}

export interface BoxRecord {
    compartment: CellDLCompartment
    start: Box
    objects: CellDLObject[]         // the elements whose centres are inside it
    boxes: CellDLCompartment[]      // the boxes nested in it
    margins: Margins
}

/** Each compartment and region box of the diagram, with its contents and its margins round them */
export function boxContents(diagram: CellDLDiagram): BoxRecord[] {
    const compartments = diagram.objects.filter(o => o.isCompartment && o.svgElement?.isConnected) as CellDLCompartment[]
    if (compartments.length === 0) return []
    const elements = diagram.objects.filter(o => !o.isCompartment && !o.isConnection && o.celldlSvgElement?.centroid)
    const boxes = compartments.map(c => boxOf(c))
    const { members } = nestedBoxes(boxes)
    const records: BoxRecord[] = []
    compartments.forEach((compartment, k) => {
        const start = boxes[k]!
        const objects = elements.filter(o => insideBox(start, o.celldlSvgElement!.centroid))
        const nested = members[k]!
        const contents = unionRect([
            ...objects.map(objectRect).filter((r): r is Rect => r !== null),
            ...nested.map(j => boxRect(boxes[j]!))
        ])
        if (contents === null) return       // an empty box stays where it is
        records.push({ compartment, start, objects, boxes: nested.map(j => compartments[j]!),
                       margins: boxMargins(start, contents) })
    })
    return records
}

/**
 * Redraw each recorded box round where its contents now are, with its margins, innermost first, each as an undo
 * change (one step within the caller's undo group). Returns the number of boxes redrawn.
 */
export function fitBoxes(records: BoxRecord[]): number {
    const fitted = new Map<CellDLCompartment, Box>()
    let changed = 0
    for (const record of [...records].sort((a, b) => area(a.start) - area(b.start))) {
        const contents = unionRect([
            ...record.objects.map(objectRect).filter((r): r is Rect => r !== null),
            ...record.boxes.map(b => boxRect(fitted.get(b) ?? boxOf(b)))
        ])
        if (contents === null) continue
        const box = fittedBox(contents, record.margins)
        fitted.set(record.compartment, box)
        const { compartment, start } = record
        if (box.x === start.x && box.y === start.y && box.width === start.width && box.height === start.height) continue
        resizeCompartment(compartment, box)
        undoRedo.pushChange(compartment, direction => {
            resizeCompartment(compartment, direction === 'backwards' ? start : box)
        })
        changed += 1
    }
    return changed
}

//==============================================================================
//==============================================================================
