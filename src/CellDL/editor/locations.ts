/******************************************************************************

CellDL Editor

Copyright (c) 2022 - 2026 David Brooks

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

// Compartments give locations: a store or source (a located element) takes its location (bgf:hasLocation) from the
// innermost labelled compartment or region its centre is in, the label being the location. An unlabelled box gives
// none, and an element moved out of every box keeps the location it had.
//
// An element's location follows its compartment only when that changes: when a box is placed, moved, resized,
// relabelled or deleted, or the element is moved in or out of one, or added. So a location set by hand in a box that
// gives another is kept, and reported as a mismatch (`locationMismatches()`).

import type { CellDLObject } from '#editor/celldlObjects'
import type { CellDLDiagram } from '#editor/diagram'
import type { Box } from '#editor/SVGElements/utils/compartment'

import { componentLibraryPlugin } from '#root/plugins'
import { type BondgraphPlugin, PLUGIN_ID } from '#root/plugins/bondgraph'
import type { PointLike } from '#root/utils/points'

import { boxOf } from './compartments'

//==============================================================================

function bondgraphPlugin(): BondgraphPlugin|undefined {
    return componentLibraryPlugin.getPlugin(PLUGIN_ID) as BondgraphPlugin|undefined
}

/** The location a compartment gives what is inside it: its label, if it has one */
export function compartmentLocation(compartment: CellDLObject): string|undefined {
    return compartment.label?.trim() || undefined
}

type LocatingBox = {
    box: Box
    location: string
}

/** The diagram's labelled compartments, innermost (smallest) first */
function locatingBoxes(diagram: CellDLDiagram): LocatingBox[] {
    const boxes: LocatingBox[] = []
    for (const object of diagram.objects) {
        const location = object.isCompartment ? compartmentLocation(object) : undefined
        if (location !== undefined && object.svgElement) {
            boxes.push({ box: boxOf(object), location })
        }
    }
    return boxes.sort((a, b) => a.box.width*a.box.height - b.box.width*b.box.height)
}

function inside(box: Box, point: PointLike): boolean {
    return box.x <= point.x && point.x <= box.x + box.width && box.y <= point.y && point.y <= box.y + box.height
}

/**
 * Each located element (a store or source) of the diagram, with the location of the innermost labelled compartment
 * its centre is in, or `undefined` when it is in none.
 */
export function compartmentLocations(diagram: CellDLDiagram): Map<CellDLObject, string|undefined> {
    const plugin = bondgraphPlugin()
    const locations: Map<CellDLObject, string|undefined> = new Map()
    if (!plugin) {
        return locations
    }
    const boxes = locatingBoxes(diagram)
    for (const object of diagram.objects) {
        const centre = object.celldlSvgElement?.centroid
        if (centre && plugin.isLocatedElement(object)) {
            locations.set(object, boxes.find(box => inside(box.box, centre))?.location)
        }
    }
    return locations
}

/** Which compartment each located element is in, as text that changes when one does */
export function compartmentsKey(diagram: CellDLDiagram): string {
    return [...compartmentLocations(diagram)].map(([object, location]) => `${object.id}=${location ?? ''}`).join('\n')
}

/** A located element whose own location isn't that of the compartment it is in */
export type LocationMismatch = {
    object: CellDLObject
    /** Its own location, if it has one */
    location: string|undefined
    /** The location its compartment gives */
    compartment: string
}

/** The located elements whose own location isn't that of the labelled compartment they are in */
export function locationMismatches(diagram: CellDLDiagram): LocationMismatch[] {
    const plugin = bondgraphPlugin()
    const mismatches: LocationMismatch[] = []
    if (plugin) {
        for (const [object, compartment] of compartmentLocations(diagram)) {
            const location = plugin.elementLocation(object)
            if (compartment !== undefined && location !== compartment) {
                mismatches.push({ object, location, compartment })
            }
        }
    }
    return mismatches
}

//==============================================================================

/** An element to give a location */
export type LocationEdit = {
    object: CellDLObject
    location: string
}

/**
 * Notes which compartment each located element is in, so that after an edit the elements whose compartment changed
 * can be given its location.
 */
export class CompartmentTracker {
    #diagram: CellDLDiagram|null = null
    #known: Map<string, string|undefined> = new Map()

    /** Notes where each element is, as an opened diagram or an undo leaves them, changing none */
    note(diagram: CellDLDiagram|null) {
        this.#diagram = diagram
        this.#known = new Map()
        if (diagram) {
            for (const [object, location] of compartmentLocations(diagram)) {
                this.#known.set(object.id, location)
            }
        }
    }

    /**
     * The located elements now in a labelled compartment other than the one they were in when last noted (new
     * elements included), whose own location isn't that compartment's. Notes where each element now is.
     */
    changes(diagram: CellDLDiagram): LocationEdit[] {
        if (diagram !== this.#diagram) {
            this.note(diagram)
            return []
        }
        const plugin = bondgraphPlugin()
        const edits: LocationEdit[] = []
        const known: Map<string, string|undefined> = new Map()
        for (const [object, location] of compartmentLocations(diagram)) {
            known.set(object.id, location)
            const moved = !this.#known.has(object.id) || this.#known.get(object.id) !== location
            if (moved && location !== undefined && plugin?.elementLocation(object) !== location) {
                edits.push({ object, location })
            }
        }
        this.#known = known
        return edits
    }
}

//==============================================================================
//==============================================================================
