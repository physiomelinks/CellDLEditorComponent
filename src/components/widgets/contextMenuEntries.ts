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

// The context menu's entries, from the editor's enabled items and whether grouping is offered (`chrome.grouping`).

import { CONTEXT_MENU } from '#editor/editor'

export type ContextMenuEntry = { id: CONTEXT_MENU, label: string, disabled: boolean } | { separator: true }

export function contextMenuEntries(state: ReadonlySet<CONTEXT_MENU> | undefined, grouping: boolean): ContextMenuEntry[] {
    const has = (id: CONTEXT_MENU) => !!state?.has(id)
    const item = (id: CONTEXT_MENU, label: string): ContextMenuEntry => ({ id, label, disabled: !has(id) })
    return [
        // Add element is only offered on empty canvas, so it isn't listed when an element was right clicked
        ...(has(CONTEXT_MENU.ADD_ELEMENT) ? [item(CONTEXT_MENU.ADD_ELEMENT, 'Add element…'), { separator: true } as const] : []),
        item(CONTEXT_MENU.DELETE, 'Delete'),
        // Only when a selected bond, or one between selected elements, has bends
        ...(has(CONTEXT_MENU.STRAIGHTEN) ? [item(CONTEXT_MENU.STRAIGHTEN, 'Straighten')] : []),
        ...(grouping
            ? [{ separator: true } as const,
               item(CONTEXT_MENU.GROUP_OBJECTS, 'Group'),
               item(CONTEXT_MENU.EDIT_GROUP, 'Edit group'),
               item(CONTEXT_MENU.UNGROUP_OBJECTS, 'Ungroup')]
            : []),
        { separator: true },
        { ...item(CONTEXT_MENU.INFO, 'Info'), disabled: true }
    ]
}
