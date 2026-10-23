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

// Each bond's bgf:bondCount (its stoichiometry, when not 1) written beside the middle of its path. From Finbar
// Argus's regions.ts (drawBondCounts), redrawn by the editor that shows the diagram.

import type * as $rdf from '@celldl/rdf'

import type { CellDLDiagram } from '#editor/diagram'

import { SVG_URI } from '#root/utils/svgUtils'

import { EDITOR_FRAME_ID } from './editorframe'

//==============================================================================

export const BOND_COUNTS_ID = 'bond-counts'

const BGF = 'https://bg-rdf.org/ontologies/bondgraph-framework#'

/** The diagram's bonds with a count other than 1, by their ids. */
export function bondCounts(diagram: CellDLDiagram): Map<string, number> {
    const counts = new Map<string, number>()
    for (const row of diagram.rdfStore.query(`
        SELECT ?bond ?count WHERE { ?bond <${BGF}bondCount> ?count }`) as Map<string, $rdf.Term>[]) {
        const count = Number(row.get('count')?.value)
        const bond = row.get('bond')?.value
        if (bond && Number.isFinite(count) && count !== 1) {
            counts.set(bond.split('#').pop() ?? bond, count)
        }
    }
    return counts
}

/**
 * Write each bond's count (when not 1) beside the middle of its path, in the document's `bond-counts` group
 * (saved with it, so a figure shows them too). Returns the number written.
 */
export function drawBondCounts(diagram: CellDLDiagram): number {
    const svg = diagram.svgDiagram
    if (!svg) return 0
    const counts = bondCounts(diagram)
    let group = svg.querySelector<SVGGElement>(`#${BOND_COUNTS_ID}`)
    if (!group && counts.size === 0) return 0
    if (!group) {
        group = document.createElementNS(SVG_URI, 'g') as SVGGElement
        group.id = BOND_COUNTS_ID
        // below the editor's selection frame, which must stay the diagram's last group
        const frame = svg.querySelector(`#${EDITOR_FRAME_ID}`)
        if (frame?.parentNode === svg) svg.insertBefore(group, frame)
        else svg.append(group)
    }
    group.setAttribute('pointer-events', 'none')
    group.replaceChildren()
    for (const [id, count] of counts) {
        const element = diagram.objectById(id)?.celldlSvgElement?.svgElement
        const path = (element instanceof SVGPathElement ? element : element?.querySelector('path')) as SVGPathElement|null
        if (!path) continue
        const middle = path.getPointAtLength(path.getTotalLength() / 2)
        const text = document.createElementNS(SVG_URI, 'text')
        text.setAttribute('class', 'bond-count')
        text.setAttribute('x', (middle.x + 4).toFixed(1))
        text.setAttribute('y', (middle.y - 4).toFixed(1))
        text.setAttribute('font-size', '10')
        text.setAttribute('font-weight', 'bold')
        text.setAttribute('font-family', 'sans-serif')
        text.setAttribute('fill', '#333')    // in a saved diagram; the editor's stylesheet follows its theme
        text.textContent = String(count)
        group.append(text)
    }
    return group.childElementCount
}

//==============================================================================
//==============================================================================
