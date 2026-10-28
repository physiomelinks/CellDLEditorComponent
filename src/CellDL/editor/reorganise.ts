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

// Reorganise by location, as the Reactions panel runs it or as a host does with the `edit` command's `reorganise`

import * as vue from 'vue'

import { componentLibraryPlugin } from '#root/plugins'
import { LAYOUT_PRESETS } from '#root/plugins/bondgraph/layout'

import { CellDLEditor } from '.'
import { reorganiseDiagram } from './regions'

//==============================================================================

/** Where the Reorganise button and its mode dropdown are: in the Reactions panel, or (`false`) left to the host */
export type ReorganiseChrome = 'panel' | false

/** A way to reorganise, as the Reactions panel's dropdown offers it */
export interface ReorganiseMode {
    id: string
    label: string
    description: string
}

/** The Reorganise modes, in the dropdown's order */
export const REORGANISE_MODES: readonly ReorganiseMode[] = LAYOUT_PRESETS.map(p => ({
    id: p.id, label: p.name, description: p.description
}))

export const DEFAULT_REORGANISE_MODE = 'balanced'

/** Whether Reorganise can run now: a diagram with reactions open, and no reorganise running */
export interface ReorganiseState {
    modes: ReorganiseMode[]
    enabled: boolean
    busy: boolean
}

/** The outcome of a reorganise; `status` is the line the Reactions panel shows, `error` why it couldn't run */
export interface ReorganiseResult {
    kind?: string
    ok: boolean
    mode: string
    /** Whether a simpler layout was found, and nodes moved, as one undo step */
    improved: boolean
    status: string
    error?: string
}

//==============================================================================

/** The running reorganise, shared by the panel and host commands */
export const reorganiseProgress = vue.reactive({ busy: false, progress: 0 })

/** Whether the Reactions panel shows the Reorganise controls (`chrome.reorganise`) */
export const reorganiseChromeState = vue.reactive({ inPanel: true })

export function setReorganiseChrome(chrome: ReorganiseChrome | undefined) {
    reorganiseChromeState.inPanel = chrome !== false
}

/** Whether the open diagram has reactions to reorganise */
export function hasReactions(): boolean {
    return !!CellDLEditor.instance?.celldlDiagram && componentLibraryPlugin.reactionEquations().length > 0
}

export function reorganiseState(): ReorganiseState {
    return {
        modes: REORGANISE_MODES.map(m => ({ ...m })),
        enabled: !reorganiseProgress.busy && hasReactions(),
        busy: reorganiseProgress.busy
    }
}

function describe(subspaces: number, regions: number, rectangular?: boolean): string {
    if (rectangular && regions > 1) return `the ${regions} locations as rectangles`
    return subspaces === regions ? `each of ${regions} location${regions === 1 ? '' : 's'} in one piece`
                                 : `${regions} locations in ${subspaces} pieces`
}

/**
 * Reorganise the diagram by `mode` (an id of REORGANISE_MODES), as one undo step, with Compartment and Region
 * boxes moved with their contents. Fails, moving nothing, for an unknown mode, while another runs, or with no
 * reactions.
 */
export async function runReorganise(mode: string = DEFAULT_REORGANISE_MODE): Promise<ReorganiseResult> {
    const failed = (error: string): ReorganiseResult => ({ ok: false, mode, improved: false, status: '', error })
    if (!REORGANISE_MODES.some(m => m.id === mode)) return failed(`Unknown reorganise mode: ${mode}`)
    if (reorganiseProgress.busy) return failed('A reorganise is already running')
    if (!hasReactions()) return failed('The diagram has no reactions to reorganise')
    reorganiseProgress.busy = true
    reorganiseProgress.progress = 0
    try {
        const result = await reorganiseDiagram((done, of) => {
            reorganiseProgress.progress = Math.round(100 * done / of)
        }, {}, mode)
        if (!result) return failed('The diagram has nothing to reorganise')
        const { before, after, rings } = result
        const improved = after.total < before.total
        const kept = rings ? ` ${rings} cycle${rings === 1 ? '' : 's'} drawn as a circle.` : ''
        const status = improved
            ? `Complexity ${before.total.toFixed(0)} → ${after.total.toFixed(0)}: ${describe(after.subspaces, after.regions, after.rectangular)}, `
              + `${after.crossings} crossing bond${after.crossings === 1 ? '' : 's'} (were ${before.crossings}).${kept}`
            : `No simpler layout found (complexity ${before.total.toFixed(0)}).`
        return { ok: true, mode, improved, status }
    } catch (error) {
        return failed(`Cannot reorganise: ${(error as Error).message ?? error}`)
    } finally {
        reorganiseProgress.busy = false
    }
}

//==============================================================================
//==============================================================================
