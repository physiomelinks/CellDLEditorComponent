import { describe, expect, test } from 'bun:test'

import { openFixture } from './support/editor'

import { loadPropertyGroups } from '#editor/components/properties'
import { componentLibraryPlugin } from '#root/plugins'
import {
    BG_ELEMENT_LOCATION_ITEM,
    BG_ELEMENT_SPECIES_ITEM,
    BG_ELEMENT_TYPE_ITEM,
    BG_ELEMENT_VALUE_ITEM,
    BG_PROPERTY_GROUP_ID
} from '#root/plugins/bondgraph'
import { isReadonlyItem, isValueItem, valuesHintGroupId } from '#root/plugins/bondgraph/values'
import { PANEL_ID } from '#root/utils/editor-types'

//==============================================================================

// In the enzyme fixture
const STORE_S = 'ID-00000001'
const JUNCTION_S = 'ID-00000002'

async function groupsOf(id: string) {
    const diagram = await openFixture('enzyme.celldl')
    const celldlObject = diagram.objectById(id)
    expect(celldlObject).not.toBeNull()
    return loadPropertyGroups(PANEL_ID.PROPERTIES_PANEL,
                              componentLibraryPlugin.getPanelTemplates(PANEL_ID.PROPERTIES_PANEL),
                              // biome-ignore lint/style/noNonNullAssertion: checked above
                              celldlObject!)
}

//==============================================================================

describe('values', () => {
    test('are the initial value, parameters and variables, not the structure', () => {
        expect(isValueItem(BG_ELEMENT_VALUE_ITEM)).toBe(true)
        expect(isValueItem(`${BG_PROPERTY_GROUP_ID.ElementParameters}/K`)).toBe(true)
        expect(isValueItem(`${BG_PROPERTY_GROUP_ID.ElementVariables}/v`)).toBe(true)
        for (const itemId of [BG_ELEMENT_TYPE_ITEM, BG_ELEMENT_SPECIES_ITEM, BG_ELEMENT_LOCATION_ITEM]) {
            expect(isValueItem(itemId)).toBe(false)
        }
    })

    test('are read-only only in readonly mode', () => {
        const parameter = `${BG_PROPERTY_GROUP_ID.ElementParameters}/K`
        expect(isReadonlyItem(parameter, 'readonly')).toBe(true)
        expect(isReadonlyItem(BG_ELEMENT_VALUE_ITEM, 'readonly')).toBe(true)
        expect(isReadonlyItem(parameter, 'editable')).toBe(false)
        expect(isReadonlyItem(parameter, undefined)).toBe(false)
        expect(isReadonlyItem(BG_ELEMENT_SPECIES_ITEM, 'readonly')).toBe(false)
        expect(isReadonlyItem(BG_ELEMENT_TYPE_ITEM, 'readonly')).toBe(false)
    })

    test('a store\'s panel marks its value and parameter read-only, and its type, species and location editable', async () => {
        const groups = await groupsOf(STORE_S)
        const items = groups.flatMap(group => group.items)
        const readonly = items.filter(item => isReadonlyItem(item.itemId, 'readonly')).map(item => item.itemId)
        expect(readonly).toEqual([BG_ELEMENT_VALUE_ITEM, `${BG_PROPERTY_GROUP_ID.ElementParameters}/K`])
        const editable = items.filter(item => !isReadonlyItem(item.itemId, 'readonly')).map(item => item.itemId)
        expect(editable).toEqual(expect.arrayContaining([BG_ELEMENT_TYPE_ITEM, BG_ELEMENT_SPECIES_ITEM, BG_ELEMENT_LOCATION_ITEM]))
    })

    test('the hint is shown once, above the first values', async () => {
        const groups = await groupsOf(STORE_S)
        expect(valuesHintGroupId(groups, 'readonly')).toBe(BG_PROPERTY_GROUP_ID.ElementInitialValue)
        expect(valuesHintGroupId(groups, 'editable')).toBeUndefined()
        expect(valuesHintGroupId(groups, undefined)).toBeUndefined()
    })

    test('an element without values has no hint', async () => {
        const groups = await groupsOf(JUNCTION_S)
        expect(groups.flatMap(group => group.items).some(item => isValueItem(item.itemId))).toBe(false)
        expect(valuesHintGroupId(groups, 'readonly')).toBeUndefined()
    })
})
