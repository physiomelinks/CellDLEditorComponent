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

// A reaction side's caption ("reactants" or "products"): a 1-junction's rdfs:label, written below its glyph. The
// label is the editor's own (bg2cellml ignores it). The captions are drawn in their own group, as bond counts are,
// so they don't change the junction's bounds, where its bonds end.

import type * as $rdf from '@celldl/rdf'

import type { CellDLDiagram } from '#editor/diagram'

import { SVG_URI } from '#root/utils/svgUtils'

import { EDITOR_FRAME_ID } from './editorframe'

//==============================================================================

export const SIDE_LABELS_ID = 'side-labels'
export const SIDE_LABEL_PREDICATE = 'http://www.w3.org/2000/01/rdf-schema#label'

const ONE_NODE = 'https://bg-rdf.org/ontologies/bondgraph-framework#OneNode'
const GAP = 11      // from the glyph's bottom to the caption's baseline

/** The diagram's 1-junctions with a label, by their ids. */
export function sideLabels(diagram: CellDLDiagram): Map<string, string> {
    const labels = new Map<string, string>()
    const prefix = `${diagram.uri}#`
    for (const row of diagram.rdfStore.query(`
        SELECT ?node ?label WHERE { ?node a <${ONE_NODE}> ; <${SIDE_LABEL_PREDICATE}> ?label }`) as Map<string, $rdf.Term>[]) {
        const node = row.get('node')?.value
        const label = row.get('label')?.value
        if (node?.startsWith(prefix) && label) {
            labels.set(node.slice(prefix.length), label)
        }
    }
    return labels
}

/** Write each labelled 1-junction's label below it, in the document's `side-labels` group. Returns the number written. */
export function drawSideLabels(diagram: CellDLDiagram): number {
    const svg = diagram.svgDiagram
    if (!svg) return 0
    const labels = sideLabels(diagram)
    let group = svg.querySelector<SVGGElement>(`#${SIDE_LABELS_ID}`)
    if (!group && labels.size === 0) return 0
    if (!group) {
        group = document.createElementNS(SVG_URI, 'g') as SVGGElement
        group.id = SIDE_LABELS_ID
        // below the editor's selection frame, which must stay the diagram's last group
        const frame = svg.querySelector(`#${EDITOR_FRAME_ID}`)
        if (frame?.parentNode === svg) svg.insertBefore(group, frame)
        else svg.append(group)
    }
    group.setAttribute('pointer-events', 'none')
    group.replaceChildren()
    for (const [id, label] of labels) {
        const element = diagram.objectById(id)?.celldlSvgElement
        if (!element?.centroid) continue
        const text = document.createElementNS(SVG_URI, 'text')
        text.setAttribute('class', 'side-label')
        text.setAttribute('data-for', id)
        text.setAttribute('x', element.centroid.x.toFixed(1))
        text.setAttribute('y', (element.centroid.y + element.height / 2 + GAP).toFixed(1))
        text.setAttribute('text-anchor', 'middle')
        text.setAttribute('font-size', '10')
        text.setAttribute('font-style', 'italic')
        text.setAttribute('font-family', 'sans-serif')
        text.setAttribute('fill', '#555')
        text.textContent = label
        group.append(text)
    }
    return group.childElementCount
}

//==============================================================================
//==============================================================================
