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
/** biome-ignore-all lint/style/noNonNullAssertion: <indices are within the palette and the grid> */

// Location shading: a bond graph's locations (`bgf:hasLocation`) shaded behind it as regions, and reorganising its
// layout around them (../../plugins/bondgraph/regions.ts). The shading is a background in the editor's frame, under
// compartment and region boxes, redrawn whenever the diagram changes and never saved. It is on by default; a host
// turns it off with the `chrome.locationShading` option (`setLocationShading()`), and then nothing is drawn or worked out.

import * as vue from 'vue'

import type { CellDLObject } from '#editor/celldlObjects'
import { type UndoState, undoRedo } from '#editor/diagram/undoredo'

import { componentLibraryPlugin } from '#root/plugins'
import type { BondgraphPlugin } from '#root/plugins/bondgraph'
import {
    type Complexity, complexityOptions, connectRegions, type LayoutBond, type LayoutNode, layoutComplexity,
    type Point2, rectangularRegions, regionComponents, regionGrid, regionLoops, sortedLabels
} from '#root/plugins/bondgraph/regions'
import { type LayoutOptions, presetOptions, reorganiseLayout } from '#root/plugins/bondgraph/layout'
import { SVG_URI } from '#root/utils/svgUtils'


import { CellDLEditor, notifyChanges } from '.'
import { boxContents, fitBoxes } from './boxfit'
import { drawBondCounts as drawDiagramBondCounts } from './bondcounts'
import { EDITOR_BACKGROUND_ID } from './editorframe'

//==============================================================================

export const REGION_LAYER_ID = 'celldl-region-layer'

// region colours, by the region's place in its diagram's sorted locations
export const REGION_COLOURS = ['#3d7fc1', '#d38b2a', '#b9547c', '#4c9a64', '#8566c0', '#2f9c9c', '#a0763e']

//==============================================================================

function plugin(): BondgraphPlugin|undefined {
    return componentLibraryPlugin.getPlugin('bondgraph-components') as unknown as BondgraphPlugin|undefined
}

const BGF = 'https://bg-rdf.org/ontologies/bondgraph-framework#'
const KINDS: Record<string, string> = {
    [`${BGF}QuantityStore`]: 'store', [`${BGF}Reaction`]: 'reaction', [`${BGF}Resistance`]: 'resistance',
    [`${BGF}PotentialSource`]: 'source', [`${BGF}FlowSource`]: 'source'
}

/** The diagram's components as layout nodes (centre, size, regions, kind, species), and its bonds. */
export function diagramLayout(): { nodes: LayoutNode[], bonds: LayoutBond[], objects: Map<string, CellDLObject> } {
    const nodes: LayoutNode[] = [], objects = new Map<string, CellDLObject>()
    const diagram = CellDLEditor.instance?.celldlDiagram
    const layout = plugin()?.regionLayout()
    if (!diagram?.svgDiagram || !layout) return { nodes, bonds: [], objects }
    const elements = new Map((plugin()?.namingElements() ?? []).map(e => [e.id, e]))
    for (const element of diagram.svgDiagram.querySelectorAll('g.celldl-Component')) {
        const object = diagram.objectById(element.id)
        const svg = object?.celldlSvgElement
        if (!object || !svg) continue
        const centre = svg.centroid
        const named = elements.get(object.uri.value)
        nodes.push({ id: object.uri.value, x: centre.x, y: centre.y, w: svg.width, h: svg.height,
                     labels: layout.regions.get(object.uri.value) ?? [],
                     kind: (named?.elementClass && KINDS[named.elementClass]) || 'other',
                     text: named?.species || named?.identifier })
        objects.set(object.uri.value, object)
    }
    const ids = new Set(nodes.map(n => n.id))
    return { nodes, bonds: layout.bonds.filter(b => ids.has(b.a) && ids.has(b.b)), objects }
}

//==============================================================================

function regionLayer(): SVGGElement|null {
    const diagram = CellDLEditor.instance?.celldlDiagram
    const background = diagram?.svgDiagram?.getElementById(EDITOR_BACKGROUND_ID) as SVGGElement|null
    if (!background) return null
    let layer = background.querySelector<SVGGElement>(`#${REGION_LAYER_ID}`)
    if (!layer) {
        layer = document.createElementNS(SVG_URI, 'g') as SVGGElement
        layer.id = REGION_LAYER_ID
        layer.setAttribute('pointer-events', 'none')
        background.prepend(layer)
    }
    return layer
}

export interface RegionSummary {
    regions: string[]
    subspaces: Map<string, number>          // connected pieces of each region
    rectangular?: boolean                   // drawn as rectangles
}

let shading = true

/** Whether location shading is on, for panels that show its colours */
export const locationShadingState = vue.reactive({ on: true })

/** Turn location shading on or off (the `chrome.locationShading` option), redrawing or removing it. */
export function setLocationShading(on: boolean) {
    if (on === shading) return
    shading = on
    locationShadingState.on = on
    if (on) {
        scheduleRegions()
    } else {
        cancelScheduled()
        CellDLEditor.instance?.celldlDiagram?.svgDiagram?.getElementById(REGION_LAYER_ID)?.remove()
    }
}

/** Whether location shading is on. */
export function locationShadingEnabled(): boolean {
    return shading
}

/** Draw the locations' shading behind the diagram (or remove it when location shading is off); returns what was drawn. */
export function drawRegions(): RegionSummary {
    const summary: RegionSummary = { regions: [], subspaces: new Map() }
    if (!shading) {
        CellDLEditor.instance?.celldlDiagram?.svgDiagram?.getElementById(REGION_LAYER_ID)?.remove()
        return summary
    }
    const layer = regionLayer()
    if (!layer) return summary
    layer.replaceChildren()
    const { nodes, bonds } = diagramLayout()
    const regions = sortedLabels(nodes)
    if (regions.length === 0) return summary
    const { sigma, bondLength } = complexityOptions(nodes, bonds)
    const label = (text: string, x: number, y: number, colour: string, anchor: string) => {
        const t = document.createElementNS(SVG_URI, 'text')
        t.setAttribute('x', String(x))
        t.setAttribute('y', String(y))
        t.setAttribute('fill', colour)
        t.setAttribute('fill-opacity', '0.75')
        t.setAttribute('font-size', '18')
        t.setAttribute('font-weight', '600')
        t.setAttribute('text-anchor', anchor)
        t.setAttribute('font-family', 'system-ui, sans-serif')
        t.textContent = text
        t.dataset.region = text
        layer.append(t)
    }
    // rectangles when the regions can be drawn so, else free-form
    const rects = rectangularRegions(nodes, 0.3 * bondLength)
    if (rects) {
        summary.regions = regions
        summary.subspaces = new Map(regions.map(l => [l, 1]))
        summary.rectangular = true
        regions.forEach((name, k) => {
            const colour = REGION_COLOURS[k % REGION_COLOURS.length]!
            const r = rects.get(name)!
            const rect = document.createElementNS(SVG_URI, 'rect')
            rect.setAttribute('x', r.x0.toFixed(1))
            rect.setAttribute('y', r.y0.toFixed(1))
            rect.setAttribute('width', (r.x1 - r.x0).toFixed(1))
            rect.setAttribute('height', (r.y1 - r.y0).toFixed(1))
            rect.setAttribute('fill', colour)
            rect.setAttribute('fill-opacity', '0.13')
            rect.setAttribute('stroke', colour)
            rect.setAttribute('stroke-opacity', '0.45')
            rect.setAttribute('stroke-width', '1.2')
            rect.dataset.region = name
            layer.append(rect)
            label(name, r.x0 + 8, r.y0 + 22, colour, 'start')
        })
        return summary
    }
    const grid = regionGrid(nodes, bonds, { sigma, cell: sigma / 4 })
    connectRegions(grid)
    summary.regions = regions
    summary.subspaces = regionComponents(grid)
    regions.forEach((name, k) => {
        const colour = REGION_COLOURS[k % REGION_COLOURS.length]!
        const loops = regionLoops(grid, name, { blur: 2, smooth: 2 })
        const d = loops.map(loop => `M${loop.points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L')} Z`).join(' ')
        const path = document.createElementNS(SVG_URI, 'path')
        path.setAttribute('d', d)
        path.setAttribute('fill', colour)
        path.setAttribute('fill-opacity', '0.13')
        path.setAttribute('fill-rule', 'evenodd')
        path.setAttribute('stroke', colour)
        path.setAttribute('stroke-opacity', '0.45')
        path.setAttribute('stroke-width', '1.2')
        path.dataset.region = name
        layer.append(path)
        // its name, in the cell of the region nearest its middle
        let sx = 0, sy = 0, n = 0
        const l = grid.labels.indexOf(name)
        for (let k2 = 0; k2 < grid.owner.length; k2++) {
            if (grid.owner[k2] !== l) continue
            sx += k2 % grid.cols; sy += Math.floor(k2 / grid.cols); n++
        }
        if (n === 0) return
        let best = -1, bestD = Infinity
        for (let k2 = 0; k2 < grid.owner.length; k2++) {
            if (grid.owner[k2] !== l || grid.fixed[k2]) continue
            const d2 = (k2 % grid.cols - sx / n) ** 2 + (Math.floor(k2 / grid.cols) - sy / n) ** 2
            if (d2 < bestD) { bestD = d2; best = k2 }
        }
        if (best < 0) return
        label(name, grid.x0 + (best % grid.cols) * grid.cell, grid.y0 + Math.floor(best / grid.cols) * grid.cell, colour, 'middle')
    })
    return summary
}

/** Write the bond counts of the editor's diagram (./bondcounts.ts); returns the number written. */
export function drawBondCounts(): number {
    const diagram = CellDLEditor.instance?.celldlDiagram
    return diagram ? drawDiagramBondCounts(diagram) : 0
}

let scheduled: (() => void)|undefined     // cancels the scheduled redraw
let lastDrawCost = 0            // ms the last redraw took

// A redraw within a frame's budget is in the next frame; a slower one (a large diagram's free-form regions) waits
// four times as long as it took, so redrawing takes at most a fifth of the time while a change is dragged
const FRAME_BUDGET = 8

function cancelScheduled() {
    scheduled?.()
    scheduled = undefined
}

/**
 * Redraw the location shading after a diagram opens and after every change to it (an element placed, moved,
 * deleted or relocated, a bond drawn, an undo or redo), in the next frame so it follows a drag; a burst of changes
 * redraws once, with what the diagram is then. Nothing when it is off.
 */
export function scheduleRegions() {
    if (!shading || scheduled !== undefined) return
    const draw = () => {
        scheduled = undefined
        const start = performance.now()
        drawRegions()
        lastDrawCost = performance.now() - start
    }
    if (lastDrawCost <= FRAME_BUDGET && typeof requestAnimationFrame === 'function') {
        const frame = requestAnimationFrame(draw)
        scheduled = () => cancelAnimationFrame(frame)
    } else {
        const timer = setTimeout(draw, Math.max(16, 4 * lastDrawCost))
        scheduled = () => clearTimeout(timer)
    }
}

document.addEventListener('file-edited', () => scheduleRegions())
document.addEventListener('diagram-opened', () => scheduleRegions())

//==============================================================================

// The undo step of the last reorganise, while it is the editor's last step
let reorganiseStep: UndoState|undefined

// Move each component to its new place (rounded, then snapped to the grid as a drag is), each move kept for undo
function moveTo(objects: Map<string, CellDLObject>, positions: Map<string, Point2>) {
    for (const [id, to] of positions) {
        const object = objects.get(id)
        const svg = object?.celldlSvgElement
        if (!object || !svg) continue
        const from = svg.centroid
        if (Math.hypot(to.x - from.x, to.y - from.y) < 0.5) continue
        const target = { x: Math.round(to.x), y: Math.round(to.y) }
        const undoState = undoRedo.setMoveUndoState(object, from)
        object.initialiseMove(svg.svgElement)
        object.reposition(from, target)
        object.finaliseMove()
        undoState.endMove(target)
    }
}

/** The complexity of the diagram's current layout. */
export function currentComplexity(): Complexity|undefined {
    const { nodes, bonds } = diagramLayout()
    if (nodes.length === 0) return
    return layoutComplexity(nodes, bonds, { ...complexityOptions(nodes, bonds), rectangles: true })
}

/**
 * Move the diagram's nodes to a layout of lower complexity (../../plugins/bondgraph/layout.ts), by one of its
 * presets, adjusted by `options`. Compartment and region boxes go with what they contain (./boxfit.ts). Returns its
 * measures before and after (after equals before when no simpler layout was found, and nothing moves) and the cycles
 * drawn as circles. The reorganise is one undo step; undoReorganise() undoes it while it is the last.
 */
export async function reorganiseDiagram(onProgress?: (done: number, of: number) => void,
                                        options: Partial<LayoutOptions> = {}, preset: string = 'balanced') {
    const { nodes, bonds, objects } = diagramLayout()
    const diagram = CellDLEditor.instance?.celldlDiagram
    if (nodes.length === 0 || !diagram) return
    const chosen = presetOptions(preset)
    const result = await reorganiseLayout(nodes, bonds,
        { ...chosen, ...options, weights: { ...chosen.weights, ...options.weights } },
        async (done, of) => {
            onProgress?.(done, of)
            await new Promise(resolve => setTimeout(resolve, 0))      // keep the editor responsive
        })
    if (result.improved && CellDLEditor.instance?.celldlDiagram === diagram) {
        const boxes = boxContents(diagram)
        undoRedo.beginGroup()
        moveTo(objects, result.positions)
        fitBoxes(boxes)
        if (undoRedo.endGroup()) {
            reorganiseStep = undoRedo.lastStep
            CellDLEditor.instance?.setDirty()
            notifyChanges()
        }
    }
    drawRegions()
    return { before: result.before.complexity, after: result.after.complexity, measures: result,
             rings: result.cycles.length }
}

/** Whether the last reorganise is the editor's last undo step. */
export function canUndoReorganise(): boolean {
    return reorganiseStep !== undefined && reorganiseStep === undoRedo.lastStep
}

/** Undo the last reorganise, as the editor's Undo would, while it is the last undo step. */
export function undoReorganise(): boolean {
    if (!canUndoReorganise()) return false
    reorganiseStep = undefined
    CellDLEditor.instance?.undo()
    return true
}

//==============================================================================
//==============================================================================
