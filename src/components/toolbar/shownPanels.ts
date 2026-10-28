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

// The right-hand panels a host shows, by name, with the editor's `chrome.panels`.

import { PANEL_ID } from '#root/utils/editor-types'

export type PanelName = 'properties' | 'metadata' | 'style' | 'reactions' | 'variables' | 'annotations'

/** The panels shown when `chrome.panels` is absent or `true`: Variables and Annotations only when listed */
export const DEFAULT_EDITOR_PANELS: readonly PanelName[] = ['properties', 'metadata', 'style', 'reactions']

const PANEL_NAMES: Record<string, PanelName> = {
    [PANEL_ID.PROPERTIES_PANEL]: 'properties',
    [PANEL_ID.METADATA_PANEL]: 'metadata',
    [PANEL_ID.STYLE_PANEL]: 'style',
    [PANEL_ID.REACTIONS_PANEL]: 'reactions',
    [PANEL_ID.VARIABLES_PANEL]: 'variables',
    [PANEL_ID.ANNOTATIONS_PANEL]: 'annotations'
}

/** Whether the panel `toolId` is shown, given `chrome.panels` (`false` hides them all, a list shows just those) */
export function isShownPanel(toolId: string, panels: boolean | readonly PanelName[] | undefined): boolean {
    if (panels === false) {
        return false
    }
    const shown = Array.isArray(panels) ? panels : DEFAULT_EDITOR_PANELS
    const name = PANEL_NAMES[toolId]
    return name !== undefined && shown.includes(name)
}
