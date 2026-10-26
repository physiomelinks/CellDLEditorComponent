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

import * as vue from 'vue'

import { DCT, RDFS, type Term } from '@celldl/rdf'

//==============================================================================

import type { CellDLObject } from '#editor/celldlObjects'
import type { NamedProperty } from '#editor/components'

import { componentLibraryPlugin } from '#root/plugins'
import {
    type ComponentProperties,
    type ItemDetails,
    PANEL_ID,
    type PropertyGroup,
    type ValueChange
} from '#root/utils/editor-types'
import type { Styling } from '#root/utils/styling'

//==============================================================================
//==============================================================================

const OBJECT_METADATA_GROUP = 'object-metadata-group'

function objectMetadata(): NamedProperty[] {
    return [
        {
            name: 'Label',
            property: RDFS.uri('label').value
        },
        {
            name: 'Description',
            property: DCT.uri('description').value
        }
    ]
}

// This would be extended by an annotation plugin...

export function objectMetadataTemplate(): PropertyGroup {
    return {
        groupId: OBJECT_METADATA_GROUP,
        items: objectMetadata().map((nameUri: NamedProperty) => {
            return {
                itemId: nameUri.property,
                property: nameUri.property,
                name: nameUri.name,
                defaultValue: ''
            }
        })
    }
}

//==============================================================================

const COMPARTMENT_GROUP = 'compartment-group'

/**
 * A compartment's Properties: the location it gives the stores and sources inside it, which is its label
 * (../editor/locations.ts).
 */
export function compartmentPropertiesTemplate(): PropertyGroup {
    return {
        groupId: COMPARTMENT_GROUP,
        title: 'Compartment',
        items: [{
            itemId: `${COMPARTMENT_GROUP}/location`,
            property: RDFS.uri('label').value,
            name: 'Location',
            defaultValue: ''
        }]
    }
}

// The groups whose items are an object's own RDF properties, by panel
const GENERIC_GROUPS: Map<PANEL_ID, { groupId: string, template: () => PropertyGroup,
                                      applies: (celldlObject: CellDLObject) => boolean }> = new Map([
    [PANEL_ID.METADATA_PANEL, { groupId: OBJECT_METADATA_GROUP, template: objectMetadataTemplate,
                                applies: () => true }],
    [PANEL_ID.PROPERTIES_PANEL, { groupId: COMPARTMENT_GROUP, template: compartmentPropertiesTemplate,
                                  applies: (celldlObject: CellDLObject) => celldlObject.isCompartment }]
])

//==============================================================================
//==============================================================================

export function getItemProperty(celldlObject: CellDLObject,
                                itemTemplate: ItemDetails): ItemDetails|undefined {
    const objectUri = celldlObject.uri.toString()
    let value: string|undefined

    celldlObject.rdfStore.query(`
        PREFIX : <${celldlObject.celldlDiagram.uri}#>

        SELECT ?value WHERE {
            ${objectUri} <${itemTemplate.property}> ?value
        }`
    ).forEach((r: Map<string, Term>) => {
        value = r.get('value')?.value
    })

    if (value === undefined) {
        if (!itemTemplate.optional) {
            return Object.assign({
                ...itemTemplate,
                value: itemTemplate.defaultValue || '',
                stored: false
            })
        }
        return undefined
    }
    if (itemTemplate.numeric) {
        const valueUnits = value.split(' ')
        return {
            ...itemTemplate,
            value:  Number(valueUnits[0]),
            units: valueUnits[1]
        } as ItemDetails
    }
    return {
        ...itemTemplate,
        value: value
    } as ItemDetails
}

//==============================================================================

export function updateItemProperty(property: string, value: ValueChange,
                                   celldlObject: CellDLObject) {
    const objectUri = celldlObject.uri.toString()

    celldlObject.rdfStore.update(`
        PREFIX : <${celldlObject.celldlDiagram.uri}#>

        DELETE {
            ${objectUri} <${property}> ?value
        }
        WHERE {
            ${objectUri} <${property}> ?value
        }`)
    const newValue = String(value.newValue).trim()
    if (newValue) {
        celldlObject.rdfStore.update(`
            PREFIX : <${celldlObject.celldlDiagram.uri}#>

            INSERT DATA { ${objectUri} <${property}> """${newValue.replace('\\', '\\\\')}""" }
        `)
    }
    if (property === RDFS.uri('label').value) {
        celldlObject.setLabel(newValue || undefined)
    }
    if (property === DCT.uri('description').value) {
        celldlObject.setDescription(newValue || undefined)
    }
}

//==============================================================================

/**
 * An object's property groups for a panel, as the panel shows them, loaded from
 * a copy of the panel's group template.
 *
 * @param panelId The panel.
 * @param groupTemplate The panel's property groups, whose items are not used.
 * @param celldlObject The object whose properties are loaded.
 */
export function loadPropertyGroups(panelId: PANEL_ID, groupTemplate: PropertyGroup[],
                                   celldlObject: CellDLObject): PropertyGroup[] {
    const groups: PropertyGroup[] = structuredClone(groupTemplate)
    for (const group of groups) {
        group.items = []
        group.styling = {}
    }
    const generic = GENERIC_GROUPS.get(panelId)
    if (generic?.applies(celldlObject)) {
        // First get generic metadata
        const group = groups.find(group => group.groupId === generic.groupId)
        if (group) {
            for (const itemTemplate of generic.template().items) {
                const item = getItemProperty(celldlObject, itemTemplate)
                if (item) {
                    group.items.push(item)
                }
            }
        }
    }
    // Then plugin specific component properties
    componentLibraryPlugin.loadComponentProperties(groups, panelId, celldlObject)
    return groups
}

//==============================================================================

export class ObjectPropertiesPanel {
    #componentPropertiesRef = vue.ref<ComponentProperties>({
        panelId: '',
        groups: []
    })
    #groupTemplate: PropertyGroup[]
    #panelId: PANEL_ID

    constructor(panelId: PANEL_ID, groupTemplate: PropertyGroup[]) {
        this.#panelId = panelId
        this.#groupTemplate = groupTemplate
        this.#componentPropertiesRef.value = {
            panelId: panelId,
            groups: structuredClone(this.#groupTemplate)
        }
        for (const group of this.#componentPropertiesRef.value.groups) {
            group.items = []
        }
        vue.provide<vue.Ref<ComponentProperties>>(`${panelId}-componentProperties`, this.#componentPropertiesRef)
    }

    get panelId() {
        return this.#panelId
    }

    setObjectProperties(celldlObject: CellDLObject|undefined) {
        if (!celldlObject) {
            this.#componentPropertiesRef.value.objectId = undefined
        } else if (celldlObject.id !== this.#componentPropertiesRef.value.objectId) {
            this.#componentPropertiesRef.value.objectId = celldlObject.id
            this.#componentPropertiesRef.value.groups = loadPropertyGroups(this.#panelId, this.#groupTemplate, celldlObject)
        }
    }

    async updateObjectProperties(celldlObject: CellDLObject|null,
                                 itemId: string, value: ValueChange) {
        if (celldlObject) {
            const generic = GENERIC_GROUPS.get(this.#panelId)
            if (generic) {
                // First update generic metadata
                for (const group of this.#componentPropertiesRef.value.groups) {
                    if (group.groupId === generic.groupId) {
                        for (const itemTemplate of group.items) {
                            if (itemId === itemTemplate.itemId) {
                                updateItemProperty(itemTemplate.property, value, celldlObject)
                                break
                            }
                        }
                    }
                }
            }
            // Update plugin specific component properties in `this.#componentPropertiesRef`

            await componentLibraryPlugin.updateObjectProperties(celldlObject, this.#panelId, itemId, value,
                                                                this.#componentPropertiesRef.value.groups)
        }
    }

    async updateObjectStyling(celldlObject: CellDLObject|null, styling: Styling) {
        if (celldlObject) {
            await componentLibraryPlugin.updatedComponentStyling(celldlObject, styling)
        }
    }
}

//==============================================================================
//==============================================================================
