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

// What the element palette and the Add element picker share: their domain filter, and arming an entry so that
// clicks on the canvas place it.

import * as vue from 'vue'

import type { TemplateEventDetails } from '#editor/components'
import { EDITOR_TOOL_IDS } from '#editor/editor'
import { knownDomain, type PaletteDomain, type PaletteEntry } from '#root/plugins/bondgraph/palette'

//==============================================================================

/** The filter both show, as set: a domain's id, or `all` */
export const paletteDomain = vue.ref<PaletteDomain>('chemical')

/** The filter as shown: the set one if the templates have it, else `chemical` */
export const shownDomain = vue.computed<PaletteDomain>({
    get: () => knownDomain(paletteDomain.value),
    set: (domain) => { paletteDomain.value = domain }
})

/** What a drag or an armed tile places: the entry, centred where it lands */
export function entryEventDetails(entry: PaletteEntry): TemplateEventDetails {
    return { id: entry.baseTemplateId, centre: { x: 0, y: 0 }, offset: { x: 0, y: 0 }, entryId: entry.id }
}

/** Arm `entry`, so clicks on empty canvas place it, as choosing a tool's template does. */
export function armEntry(entry: PaletteEntry) {
    document.dispatchEvent(new CustomEvent('component-selected', { detail: entryEventDetails(entry) }))
}

/** Return the editor to selecting, as the Selection tool does. */
export function disarm() {
    document.dispatchEvent(new CustomEvent('toolbar-event', {
        detail: { type: 'state', source: EDITOR_TOOL_IDS.SelectTool, value: true }
    }))
    document.dispatchEvent(new CustomEvent('editor-reset-tools'))
}
