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

import { CellDLEditor } from '#editor/editor'

//==============================================================================

export namespace alert {
    let holding = 0

    export function clear() {
        if (holding === 0) {
            CellDLEditor.instance?.showMessage('')
        }
    }

    /** Runs `fn` without clearing the message shown, e.g. when reading properties for the host. */
    export function keepShown<T>(fn: () => T): T {
        holding += 1
        try {
            return fn()
        } finally {
            holding -= 1
        }
    }

    export function error(msg: string) {
        console.error(msg)
        CellDLEditor.instance?.showMessage(msg, 'error')
    }

    export function info(msg: string) {
        CellDLEditor.instance?.showMessage(msg, 'info')
    }

    export function tooltip(msg: string) {
        CellDLEditor.instance?.showTooltip(msg, 'error')
    }

    export function warn(msg: string) {
        console.warn(msg)
        CellDLEditor.instance?.showMessage(msg, 'warn')
    }

    export function elementError(msg: string, svgElement?: SVGGraphicsElement) {
        svgElement?.classList.add('error')
        error(msg)
    }
}

//==============================================================================
//==============================================================================
