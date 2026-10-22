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

// Adding bond graph elements and bonds from code: by the Reactions panel (./reactions.ts) and the palette
// (../../plugins/bondgraph/palette.ts). From Finbar Argus's Reactions panel.

import { CELLDL, MetadataPropertiesMap } from '@celldl/metadata'
import * as $rdf from '@celldl/rdf'

import { type CellDLConnectedObject, CellDLConnection, type CellDLObject } from '#editor/celldlObjects'
import { undoRedo } from '#editor/diagram/undoredo'

import { componentLibraryPlugin } from '#root/plugins'
import type { BondgraphPlugin } from '#root/plugins/bondgraph'
import type { Point, PointLike } from '#root/utils/points'
import { CONNECTION_COLOUR, CONNECTION_WIDTH } from '#root/utils/styling'
import { svgPathElement } from '#root/utils/svgUtils'

import { CellDLEditor } from '.'

//==============================================================================

/** The loaded bond graph plugin. */
export function bondgraphPlugin(): BondgraphPlugin {
    const plugin = componentLibraryPlugin.getPlugin('bondgraph-components')
    if (!plugin) throw new Error('The bond graph plugin is not loaded')
    return plugin as unknown as BondgraphPlugin
}

/** The editor, its open diagram and its frame. */
export function editorParts() {
    const editor = CellDLEditor.instance
    const diagram = editor?.celldlDiagram
    const frame = editor?.editorFrame
    if (!editor || !diagram || !frame) throw new Error('No diagram is open')
    return { editor, diagram, frame }
}

/** A component's centre, in SVG coordinates. */
export function centroidOf(object: CellDLObject): Point {
    // biome-ignore lint/style/noNonNullAssertion: a diagram's component has an SVG element
    return object.celldlSvgElement!.centroid
}

//==============================================================================

/**
 * Add a component drawn from the library template `templateId`, centred at `centre`. Its element type, species and
 * location are for the caller to set.
 */
export function addComponent(templateId: string, centre: PointLike): CellDLConnectedObject {
    const { diagram, frame } = editorParts()
    const template = componentLibraryPlugin.getObjectTemplateById(templateId)
    if (!template) throw new Error(`No library template '${templateId}'`)
    const group = frame.addSvgElementFromTemplate(template, centre)
    const object = diagram.addConnectedObject(group, template)
    if (!object) throw new Error(`Cannot add a '${template.name ?? templateId}'`)
    return object
}

/** Centre a just added component at `centre`: a template is placed by its top left corner. */
export function centreAt(object: CellDLObject, centre: PointLike) {
    const at = centroidOf(object)
    // biome-ignore lint/style/noNonNullAssertion: a diagram's component has an SVG element
    object.initialiseMove(object.celldlSvgElement!.svgElement)
    object.reposition(at, centre)
    object.finaliseMove()
}

/**
 * Add an element of `elementType` centred at `centre`, with its species and location and optionally an initial
 * value (an RDF literal, copied as it is).
 */
export async function addElement(elementType: string, centre: PointLike, species?: string, location?: string,
                                 value?: $rdf.Literal): Promise<CellDLConnectedObject> {
    const plugin = bondgraphPlugin()
    const templateId = plugin.libraryTemplateId(elementType)
    if (!templateId) throw new Error(`No library template draws a ${$rdf.getFragment(elementType)}`)
    const object = addComponent(templateId, centre)
    await plugin.setElement(object, elementType, species, location, value)
    centreAt(object, centre)
    return object
}

// Where a line to `towards` leaves a component, if it can be found (an element with no size has no boundary)
function boundaryPoint(object: CellDLConnectedObject, towards: PointLike): PointLike|undefined {
    const point = object.celldlSvgElement?.boundaryIntersections(towards)[0]
    return point && Number.isFinite(point.x) && Number.isFinite(point.y) ? point : undefined
}

/** Add a straight bond from `source` to `target`, with a bgf:bondCount when `count` isn't 1. */
export function addBond(source: CellDLConnectedObject, target: CellDLConnectedObject, count: number = 1): CellDLConnection {
    const { diagram } = editorParts()
    const from = centroidOf(source)
    const to = centroidOf(target)
    const start = boundaryPoint(source, to) ?? from
    const end = boundaryPoint(target, from) ?? to
    const path = svgPathElement([start, end], {
        class: 'bondgraph linear arrow',
        stroke: CONNECTION_COLOUR,
        'stroke-width': String(CONNECTION_WIDTH)
    })
    const connection = diagram.addNewConnection(path, {
        CellDLClass: CellDLConnection,
        metadataProperties: MetadataPropertiesMap.fromProperties([
            [$rdf.RDF.uri('type'), CELLDL.uri('Connection')],
            [CELLDL.uri('hasSource'), source.uri],
            [CELLDL.uri('hasTarget'), target.uri],
            [CELLDL.uri('hasIntermediate'), []]
        ])
    })
    bondgraphPlugin().setBondCount(connection, count)
    return connection
}

/** Changes made by `edit` undone and redone as one step, even if it fails part way through. */
export async function asOneStep<T>(edit: () => Promise<T>): Promise<T> {
    undoRedo.beginGroup()
    try {
        return await edit()
    } finally {
        undoRedo.endGroup()
    }
}

//==============================================================================
//==============================================================================
