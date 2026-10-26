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

// A host's view of a diagram's bond graph elements, for listing and setting
// them in one place rather than in the Properties panel. Both go through the
// Properties panel's own code, so they read and write the same RDF.

import * as $rdf from '@celldl/rdf'

import type { CellDLConnectedObject, CellDLObject } from '#editor/celldlObjects'
import { loadPropertyGroups } from '#editor/components/properties'
import type { CellDLDiagram } from '#editor/diagram'
import type { CellDLEditor } from '#editor/editor'
import { alert } from '#editor/editor/alerts'
import { compartmentLocations } from '#editor/editor/locations'

import { componentLibraryPlugin } from '#root/plugins'
import type { IUiJsonDiscreteInputPossibleValue } from '#root/libopencor/locUIJsonApi'
import { type ItemDetails, PANEL_ID, type PropertyGroup } from '#root/utils/editor-types'

import {
    BG_ELEMENT_LOCATION_ITEM,
    BG_ELEMENT_SPECIES_ITEM,
    BG_ELEMENT_TYPE_ITEM,
    BG_ELEMENT_VALUE_ITEM,
    BG_PROPERTY_GROUP_ID,
    type BGElementDescription,
    type BondgraphPlugin,
    PLUGIN_ID
} from './index'
import { isUnitSystemId, type UnitSystemId } from './unitsystem'

//==============================================================================

/** A field of an element that `set` changes */
export type ElementField = 'type' | 'species' | 'location' | 'value' | `parameter:${string}` | `variable:${string}`

/** A value of a parameter, variable or initial value, with its units */
export type ElementValue = {
    value: string
    units: string
    /** `false` when the element doesn't store a value, so `value` is `''` */
    stored: boolean
}

/** A named parameter or variable value */
export type NamedElementValue = ElementValue & {
    name: string
}

/** A bond graph element (not a bond), as the Properties panel shows it */
export type DiagramElement = {
    id: string
    /** The base component's type IRI */
    kind: string
    kindName: string
    junctionType?: string
    isBondElement: boolean
    /** The element template's type IRI, if one is chosen */
    template?: string
    templateName?: string
    symbol: string
    /** The types the element can be given, the base component's first, filtered by its domain */
    templates: {
        type: string
        name: string
        domain?: string
    }[]
    species?: string
    location?: string
    /**
     * For a store or source in a labelled compartment, the location that compartment gives it. When its own
     * `location` differs (e.g. set by hand), the two disagree.
     */
    compartment?: string
    value?: ElementValue
    parameters: NamedElementValue[]
    variables: NamedElementValue[]
    /** The ids of the components at the other ends of its bonds */
    neighbours: string[]
}

export type ElementEdit = {
    id: string
    field: ElementField
    value: string
}

export type ElementError = {
    id: string
    field: string
    message: string
}

export type ElementResult = {
    ok: boolean
    errors?: ElementError[]
}

//==============================================================================

const PARAMETER_PREFIX = 'parameter:'
const VARIABLE_PREFIX = 'variable:'

function bondgraphPlugin(): BondgraphPlugin|undefined {
    return componentLibraryPlugin.getPlugin(PLUGIN_ID) as BondgraphPlugin|undefined
}

function propertyGroups(celldlObject: CellDLObject): PropertyGroup[] {
    return loadPropertyGroups(PANEL_ID.PROPERTIES_PANEL,
                              componentLibraryPlugin.getPanelTemplates(PANEL_ID.PROPERTIES_PANEL),
                              celldlObject)
}

function findItem(groups: PropertyGroup[], itemId: string): ItemDetails|undefined {
    for (const group of groups) {
        const item = group.items.find(item => item.itemId === itemId)
        if (item) {
            return item
        }
    }
}

function groupItems(groups: PropertyGroup[], groupId: string): ItemDetails[] {
    return groups.find(group => group.groupId === groupId)?.items ?? []
}

function storedText(item: ItemDetails|undefined): string|undefined {
    return (item && item.stored !== false) ? String(item.value) : undefined
}

function namedValue(item: ItemDetails): NamedElementValue {
    const stored = item.stored === true
    return {
        name: item.name,
        value: stored ? String(item.value) : '',
        units: item.units ?? '',
        stored
    }
}

function neighbours(celldlObject: CellDLObject): string[] {
    const ids: Set<string> = new Set()
    if (celldlObject.isConnectable) {
        for (const connection of (<CellDLConnectedObject>celldlObject).connections) {
            const other = (connection.source?.id === celldlObject.id) ? connection.target : connection.source
            if (other) {
                ids.add(other.id)
            }
        }
    }
    return [...ids]
}

/** An item's id, as the Properties panel knows it, for an element's field */
function fieldItemId(field: string): string|undefined {
    if (field === 'type') {
        return BG_ELEMENT_TYPE_ITEM
    } else if (field === 'species') {
        return BG_ELEMENT_SPECIES_ITEM
    } else if (field === 'location') {
        return BG_ELEMENT_LOCATION_ITEM
    } else if (field === 'value') {
        return BG_ELEMENT_VALUE_ITEM
    } else if (field.startsWith(PARAMETER_PREFIX) && field.length > PARAMETER_PREFIX.length) {
        return `${BG_PROPERTY_GROUP_ID.ElementParameters}/${field.substring(PARAMETER_PREFIX.length)}`
    } else if (field.startsWith(VARIABLE_PREFIX) && field.length > VARIABLE_PREFIX.length) {
        return `${BG_PROPERTY_GROUP_ID.ElementVariables}/${field.substring(VARIABLE_PREFIX.length)}`
    }
}

/** A number as the Properties panel stores it, or `undefined` if not a number */
function numberText(value: string): string|undefined {
    const text = value.trim()
    const number = Number(text)
    return (text !== '' && Number.isFinite(number)) ? String(number) : undefined
}

//==============================================================================

function describe(plugin: BondgraphPlugin, celldlObject: CellDLObject,
                  description: BGElementDescription, compartment: string|undefined): DiagramElement {
    const groups = propertyGroups(celldlObject)
    const typeItem = findItem(groups, BG_ELEMENT_TYPE_ITEM)
    const valueItem = findItem(groups, BG_ELEMENT_VALUE_ITEM)

    const element: DiagramElement = {
        id: celldlObject.id,
        kind: description.kind,
        kindName: description.kindName,
        isBondElement: description.isBondElement,
        symbol: description.symbol,
        templates: (typeItem?.possibleValues ?? []).map((option: IUiJsonDiscreteInputPossibleValue) => {
            const type = String(option.value)
            const domain = plugin.templateDomain(type)
            return domain ? { type, name: option.name, domain } : { type, name: option.name }
        }),
        parameters: groupItems(groups, BG_PROPERTY_GROUP_ID.ElementParameters).map(namedValue),
        variables: groupItems(groups, BG_PROPERTY_GROUP_ID.ElementVariables).map(namedValue),
        neighbours: neighbours(celldlObject)
    }
    if (description.junctionType) {
        element.junctionType = description.junctionType
    }
    if (description.template) {
        element.template = description.template
        element.templateName = description.templateName
    }
    const species = storedText(findItem(groups, BG_ELEMENT_SPECIES_ITEM))
    if (species !== undefined) {
        element.species = species
    }
    const location = storedText(findItem(groups, BG_ELEMENT_LOCATION_ITEM))
    if (location !== undefined) {
        element.location = location
    }
    if (compartment !== undefined) {
        element.compartment = compartment
    }
    if (valueItem) {
        element.value = {
            value: String(valueItem.value),
            units: valueItem.units ?? description.valueUnits ?? '',
            stored: true
        }
    } else if (description.valueUnits !== undefined) {
        element.value = { value: '', units: description.valueUnits, stored: false }
    }
    return element
}

/**
 * The diagram's bond graph elements, in the order they were added. Bonds and
 * drawing objects are not listed.
 */
export function listElements(diagram: CellDLDiagram|null|undefined): DiagramElement[] {
    const plugin = bondgraphPlugin()
    if (!diagram || !plugin) {
        return []
    }
    // Reading properties mustn't clear a message the editor is showing
    return alert.keepShown(() => {
        const elements: DiagramElement[] = []
        const compartments = compartmentLocations(diagram)
        for (const celldlObject of diagram.objects) {
            const description = plugin.describeElement(celldlObject)
            if (description) {
                elements.push(describe(plugin, celldlObject, description, compartments.get(celldlObject)))
            }
        }
        return elements
    })
}

//==============================================================================

/**
 * Sets elements' fields, as the Properties panel would, in one undoable step.
 *
 * Edits are made in order. One that can't be made is skipped and reported, and
 * one that wouldn't change a value does nothing.
 */
export async function setElements(editor: CellDLEditor, diagram: CellDLDiagram|null|undefined,
                                  edits: ElementEdit[]): Promise<ElementResult> {
    const plugin = bondgraphPlugin()
    const errors: ElementError[] = []
    if (!diagram || !plugin) {
        return { ok: false, errors: edits.map(edit => ({ id: edit.id, field: edit.field, message: 'No diagram is open' })) }
    }
    const objects: Map<string, CellDLObject> = new Map()
    for (const edit of edits) {
        const celldlObject = diagram.objectById(edit.id)
        if (celldlObject && plugin.describeElement(celldlObject)) {
            objects.set(celldlObject.id, celldlObject)
        } else {
            errors.push({ id: edit.id, field: edit.field, message: `No bond graph element has id '${edit.id}'` })
        }
    }
    await editor.editProperties([...objects.values()], async () => {
        for (const edit of edits) {
            const celldlObject = objects.get(edit.id)
            if (celldlObject) {
                const message = await setElement(plugin, celldlObject, edit)
                if (message) {
                    errors.push({ id: edit.id, field: edit.field, message })
                }
            }
        }
    }, true)
    return errors.length ? { ok: false, errors } : { ok: true }
}

/**
 * Sets one field of an element, as the Properties panel would, returning why it couldn't be set, or `''`. It isn't
 * an undo step of its own: the caller makes it part of one.
 */
export async function setElementField(celldlObject: CellDLObject, field: ElementField, value: string): Promise<string> {
    const plugin = bondgraphPlugin()
    if (!plugin || !plugin.describeElement(celldlObject)) {
        return `'${celldlObject.id}' is not a bond graph element`
    }
    return await setElement(plugin, celldlObject, { id: celldlObject.id, field, value })
}

/** Makes one edit, returning why it couldn't be made, or `''`. */
async function setElement(plugin: BondgraphPlugin, celldlObject: CellDLObject, edit: ElementEdit): Promise<string> {
    const field = String(edit.field)
    const itemId = fieldItemId(field)
    if (!itemId) {
        return `Unknown field '${field}'`
    }
    // biome-ignore lint/style/noNonNullAssertion: the object is a bond graph element
    const description = plugin.describeElement(celldlObject)!
    const groups = propertyGroups(celldlObject)
    const item = findItem(groups, itemId)
    let oldValue: string
    let newValue = String(edit.value ?? '').trim()

    if (field === 'type') {
        const options = item?.possibleValues ?? []
        if (!options.some(option => String(option.value) === newValue)) {
            return `'${newValue}' is not a type this element can have`
        }
        oldValue = description.template ?? description.kind
    } else if (field === 'species' || field === 'location') {
        if (!item) {
            return `This element has no ${field}`
        }
        if (newValue === '') {
            return `The ${field} needs a name`
        }
        oldValue = storedText(item) ?? ''
    } else if (field === 'value') {
        if (!item && description.valueUnits === undefined) {
            return 'This element has no initial value'
        }
        if (newValue !== '') {
            const number = numberText(newValue)
            if (number === undefined) {
                return `'${newValue}' is not a number`
            }
            newValue = number
        }
        oldValue = item ? (numberText(String(item.value)) ?? String(item.value)) : ''
    } else {
        if (!item) {
            const name = field.substring(field.indexOf(':') + 1)
            return `This element's type has no ${field.substring(0, field.indexOf(':'))} '${name}'`
        }
        const number = numberText(newValue)
        if (number === undefined) {
            return `'${newValue}' is not a number`
        }
        newValue = number
        oldValue = (item.stored === true) ? (numberText(String(item.value)) ?? String(item.value)) : ''
    }
    if (newValue === oldValue) {
        return ''
    }
    return await componentLibraryPlugin.updateObjectProperties(celldlObject, PANEL_ID.PROPERTIES_PANEL, itemId,
                                                               { oldValue, newValue }, groups)
}

//==============================================================================

/**
 * The diagram's unit system: `'si'` when it has none, and `null` when the
 * editor doesn't know the one it has.
 */
export function diagramUnitSystem(diagram: CellDLDiagram|null|undefined): UnitSystemId|null {
    const plugin = bondgraphPlugin()
    return (diagram && plugin) ? plugin.unitSystemId() : null
}

/** The reply to setting a diagram's unit system */
export type UnitSystemResult = {
    ok: boolean
    /** The diagram's unit system after the change, as `diagramUnitSystem()` gives it */
    unitSystem: UnitSystemId|null
    error?: string
}

/**
 * Sets the diagram's unit system, in one undoable step. New values are then
 * stored in its units. With `convert`, stored values are converted into its
 * units as the same quantities ("1 mol-1" is "1e-15 fmol-1"); otherwise they keep
 * theirs, which bg2cellml converts.
 */
export async function setUnitSystem(editor: CellDLEditor, diagram: CellDLDiagram|null|undefined, id: string,
                                    convert: boolean=false): Promise<UnitSystemResult> {
    const plugin = bondgraphPlugin()
    if (!diagram || !plugin) {
        return { ok: false, unitSystem: null, error: 'No diagram is open' }
    }
    if (!isUnitSystemId(id)) {
        return { ok: false, unitSystem: plugin.unitSystemId(), error: `Unknown unit system '${id}'` }
    }
    const elements = diagram.objects.filter(object => plugin.describeElement(object))
    // The document's own statements are undone as an object's properties are
    const documentObject = {
        id: '',
        uri: $rdf.namedNode(diagram.uri),
        rdfStore: diagram.rdfStore,
        pluginIds: [],
        pluginData: () => ({})
    } as unknown as CellDLObject
    await editor.editProperties([documentObject, ...elements], async () => {
        plugin.setUnitSystem(id)
        if (convert) {
            for (const element of elements) {
                plugin.rescaleValues(element, id)
            }
        }
    }, true)
    return { ok: true, unitSystem: plugin.unitSystemId() }
}

//==============================================================================
//==============================================================================
