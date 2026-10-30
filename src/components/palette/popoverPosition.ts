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

// Where the context menu's Add element popover opens, and above what. It's moved to the page's body, as the
// context menu is, so that its fixed position is the click's: inside a host's dialog, which has a transform, a
// fixed position would be relative to the dialog.

const MARGIN = 4                    // between the popover and the window's edges
const MIN_Z_INDEX = 1100            // the popover's own, above PrimeVue's overlays

type Size = { width: number, height: number }

/** The popover's top left, at `at` (client coordinates) but kept inside the window. */
export function popoverPosition(at: { x: number, y: number }, size: Size, viewport: Size): { left: number, top: number } {
    return {
        left: Math.max(MARGIN, Math.min(at.x, viewport.width - size.width - MARGIN)),
        top: Math.max(MARGIN, Math.min(at.y, viewport.height - size.height - MARGIN))
    }
}

/** A z-index above the page's others, given their computed z-indices: a host's open dialog, say. */
export function topZIndex(zIndices: Iterable<string>): number {
    let top = MIN_Z_INDEX - 1
    for (const zIndex of zIndices) {
        const value = Number.parseInt(zIndex, 10)
        if (Number.isFinite(value) && value > top) {
            top = value
        }
    }
    return top + 1
}
