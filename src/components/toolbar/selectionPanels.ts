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

// The right-hand panels that follow the selection, which a click on empty canvas closes as it clears the
// selection. Metadata and Reactions describe the whole diagram, so they stay open.

import { PANEL_ID } from '#root/utils/editor-types'

/** The panels showing the selected element: Properties and Style */
export const SELECTION_PANEL_IDS: readonly string[] = [PANEL_ID.PROPERTIES_PANEL, PANEL_ID.STYLE_PANEL]

/**
 * Closes the open selection panels among `buttons`.
 *
 * @returns The ids of the panels closed, for the editor to be told.
 */
export function closeSelectionPanels(buttons: { toolId: string, active?: boolean }[]): string[] {
    const closed: string[] = []
    for (const button of buttons) {
        if (button.active && SELECTION_PANEL_IDS.includes(button.toolId)) {
            button.active = false
            closed.push(button.toolId)
        }
    }
    return closed
}

/**
 * Commits a field being edited in `panel` by taking focus from it, as a click elsewhere would, so that a
 * half-typed value is kept, for the element it was typed for, before a canvas press changes the selection.
 *
 * @returns Whether a field was focused.
 */
export function commitFocusedField(panel: Element|null|undefined): boolean {
    const focused = document.activeElement
    if (panel && focused instanceof HTMLElement && focused !== panel && panel.contains(focused)) {
        focused.blur()
        return true
    }
    return false
}
