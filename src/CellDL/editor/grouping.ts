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

// Whether the editor offers grouping (the `chrome.grouping` option): Group, Edit group and Ungroup in the
// context menu. Off, none of them is shown or done; groups already in a diagram still show, move, select and
// delete as before.

import * as vue from 'vue'

export const groupingState = vue.reactive({ enabled: true })

/** Turn grouping on or off (the `chrome.grouping` option) */
export function setGrouping(on: boolean) {
    groupingState.enabled = on
}
