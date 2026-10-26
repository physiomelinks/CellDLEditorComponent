/** biome-ignore-all lint/style/noNonNullAssertion: what a test places is there */

// Element templates that the element audit found the editor could not use: those with variables, a 4-port
// reaction, the One storage node composites, and an elastic vessel's singular defaults. libcellml.js doesn't run
// under bun, so with TEMPLATES_RDF_OUT set to a directory each diagram's RDF is written there, for converting
// with bg2cellml.

import { describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { editor, openFixture } from './support/editor'

import type { CellDLConnectedObject, CellDLObject } from '#editor/celldlObjects'
import { PathMaker } from '#editor/connections/pathmaker'
import type { CellDLDiagram } from '#editor/diagram'
import { notifyChanges } from '#editor/editor'
import { addBond, bondgraphPlugin } from '#editor/editor/placing'
import { listElements, setElements } from '#root/plugins/bondgraph/elements'
import { paletteEntries, placeEntry } from '#root/plugins/bondgraph/palette'

//==============================================================================

const BGF = 'https://bg-rdf.org/ontologies/bondgraph-framework#'

/** Writes the diagram's RDF to `TEMPLATES_RDF_OUT`, if set */
async function writeRdf(diagram: CellDLDiagram, name: string) {
    const out = process.env.TEMPLATES_RDF_OUT
    if (out) writeFileSync(join(out, `${name}.ttl`), await diagram.rdf())
}

/** The enzyme fixture with everything removed (the headless editor can't start an empty diagram) */
async function emptyDiagram(): Promise<CellDLDiagram> {
    const diagram = await openFixture('enzyme.celldl')
    for (const element of [...diagram.svgDiagram.querySelectorAll('g.celldl-Component')]) {
        const object = diagram.objectById(element.id)
        if (object) diagram.removeObject(object)
    }
    return diagram
}

/** Places a palette entry, giving it `type` as Properties would */
async function place(entryId: string, x: number, type?: string): Promise<CellDLConnectedObject> {
    const object = (await placeEntry(entryId, { x, y: 0 }))[0] as CellDLConnectedObject
    if (type) {
        await bondgraphPlugin().setElement(object, `${BGF}${type}`)
        bondgraphPlugin().storeDefaultParameters(object)
    }
    return object
}

function values(object: CellDLObject, predicate: string): Record<string, string> {
    return Object.fromEntries(object.rdfStore.query(`
        SELECT ?name ?value WHERE { ${object.uri.toString()} <${BGF}${predicate}> [ <${BGF}varName> ?name ; <${BGF}hasValue> ?value ] }`)
        .map(r => [r.get('name')!.value, r.get('value')!.value]))
}

//==============================================================================

describe('variable values', () => {
    test('a diagram saved with bgf:VariableValue opens with bgf:variableValue and shows its variables',
         async () => {
        const diagram = await openFixture('osmotic-old-predicate.celldl')
        const rdf = await diagram.rdf()
        expect(rdf).not.toContain('VariableValue')
        expect(rdf).toContain('bgf:variableValue')
        const transporter = listElements(diagram).find(e => e.template === `${BGF}OsmoticTransporter`)!
        expect(Object.fromEntries(transporter.variables.map(v => [v.name, v.value]))).toEqual({
            q_water_in: '1', q_solute_in: '1', q_water_out: '1', q_solute_out: '1'
        })
        await writeRdf(diagram, 'osmotic-old-predicate')
    })

    test('a template\'s variables are stored as bgf:variableValue, at 1', async () => {
        await emptyDiagram()
        const transporter = await place('all/Reaction', 0, 'OsmoticTransporter')
        expect(values(transporter, 'variableValue')).toEqual({
            q_water_in: '1 L', q_solute_in: '1 mol', q_water_out: '1 L', q_solute_out: '1 mol'
        })
    })
})

describe('choosing a template with variables in Properties', () => {
    test('stores each variable at 1, and an elastic vessel\'s q_bar at 3', async () => {
        const diagram = await emptyDiagram()
        const reaction = await place('all/Reaction', 0)
        const store = await place('all/QuantityStore', 100)
        const result = await setElements(editor, diagram, [
            { id: reaction.id, field: 'type', value: `${BGF}OsmoticTransporter` },
            { id: store.id, field: 'type', value: `${BGF}ElasticVessel` }
        ])
        expect(result.ok).toBe(true)
        expect(values(reaction, 'variableValue')).toEqual({
            q_water_in: '1 L', q_solute_in: '1 mol', q_water_out: '1 L', q_solute_out: '1 mol'
        })
        expect(values(store, 'parameterValue')).toEqual({ E: '1 J', q_hat: '1 L', q_bar: '3 L' })
    })
})

describe('a reaction template\'s ports', () => {
    test('allow an NKE transporter its four bonds', async () => {
        const diagram = await emptyDiagram()
        const [nai, ko] = [await place('chemical/species', 0), await place('chemical/species', 100)]
        const reaction = await place('all/Reaction', 200, 'NKETransporter')
        const [nao, ki] = [await place('chemical/species', 300), await place('chemical/species', 400)]
        expect(reaction.maxConnections).toBe(4)
        addBond(nai, reaction)
        addBond(ko, reaction)
        // Bonds out of it can still start
        expect(PathMaker.validStartObject(reaction, () => {})).not.toBeNull()
        addBond(reaction, nao)
        addBond(reaction, ki)
        notifyChanges()
        expect(reaction.numConnections).toBe(4)
        await writeRdf(diagram, 'nke-transporter')
    })

    test('as its One reaction node composite has', async () => {
        const diagram = await emptyDiagram()
        const [nai, ko] = [await place('chemical/species', 0), await place('chemical/species', 100)]
        const reaction = await place('all/OneReactionNode', 200, 'NKETransporterNode')
        const [nao, ki] = [await place('chemical/species', 300), await place('chemical/species', 400)]
        for (const [source, target] of [[nai, reaction], [ko, reaction], [reaction, nao], [reaction, ki]]) {
            addBond(source!, target!)
        }
        notifyChanges()
        expect(reaction.numConnections).toBe(4)
        await writeRdf(diagram, 'nke-transporter-node')
    })

    test('a reaction with its bonds says why another can\'t start', async () => {
        await emptyDiagram()
        const [a, b] = [await place('chemical/store', 0), await place('chemical/store', 200)]
        const reaction = await place('all/Reaction', 100, 'ChemicalReaction')
        expect(reaction.maxConnections).toBe(2)
        addBond(a, reaction)
        addBond(reaction, b)
        const said: string[] = []
        expect(PathMaker.validStartObject(reaction, msg => said.push(msg))).toBeNull()
        expect(said).toEqual(['Component has maximum number of connections'])
    })
})

describe('a One storage node', () => {
    test('has a palette tile whose templates are the inductive nodes', async () => {
        const entry = paletteEntries('all').find(e => e.baseTemplateId.endsWith('/OneStorageNode'))!
        expect(entry).toBeDefined()
        const diagram = await emptyDiagram()
        const source = await place('all/PotentialSource', 0, 'VoltageSource')
        const inductor = await place(entry.id, 100)
        const templates = listElements(diagram).find(e => e.id === inductor.id)!.templates.map(t => t.type)
        expect(templates).toEqual(expect.arrayContaining([`${BGF}ElectricalInductiveNode`,
                                                          `${BGF}MechanicalInductiveNode`]))
        await bondgraphPlugin().setElement(inductor, `${BGF}ElectricalInductiveNode`)
        bondgraphPlugin().storeDefaultParameters(inductor)
        const resistor = await place('all/Resistance', 200, 'ElectricalResistor')
        addBond(source, inductor)
        addBond(inductor, resistor)
        notifyChanges()
        expect(inductor.numConnections).toBe(2)
        await writeRdf(diagram, 'electrical-inductive-node')
    })
})

describe('an elastic vessel\'s defaults', () => {
    test('give a maximum volume above its unstressed volume', async () => {
        const diagram = await emptyDiagram()
        const vessel = await place('all/QuantityStore', 0, 'ElasticVessel')
        const node = await place('all/ZeroStorageNode_q', 200, 'HydraulicElasticStorageNode')
        for (const object of [vessel, node]) {
            expect(values(object, 'parameterValue')).toEqual({ E: '1 J', q_hat: '1 L', q_bar: '3 L' })
        }
        // Each drains through a resistor
        const junction = await place('all/ZeroNode', 100)
        addBond(junction, vessel)
        addBond(junction, await place('all/Resistance', 100, 'HydraulicResistor'))
        addBond(node, await place('all/Resistance', 300, 'HydraulicResistor'))
        notifyChanges()
        expect(junction.numConnections).toBe(2)
        expect(node.numConnections).toBe(1)
        await writeRdf(diagram, 'elastic-vessels')
    })
})
