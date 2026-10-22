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

// The element palette's entries, and placing one in the diagram. The chemical entries come with their element
// template chosen, so a new element needs no dropdown step, and store their defaults (parameters 1, an initial value
// 0), a species name not yet used (S1, S2, ...) and the diagram's most used location. "Reaction with sides" is a
// macro: a chemical reaction between a reactants and a products 1-junction, bonded through its f and r ports.

import type * as $rdf from '@celldl/rdf'

import type { CellDLConnectedObject, CellDLObject } from '#editor/celldlObjects'
import { notifyChanges } from '#editor/editor'
import { addBond, addComponent, asOneStep, bondgraphPlugin, centreAt, editorParts } from '#editor/editor/placing'
import { drawSideLabels, SIDE_LABEL_PREDICATE } from '#editor/editor/sidelabels'
import { Point, type PointLike } from '#root/utils/points'

import { DEFAULT_LOCATION, svgImageData } from './definitions'
import type { BGLibraryComponentTemplate } from './utils'

//==============================================================================

const BGF = 'https://bg-rdf.org/ontologies/bondgraph-framework#'
const PLUGIN_ID = 'bondgraph-components'

/** The palette's filter: chemistry's elements, or every domain's */
export type PaletteDomain = 'chemical' | 'all'

export interface PaletteEntry {
    /** Unique, e.g. `chemical/species` */
    id: string
    /** The tile's text */
    label: string
    /** A distinct name, for the tile's tooltip */
    name: string
    /** `chemical` entries show with either filter, `all` ones only with "All domains" */
    domain: PaletteDomain
    kind: 'element' | 'macro'
    /** The library template drawn for the (main) element */
    baseTemplateId: string
    /** The element template it comes with */
    elementType?: string
    /** The tile's glyph, as a data URL */
    imageData: string
}

/** Offset of a reaction's side junctions from it */
export const SIDE_OFFSET = 100

//==============================================================================

type NameKind = 'S' | 'R' | 'J'

interface ChemicalEntry {
    id: string
    label: string
    name: string
    template: string        // library template id, within the plugin
    elementType?: string
    glyph?: string          // LaTeX for the tile, if not the template's symbol
    naming: NameKind
    kind?: 'macro'
}

const CHEMICAL_ENTRIES: ChemicalEntry[] = [
    { id: 'species', label: 'Species', name: 'Species: a chemical store with its 0-junction',
      template: 'ZeroStorageNode_q', elementType: `${BGF}ChemicalStorageNode`, naming: 'S' },
    { id: 'store', label: 'Store', name: 'Store: a chemical concentration',
      template: 'QuantityStore', elementType: `${BGF}ChemicalConcentration`, naming: 'S' },
    { id: 'chemostat', label: 'Chemostat', name: 'Chemostat: a fixed chemical potential',
      template: 'PotentialSource', elementType: `${BGF}ChemicalPotential`, naming: 'S' },
    { id: 'flux-source', label: 'Flux source', name: 'Flux source: a fixed chemical flow',
      template: 'FlowSource', elementType: `${BGF}ChemicalFlow`, naming: 'S' },
    { id: 'zero-junction', label: '0-junction', name: '0-junction: shares a potential',
      template: 'ZeroNode', glyph: '0', naming: 'J' },
    { id: 'one-junction', label: '1-junction', name: '1-junction: shares a flow',
      template: 'OneNode', glyph: '1', naming: 'J' },
    { id: 'reaction-node', label: 'Reaction node', name: 'Reaction node: a chemical reaction with its 1-junction, bonded directly to stores',
      template: 'OneReactionNode', elementType: `${BGF}ChemicalReactionNode`, naming: 'R' },
    { id: 'reaction-sides', label: 'Reaction with sides', name: 'Reaction with sides: a chemical reaction between reactants and products 1-junctions',
      template: 'Reaction', elementType: `${BGF}ChemicalReaction`, glyph: '1\\text{-}Rx\\text{-}1',
      naming: 'R', kind: 'macro' }
]

// Base types whose new elements are named as reactions, or as junctions
const REACTION_BASES = ['Reaction', 'OneReactionNode', 'Resistance', 'OneResistanceNode'].map(t => `${BGF}${t}`)
const JUNCTION_BASES = ['ZeroNode', 'OneNode', 'TransformNode'].map(t => `${BGF}${t}`)

//==============================================================================

interface ResolvedEntry extends PaletteEntry {
    naming: NameKind
    noSpeciesLocation: boolean
}

let resolved: ResolvedEntry[] | null = null

function libraryTemplates(): Map<string, BGLibraryComponentTemplate> {
    const library = bondgraphPlugin().componentLibrary
    return new Map((library.templates as BGLibraryComponentTemplate[]).map(t => [t.id, t]))
}

function resolveEntries(): ResolvedEntry[] {
    if (resolved) return resolved
    const templates = libraryTemplates()
    const entries: ResolvedEntry[] = []
    for (const entry of CHEMICAL_ENTRIES) {
        const template = templates.get(entry.template)
        if (!template) continue
        entries.push({
            id: `chemical/${entry.id}`,
            label: entry.label,
            name: entry.name,
            domain: 'chemical',
            kind: entry.kind ?? 'element',
            baseTemplateId: `${PLUGIN_ID}/${template.id}`,
            elementType: entry.elementType,
            imageData: svgImageData(entry.glyph ?? template.symbol, undefined, undefined, template.style),
            naming: entry.naming,
            noSpeciesLocation: !!template.noSpeciesLocation
        })
    }
    // Every library template, for "All domains", each with a distinct label and name
    const counts = new Map<string, number>()
    for (const template of templates.values()) {
        counts.set(template.name, (counts.get(template.name) ?? 0) + 1)
    }
    const labels = new Set(entries.map(e => e.label.toLowerCase()))
    for (const template of templates.values()) {
        let label = (counts.get(template.name) ?? 0) > 1 ? `${template.name} (${template.symbol})` : template.name
        if (labels.has(label.toLowerCase())) label = `${label} (any domain)`
        labels.add(label.toLowerCase())
        entries.push({
            id: `all/${template.id}`,
            label,
            name: `${label}: choose its domain's template in Properties`,
            domain: 'all',
            kind: 'element',
            baseTemplateId: `${PLUGIN_ID}/${template.id}`,
            imageData: svgImageData(template.symbol, undefined, undefined, template.style),
            naming: REACTION_BASES.includes(template.type) ? 'R' : JUNCTION_BASES.includes(template.type) ? 'J' : 'S',
            noSpeciesLocation: !!template.noSpeciesLocation
        })
    }
    resolved = entries
    return entries
}

function publicEntry(entry: ResolvedEntry): PaletteEntry {
    const { naming: _naming, noSpeciesLocation: _noSpeciesLocation, ...rest } = entry
    return rest
}

/** The palette's entries for a filter: the chemical ones, then (for `all`) every library template. */
export function paletteEntries(domain: PaletteDomain = 'chemical'): PaletteEntry[] {
    return resolveEntries().filter(e => domain === 'all' || e.domain === 'chemical').map(publicEntry)
}

/** The entry with id `entryId`. */
export function paletteEntry(entryId: string): PaletteEntry | undefined {
    const entry = resolveEntries().find(e => e.id === entryId)
    return entry ? publicEntry(entry) : undefined
}

/** Entries matching a search: by label, then by name. */
export function searchEntries(query: string, domain: PaletteDomain): PaletteEntry[] {
    const words = query.toLowerCase().split(/\s+/).filter(w => w)
    const entries = paletteEntries(domain)
    if (!words.length) return entries
    const matches = (text: string) => words.every(w => text.toLowerCase().includes(w))
    return [...entries.filter(e => matches(e.label)), ...entries.filter(e => !matches(e.label) && matches(e.name))]
}

//==============================================================================

/** The species names and locations used in the diagram. */
function usedNames(): { species: Set<string>, locations: Map<string, number> } {
    const { diagram } = editorParts()
    const prefix = `${diagram.uri}#`
    const species = new Set<string>()
    const locations = new Map<string, number>()
    for (const row of diagram.rdfStore.query(`
        SELECT ?node ?species ?location WHERE {
            ?node <${BGF}hasSpecies> ?species .
            OPTIONAL { ?node <${BGF}hasLocation> ?location }
        }`) as Map<string, $rdf.Term>[]) {
        if (!row.get('node')?.value.startsWith(prefix)) continue
        const name = row.get('species')?.value
        if (name) species.add(name)
        // a side junction's f or r, and the template's placeholder, aren't locations
        const location = row.get('location')?.value
        if (location && !['f', 'r', DEFAULT_LOCATION].includes(location)) {
            locations.set(location, (locations.get(location) ?? 0) + 1)
        }
    }
    return { species, locations }
}

/** The first of `S1`, `S2`, ... (or `R`, `J`) not yet used. */
function nextName(kind: NameKind, used: Set<string>): string {
    let n = 1
    while (used.has(`${kind}${n}`)) n += 1
    used.add(`${kind}${n}`)
    return `${kind}${n}`
}

/** The diagram's most used location, else `c`. */
function defaultLocation(locations: Map<string, number>): string {
    let best = 'c', count = 0
    for (const [location, n] of locations) {
        if (n > count) {
            best = location
            count = n
        }
    }
    return best
}

async function placeElement(templateId: string, centre: PointLike, elementType: string|undefined,
                            species: string|undefined, location: string|undefined): Promise<CellDLConnectedObject> {
    const plugin = bondgraphPlugin()
    const object = addComponent(templateId, centre)
    const type = elementType ?? plugin.elementType(object)
    if (type) {
        await plugin.setElement(object, type, species, location)
    }
    plugin.storeDefaultParameters(object)
    centreAt(object, centre)
    return object
}

function setLabel(object: CellDLObject, label: string) {
    object.rdfStore.update(`INSERT DATA { ${object.uri.toString()} <${SIDE_LABEL_PREDICATE}> "${label}" }`)
}

async function placeReactionWithSides(entry: ResolvedEntry, centre: Point, name: string, location: string) {
    const plugin = bondgraphPlugin()
    const oneNode = plugin.libraryTemplateId(`${BGF}OneNode`)
    if (!oneNode) throw new Error('No library template draws a 1-junction')
    const reaction = await placeElement(entry.baseTemplateId, centre, entry.elementType, name, location)
    const reactants = await placeElement(oneNode, centre.subtract({ x: SIDE_OFFSET, y: 0 }), undefined, name, 'f')
    const products = await placeElement(oneNode, centre.add({ x: SIDE_OFFSET, y: 0 }), undefined, name, 'r')
    setLabel(reactants, 'reactants')
    setLabel(products, 'products')
    // into the reaction's inward port f, and out of its outward port r
    const into = addBond(reactants, reaction)
    const out = addBond(reaction, products)
    return [reaction, reactants, products, into, out]
}

/**
 * Place the palette entry `entryId` centred at `svgCentre`, as one undo step, and report the change. Returns what
 * was added, its main element first.
 */
export async function placeEntry(entryId: string, svgCentre: PointLike): Promise<CellDLObject[]> {
    const entry = resolveEntries().find(e => e.id === entryId)
    if (!entry) throw new Error(`No palette entry '${entryId}'`)
    const centre = Point.fromPoint(svgCentre)
    const { species, locations } = usedNames()
    const name = nextName(entry.naming, species)
    const location = defaultLocation(locations)
    const objects = await asOneStep(async (): Promise<CellDLObject[]> => {
        if (entry.kind === 'macro') {
            return placeReactionWithSides(entry, centre, name, location)
        }
        const noNames = entry.noSpeciesLocation
        return [await placeElement(entry.baseTemplateId, centre, entry.elementType,
                                   noNames ? undefined : name, noNames ? undefined : location)]
    })
    drawSideLabels(editorParts().diagram)
    notifyChanges()
    return objects
}

//==============================================================================
//==============================================================================
