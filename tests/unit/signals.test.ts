/** biome-ignore-all lint/style/noNonNullAssertion: what a test places is there */

// Signal blocks and signal bonds (src/plugins/bondgraph/signals.ts and the plugin): which connections are signal
// bonds, what a new one does to its target, values typed with units, and the RDF bg2cellml reads.

import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { editor, openFixture } from './support/editor'

import type { CellDLConnectedObject, CellDLConnection, CellDLObject } from '#editor/celldlObjects'
import { loadPropertyGroups } from '#editor/components/properties'
import { CellDLDiagram } from '#editor/diagram'
import { addBond, bondgraphPlugin } from '#editor/editor/placing'
import { mathmlLatex, type MathNode } from '#root/plugins/bondgraph/lawtext'
import { paletteDomains, paletteEntries, placeEntry } from '#root/plugins/bondgraph/palette'
import {
    defaultSignalUse, drawSignalBonds, freeUnitsLabel, isSignalConnection, parseSignalUse, signalUseOptions,
    signalUseValue, valueWithUnits
} from '#root/plugins/bondgraph/signals'
import { PANEL_ID } from '#root/utils/editor-types'

//==============================================================================

const BGF = 'https://bg-rdf.org/ontologies/bondgraph-framework#'

describe('signal bonds\' choices', () => {
    test('a connection is a signal bond when either end is a signal block, or signal bonds are drawn', () => {
        expect(isSignalConnection({ sourceIsBlock: false, targetIsBlock: false, drawingSignals: false })).toBe(false)
        expect(isSignalConnection({ sourceIsBlock: true, targetIsBlock: false, drawingSignals: false })).toBe(true)
        expect(isSignalConnection({ sourceIsBlock: false, targetIsBlock: true, drawingSignals: false })).toBe(true)
        expect(isSignalConnection({ sourceIsBlock: false, targetIsBlock: false, drawingSignals: true })).toBe(true)
    })

    test('a new signal bond sets its target\'s first free input, else scales its first parameter', () => {
        const product = { inputs: ['u_1', 'u_2'], parameters: [] }
        expect(defaultSignalUse(product, [])).toEqual({ signalInput: 'u_1' })
        expect(defaultSignalUse(product, ['u_1'])).toEqual({ signalInput: 'u_2' })
        expect(defaultSignalUse(product, ['u_1', 'u_2'])).toEqual({ signalInput: 'u_1' })
        expect(defaultSignalUse({ inputs: [], parameters: ['C', 'q_us'] }, [])).toEqual({ modulates: 'C', exponent: 1 })
        expect(defaultSignalUse({ inputs: [], parameters: [], sourceValue: 'v' }, [])).toEqual({ modulates: 'v', exponent: 1 })
        expect(defaultSignalUse({ inputs: [], parameters: [] }, [])).toEqual({})
    })

    test('a use round-trips through the Properties panel\'s value', () => {
        for (const use of [{ signalInput: 'Pi_in' }, { modulates: 'k', exponent: -1 }, { modulates: 'R', exponent: 1 }]) {
            expect(parseSignalUse(signalUseValue(use), 'exponent' in use ? use.exponent : 1)).toEqual(use)
        }
        expect(parseSignalUse('')).toEqual({})
        expect(parseSignalUse('modulates:k', 7)).toEqual({ modulates: 'k', exponent: 1 })
        expect(signalUseOptions({ inputs: ['u'], parameters: ['tau'], sourceValue: 'v' })).toEqual([
            { name: 'Signal input u', value: 'input:u' },
            { name: 'Sets parameter tau', value: 'input:tau' },
            { name: 'Scales parameter tau', value: 'modulates:tau' },
            { name: 'Sets the source\'s value v', value: 'input:v' },
            { name: 'Scales the source\'s value v', value: 'modulates:v' }
        ])
        // setting a parameter is written as the bond's signal input
        expect(parseSignalUse('input:tau')).toEqual({ signalInput: 'tau' })
    })

    test('a value is typed with its units, or keeps those stored, else is dimensionless', () => {
        expect(valueWithUnits('12 kPa')).toBe('12 kPa')
        expect(valueWithUnits('5e-9 mol')).toBe('5e-9 mol')
        expect(valueWithUnits(' 3.50mmol/L ')).toBe('3.5 mmol/L')
        expect(valueWithUnits('7', 'kPa')).toBe('7 kPa')
        expect(valueWithUnits('7')).toBe('7 1')
        expect(valueWithUnits(-0.5)).toBe('-0.5 1')
        expect(valueWithUnits('kPa')).toBeUndefined()
        expect(valueWithUnits('1 k Pa')).toBeUndefined()
        expect(freeUnitsLabel('u')).toBe('units of u')
        expect(freeUnitsLabel()).toBe('any units')
    })

    test('a law with max, or with no equation, has LaTeX', () => {
        const parse = (xml: string) => new DOMParser().parseFromString(xml, 'text/xml').documentElement as unknown as MathNode
        expect(mathmlLatex(parse('<math xmlns="http://www.w3.org/1998/Math/MathML"/>'))).toBe('')
        expect(mathmlLatex(parse('<math xmlns="http://www.w3.org/1998/Math/MathML"><apply><eq/><ci>v</ci>'
            + '<apply><max/><ci>u</ci><cn>0</cn></apply></apply></math>'))).toBe('v = \\max\\left(u, 0\\right)')
    })
})

//==============================================================================

async function emptyDiagram(): Promise<CellDLDiagram> {
    const diagram = await openFixture('enzyme.celldl')
    for (const element of [...diagram.svgDiagram.querySelectorAll('g.celldl-Component')]) {
        const object = diagram.objectById(element.id)
        if (object) diagram.removeObject(object)
    }
    return diagram
}

async function place(entryId: string, x: number): Promise<CellDLConnectedObject> {
    return (await placeEntry(entryId, { x, y: 0 }))[0] as CellDLConnectedObject
}

function triples(object: CellDLObject): string[] {
    return object.rdfStore.query(`SELECT ?p ?o WHERE { ${object.uri.toString()} ?p ?o }`)
        .map(r => `${r.get('p')!.value.replace(BGF, 'bgf:')} ${r.get('o')!.value.replace(BGF, 'bgf:')}`)
}

function parameters(object: CellDLObject): Record<string, string> {
    return Object.fromEntries(object.rdfStore.query(`
        SELECT ?name ?value WHERE { ${object.uri.toString()} <${BGF}parameterValue> [ <${BGF}varName> ?name ; <${BGF}hasValue> ?value ] }`)
        .map(r => [r.get('name')!.value, r.get('value')!.value]))
}

afterEach(() => { drawSignalBonds.value = false })

describe('signal blocks', () => {
    test('the palette has a Signals filter of blocks, without junctions', () => {
        expect(paletteDomains().map(o => o.label)).toContain('Signals')
        const labels = paletteEntries('signal').map(e => e.label)
        for (const label of ['First-order lag', 'Product of two dimensionless signals', 'Signal input port']) {
            expect(labels).toContain(label)
        }
        expect(labels.some(l => /junction|node/i.test(l))).toBe(false)
        const hydraulic = paletteEntries('hydraulic').map(e => e.elementType?.replace(BGF, ''))
        for (const type of ['HydraulicCompliance', 'ViscoelasticHydraulicComplianceNode', 'HydraulicInertanceNode',
                            'ResistiveHydraulicInertance', 'RectifyingHydraulicResistanceNode', 'KedemKatchalskyWaterFlux']) {
            expect(hydraulic).toContain(type)
        }
    })

    test('a block stores its parameters and value; one without fixed units takes those typed', async () => {
        await emptyDiagram()
        const plugin = bondgraphPlugin()
        const lag = await place('signal/SignalBlock/FirstOrderLag', 0)
        expect(triples(lag)).toContain('http://www.w3.org/1999/02/22-rdf-syntax-ns#type bgf:FirstOrderLag')
        expect(parameters(lag)).toEqual({ tau: '1 s' })
        expect(triples(lag)).toContain('bgf:hasValue 0 1')
        const groups = loadPropertyGroups(PANEL_ID.PROPERTIES_PANEL, plugin.getPanelTemplates(PANEL_ID.PROPERTIES_PANEL), lag)
        const value = groups.flatMap(g => g.items).find(i => i.itemId.endsWith('/bg-element-value'))!
        expect(value.name).toBe('Initial value (units of u)')
        await plugin.updateObjectProperties(lag, PANEL_ID.PROPERTIES_PANEL, value.itemId,
                                            { oldValue: '0 1', newValue: '12 kPa' }, groups)
        expect(triples(lag)).toContain('bgf:hasValue 12 kPa')
        const sigmoid = await place('signal/SignalBlock/SigmoidMap', 100)
        const sigmoidGroups = loadPropertyGroups(PANEL_ID.PROPERTIES_PANEL,
                                                 plugin.getPanelTemplates(PANEL_ID.PROPERTIES_PANEL), sigmoid)
        const items = sigmoidGroups.flatMap(g => g.items)
        expect(items.find(i => i.itemId.endsWith('/u_nom'))!.name).toBe('u_nom (units of u)')
        expect(items.find(i => i.itemId.endsWith('/y_min'))!.name).toBe('y_min (any units)')
        await plugin.updateObjectProperties(sigmoid, PANEL_ID.PROPERTIES_PANEL, 'bg-element-parameters/u_nom',
                                            { oldValue: '1 1', newValue: '13.3 kPa' }, sigmoidGroups)
        await plugin.updateObjectProperties(sigmoid, PANEL_ID.PROPERTIES_PANEL, 'bg-element-parameters/u_nom',
                                            { oldValue: '13.3 kPa', newValue: '14' }, sigmoidGroups)
        expect(parameters(sigmoid).u_nom).toBe('14 kPa')
    })
})

describe('module ports', () => {
    test('a port block and a flow source have a port type; a block has no species or location', async () => {
        await emptyDiagram()
        const plugin = bondgraphPlugin()
        const load = (object: CellDLObject) => loadPropertyGroups(PANEL_ID.PROPERTIES_PANEL,
                                                                   plugin.getPanelTemplates(PANEL_ID.PROPERTIES_PANEL), object)
        const port = await place('signal/SignalBlock/SignalInputPort', 0)
        const groups = load(port)
        const ids = groups.flatMap(g => g.items).map(i => i.itemId.split('/')[1])
        expect(ids).toContain('bg-element-port-type')
        expect(ids).not.toContain('bg-element-species')
        await plugin.updateObjectProperties(port, PANEL_ID.PROPERTIES_PANEL, 'bg-element-properties/bg-element-port-type',
                                            { oldValue: '', newValue: 'renal_perfusion_pressure_port' }, groups)
        expect(triples(port)).toContain('bgf:portType renal_perfusion_pressure_port')
        const source = await place('chemical/flux-source', 100)
        expect(load(source).flatMap(g => g.items).map(i => i.itemId.split('/')[1])).toContain('bg-element-port-type')
        const lag = await place('signal/SignalBlock/FirstOrderLag', 200)
        expect(load(lag).flatMap(g => g.items).map(i => i.itemId.split('/')[1])).not.toContain('bg-element-port-type')
    })
})

describe('signal bonds', () => {
    test('a bond from or to a block is a signal bond, setting an input or scaling a parameter', async () => {
        const diagram = await emptyDiagram()
        const plugin = bondgraphPlugin()
        const compliance = await place('hydraulic/QuantityStore/HydraulicCompliance', 0)
        const lag = await place('signal/SignalBlock/FirstOrderLag', 100)
        const resistor = await place('hydraulic/Resistance/HydraulicResistor', 200)
        const into = addBond(compliance, lag)
        const out = addBond(lag, resistor)
        for (const bond of [into, out]) {
            expect(plugin.isSignalBond(bond)).toBe(true)
            expect(bond.celldlSvgElement!.svgElement.classList.contains('signal')).toBe(true)
        }
        expect(plugin.signalUse(into)).toEqual({ signalInput: 'u' })
        const firstParameter = Object.keys(parameters(resistor)).sort()[0]!
        expect(plugin.signalUse(out)).toEqual({ modulates: firstParameter, exponent: 1 })
        plugin.setSignalUse(out, { modulates: firstParameter, exponent: -1 })
        expect(triples(out)).toContain('bgf:modulationExponent -1')
        // none of the power-bond rules, nor a reaction's equations
        expect(plugin.reactionEquations().every(eq => eq.substrates.length + eq.products.length === 0)).toBe(true)
        const rdf = await diagram.rdf()
        expect(rdf).toMatch(/bgf:hasSignalBlock/)
        expect(rdf).toMatch(/bgf:hasSignalBond/)
        expect(rdf).toMatch(/celldl:Connection, bgf:SignalBond/)
    })

    test('with signal bonds chosen, a bond between bond elements is one, and its kind can change', async () => {
        await emptyDiagram()
        const plugin = bondgraphPlugin()
        const compliance = await place('hydraulic/QuantityStore/HydraulicCompliance', 0)
        const junction = await place('hydraulic/OneNode', 100)
        const resistor = await place('hydraulic/Resistance/HydraulicResistor', 200)
        drawSignalBonds.value = true
        expect(plugin.checkConnectionValid(compliance, resistor)).toBeUndefined()
        expect(plugin.checkConnectionValid(compliance, junction)?.alert).toMatch(/not a junction/)
        const signal = addBond(compliance, resistor)
        expect(plugin.isSignalBond(signal)).toBe(true)
        drawSignalBonds.value = false
        expect(plugin.checkConnectionValid(compliance, resistor)?.alert).toBe('Direct connections between Bond Elements are not allowed')
        expect(plugin.setBondKind(signal, false)).toBe('Direct connections between Bond Elements are not allowed')
        const power = addBond(compliance, junction) as CellDLConnection
        expect(plugin.isSignalBond(power)).toBe(false)
        expect(plugin.setBondKind(power, true)).toMatch(/not a junction/)
        // a full resistor still takes a signal bond
        addBond(junction, resistor)
        expect(resistor.maxConnections).toBe(resistor.numConnections)
        drawSignalBonds.value = true
        expect(resistor.maxConnections).toBe(resistor.numConnections + 1)
    })

    test('an element with all its power bonds still takes a signal bond from a block', async () => {
        await emptyDiagram()
        const source = await place('chemical/flux-source', 0)
        const store = await place('chemical/store', 150)
        const port = await place('signal/SignalBlock/SignalInputPort', 0)
        addBond(source, store)
        addBond(port, source)
        expect(source.numConnections).toBe(2)
    })

    test('an opened document\'s full element keeps its signal bonds', async () => {
        // vessel_inertance's flow source Sf_intake has its one power bond and a signal bond setting its value
        const text = readFileSync(join(import.meta.dir, '../examples/signals/vessel_inertance.celldl.svg'), 'utf8')
        const diagram = new CellDLDiagram('vessel_inertance.celldl.svg', text, editor)
        await editor.editDiagram(diagram)
        const id = diagram.rdfStore.query(`SELECT ?e WHERE { ?e <${BGF}hasSymbol> "Sf_intake" }`)[0]!.get('e')!.value
        const source = diagram.objectById(id.split('#').pop()!) as CellDLConnectedObject
        expect(source.numConnections).toBe(2)
        expect(source.connections.filter(c => bondgraphPlugin().isSignalBond(c)).length).toBe(1)
    })

    test('a connection\'s Properties offer its kind and what it does to its target', async () => {
        await emptyDiagram()
        const plugin = bondgraphPlugin()
        const source = await place('chemical/store', 0)
        const flux = await place('hydraulic/Reaction/KedemKatchalskyWaterFlux', 200)
        drawSignalBonds.value = true
        const bond = addBond(source, flux)
        const groups = loadPropertyGroups(PANEL_ID.PROPERTIES_PANEL, plugin.getPanelTemplates(PANEL_ID.PROPERTIES_PANEL), bond)
        const items = groups.find(g => g.groupId === 'bg-signal-bond')!.items
        expect(items.map(i => i.itemId.split('/')[1])).toEqual(['kind', 'variable', 'use'])
        expect(items[2]!.possibleValues!.map(o => o.value)).toEqual(['input:Pi_in', 'input:Pi_out', 'input:Lp',
                                                                      'modulates:Lp', 'input:sigma', 'modulates:sigma'])
        expect(plugin.signalUse(bond)).toEqual({ signalInput: 'Pi_in' })
        await plugin.updateObjectProperties(bond, PANEL_ID.PROPERTIES_PANEL, 'bg-signal-bond/use',
                                            { oldValue: 'input:Pi_in', newValue: 'modulates:Lp' }, groups)
        expect(groups.find(g => g.groupId === 'bg-signal-bond')!.items.map(i => i.itemId.split('/')[1]))
            .toEqual(['kind', 'variable', 'use', 'exponent'])
        await plugin.updateObjectProperties(bond, PANEL_ID.PROPERTIES_PANEL, 'bg-signal-bond/exponent',
                                            { oldValue: '1', newValue: '-1' }, groups)
        await plugin.updateObjectProperties(bond, PANEL_ID.PROPERTIES_PANEL, 'bg-signal-bond/variable',
                                            { oldValue: 'default', newValue: 'q' }, groups)
        expect(plugin.signalUse(bond)).toEqual({ modulates: 'Lp', exponent: -1 })
        expect(plugin.signalVariable(bond)).toBe('q')
    })
})
