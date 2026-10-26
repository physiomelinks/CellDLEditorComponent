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


// Which of the Properties panel's items are an element's values, so a host
// that sets values itself can have the panel show them read-only.

import type { PropertyGroup } from '#root/utils/editor-types'

import { BG_PROPERTY_GROUP_ID } from './index'

//==============================================================================

/** Whether the Properties panel lets values be edited, or only shows them */
export type ValuesMode = 'editable' | 'readonly'

/** How the Properties panel shows values, as the editor provides it to the panel */
export type ValuesChrome = {
    mode: ValuesMode
    hint: string
}

/** The key the editor provides its `ValuesChrome` under */
export const VALUES_CHROME_KEY = 'celldl-values-chrome'

/** The groups whose items are values: the initial value, parameters and variables */
export const VALUE_GROUP_IDS: readonly string[] = [
    BG_PROPERTY_GROUP_ID.ElementInitialValue,
    BG_PROPERTY_GROUP_ID.ElementParameters,
    BG_PROPERTY_GROUP_ID.ElementVariables
]

/** Whether a Properties panel item is one of an element's values */
export function isValueItem(itemId: string): boolean {
    return VALUE_GROUP_IDS.includes(itemId.split('/')[0] as string)
}

/** Whether a Properties panel item is shown read-only, given the values mode */
export function isReadonlyItem(itemId: string, mode: ValuesMode|undefined): boolean {
    return mode === 'readonly' && isValueItem(itemId)
}

/**
 * The group to show the values hint above: the first value group with items,
 * so the hint is shown once. `undefined` when values are editable or there are none.
 */
export function valuesHintGroupId(groups: PropertyGroup[], mode: ValuesMode|undefined): string|undefined {
    if (mode !== 'readonly') {
        return undefined
    }
    return groups.find(group => VALUE_GROUP_IDS.includes(group.groupId) && group.items.length)?.groupId
}

//==============================================================================
//==============================================================================
