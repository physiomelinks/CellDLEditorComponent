/** biome-ignore-all lint/style/noNonNullAssertion: what a test finds is there */

import { describe, expect, test } from 'bun:test'

import { countEdits, editor, openFixture, settle } from './support/editor'

import type { CellDLObject } from '#editor/celldlObjects'
import { CellDLDiagram } from '#editor/diagram'
import { componentLibraryPlugin } from '#root/plugins'
import type { BondgraphPlugin } from '#root/plugins/bondgraph'
import { type DiagramElement, diagramUnitSystem, listElements, setElements, setUnitSystem }
    from '#root/plugins/bondgraph/elements'
import { placeEntry } from '#root/plugins/bondgraph/palette'
import { effectiveUnits, rescaledValue, UNIT_SYSTEM_IRIS, UNIT_SYSTEM_PREDICATE }
    from '#root/plugins/bondgraph/unitsystem'

//==============================================================================

const BGF = 'https://bg-rdf.org/ontologies/bondgraph-framework#'

// In the enzyme fixture
const STORE_S = 'ID-00000001'
const REACTION_1 = 'ID-00000006'

const plugin = () => componentLibraryPlugin.getPlugin('bondgraph-components') as unknown as BondgraphPlugin

function element(diagram: CellDLDiagram, id: string): DiagramElement {
    return listElements(diagram).find(element => element.id === id)!
}

function storedValue(object: CellDLObject): string|undefined {
    return object.rdfStore.query(`SELECT ?v WHERE { ${object.uri.toString()} <${BGF}hasValue> ?v }`)[0]?.get('v')?.value
}

function unitSystemTriples(diagram: CellDLDiagram): string[] {
    return diagram.rdfStore.query(`SELECT ?s WHERE { <${diagram.uri}> <${UNIT_SYSTEM_PREDICATE}> ?s }`)
                           .map(r => r.get('s')!.value)
}

//==============================================================================

describe('units in a unit system', () => {
    test('a template\'s code is rescaled in Cellular and kept in SI', () => {
        expect(effectiveUnits('mol-1', 'cellular')).toBe('fmol-1')
        expect(effectiveUnits('mol/s', 'cellular')).toBe('fmol/s')
        expect(effectiveUnits('J/mol', 'cellular')).toBe('J/mol')
        expect(effectiveUnits('L2.s-1.J-1', 'cellular')).toBe('pL2.s-1.fJ-1')
        expect(effectiveUnits('mol-1', 'si')).toBe('mol-1')
        expect(effectiveUnits('', 'cellular')).toBe('')
        // one it can't rescale is kept
        expect(effectiveUnits('A', 'cellular')).toBe('A')
    })

    test('a stored value converts as the same quantity', () => {
        expect(rescaledValue('1 mol', 'cellular')).toBe('1000000000000000 fmol')
        expect(rescaledValue('1 mol-1', 'cellular')).toBe('1e-15 fmol-1')
        expect(rescaledValue('0.1 mol/s', 'cellular')).toBe('100000000000000 fmol/s')
        expect(rescaledValue('2 fmol', 'si')).toBe('2e-15 mol')
        expect(rescaledValue('5 J/mol', 'cellular')).toBeUndefined()
        expect(rescaledValue('1', 'cellular')).toBeUndefined()
        expect(rescaledValue('1 A', 'cellular')).toBeUndefined()
    })
})

//==============================================================================

describe('a diagram\'s unit system', () => {
    test('is SI for a diagram without one, which is left without one', async () => {
        const diagram = await openFixture('enzyme.celldl')
        expect(diagramUnitSystem(diagram)).toBe('si')
        expect(unitSystemTriples(diagram)).toEqual([])
        expect(element(diagram, STORE_S).parameters).toEqual([{ name: 'K', value: '1', units: 'mol-1', stored: true }])
    })

    test('is the editor\'s option for a new diagram, written as its triple', async () => {
        expect(plugin().newDiagramUnitSystem).toBe('cellular')
        const diagram = new CellDLDiagram('', '', editor)
        expect(diagramUnitSystem(diagram)).toBe('cellular')
        expect(unitSystemTriples(diagram)).toEqual([UNIT_SYSTEM_IRIS.cellular])
        plugin().newDiagramUnitSystem = 'si'
        try {
            const siDiagram = new CellDLDiagram('', '', editor)
            expect(unitSystemTriples(siDiagram)).toEqual([UNIT_SYSTEM_IRIS.si])
        } finally {
            plugin().newDiagramUnitSystem = 'cellular'
        }
        // so its RDF says so
        expect(await diagram.rdf()).toContain('physiomelinks.github.io/ns/celldl#Cellular')
    })

    test('is null when the editor doesn\'t know it, and SI units are used', async () => {
        const diagram = await openFixture('enzyme.celldl')
        diagram.rdfStore.update(`INSERT DATA { <${diagram.uri}> <${UNIT_SYSTEM_PREDICATE}> <urn:x-unknown> }`)
        expect(diagramUnitSystem(diagram)).toBeNull()
        expect(plugin().unitSystem).toBe('si')
    })
})

//==============================================================================

describe('values in Cellular', () => {
    async function cellularFixture(): Promise<CellDLDiagram> {
        const diagram = await openFixture('enzyme.celldl')
        expect(await setUnitSystem(editor, diagram, 'cellular')).toEqual({ ok: true, unitSystem: 'cellular' })
        return diagram
    }

    test('a new element stores its defaults in the system\'s units', async () => {
        const diagram = await cellularFixture()
        const [store] = await placeEntry('chemical/store', { x: 400, y: 400 })
        expect(storedValue(store!)).toBe('0 fmol')
        const listed = element(diagram, store!.id)
        expect(listed.value).toEqual({ value: '0', units: 'fmol', stored: true })
        expect(listed.parameters).toEqual([{ name: 'K', value: '1', units: 'fmol-1', stored: true }])
        const placed = await placeEntry('chemical/reaction-node', { x: 600, y: 400 })
        expect(placed.flatMap(object => element(diagram, object.id)?.parameters ?? [])).toEqual([
            { name: 'kappa', value: '1', units: 'fmol/s', stored: true }
        ])
    })

    test('choosing a type stores its parameters in the system\'s units', async () => {
        const diagram = await cellularFixture()
        await setElements(editor, diagram, [{ id: STORE_S, field: 'type', value: `${BGF}QuantityStore` }])
        await setElements(editor, diagram, [{ id: STORE_S, field: 'type', value: `${BGF}ChemicalConcentration` }])
        expect(element(diagram, STORE_S).parameters).toEqual([{ name: 'K', value: '1', units: 'fmol-1', stored: true }])
    })

    test('an edit keeps a value\'s stored units', async () => {
        const diagram = await cellularFixture()
        // stored in mol, as before the diagram was Cellular
        expect(await setElements(editor, diagram, [
            { id: STORE_S, field: 'parameter:K', value: '3' },
            { id: STORE_S, field: 'value', value: '2' },
            { id: REACTION_1, field: 'parameter:kappa', value: '0.5' }
        ])).toEqual({ ok: true })
        const store = element(diagram, STORE_S)
        expect(store.parameters).toEqual([{ name: 'K', value: '3', units: 'mol-1', stored: true }])
        expect(store.value).toEqual({ value: '2', units: 'mol', stored: true })
        expect(element(diagram, REACTION_1).parameters).toEqual([
            { name: 'kappa', value: '0.5', units: 'mol/s', stored: true }
        ])
    })

    test('an edit keeps prefixed stored units in SI too', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const store = diagram.objectById(STORE_S)!
        store.rdfStore.update(`
            DELETE WHERE { ${store.uri.toString()} <${BGF}hasValue> ?v }`)
        store.rdfStore.update(`
            INSERT DATA { ${store.uri.toString()} <${BGF}hasValue> "1 mmol"^^<https://w3id.org/cdt/ucum> }`)
        await setElements(editor, diagram, [{ id: STORE_S, field: 'value', value: '4' }])
        expect(element(diagram, STORE_S).value).toEqual({ value: '4', units: 'mmol', stored: true })
    })
})

//==============================================================================

describe('setting the unit system', () => {
    test('is one undoable edit, which keeps values as they are', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const before = await diagram.rdf()
        const listed = listElements(diagram)
        const edits = countEdits()
        expect(await setUnitSystem(editor, diagram, 'cellular')).toEqual({ ok: true, unitSystem: 'cellular' })
        edits.stop()
        expect(edits.count).toBe(1)
        expect(unitSystemTriples(diagram)).toEqual([UNIT_SYSTEM_IRIS.cellular])
        expect(listElements(diagram)).toEqual(listed)

        editor.undo()
        await settle()
        expect(await diagram.rdf()).toBe(before)
        expect(diagramUnitSystem(diagram)).toBe('si')

        editor.redo()
        await settle()
        expect(diagramUnitSystem(diagram)).toBe('cellular')
    })

    test('with convert, converts stored values as the same quantities, undone with it', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const before = await diagram.rdf()
        expect(await setUnitSystem(editor, diagram, 'cellular', true)).toEqual({ ok: true, unitSystem: 'cellular' })
        const store = element(diagram, STORE_S)
        expect(store.value).toEqual({ value: '1000000000000000', units: 'fmol', stored: true })
        expect(store.parameters).toEqual([{ name: 'K', value: '1e-15', units: 'fmol-1', stored: true }])
        expect(element(diagram, REACTION_1).parameters[0]!.units).toBe('fmol/s')

        // and back again
        await setUnitSystem(editor, diagram, 'si', true)
        expect(element(diagram, STORE_S).parameters).toEqual([{ name: 'K', value: '1', units: 'mol-1', stored: true }])

        editor.undo()
        await settle()
        editor.undo()
        await settle()
        expect(await diagram.rdf()).toBe(before)
    })

    test('to the system it has changes nothing', async () => {
        const diagram = await openFixture('enzyme.celldl')
        await setUnitSystem(editor, diagram, 'cellular')
        const edits = countEdits()
        expect(await setUnitSystem(editor, diagram, 'cellular')).toEqual({ ok: true, unitSystem: 'cellular' })
        edits.stop()
        expect(edits.count).toBe(0)
    })

    test('to an unknown system is refused', async () => {
        const diagram = await openFixture('enzyme.celldl')
        expect(await setUnitSystem(editor, diagram, 'imperial')).toEqual({
            ok: false, unitSystem: 'si', error: 'Unknown unit system \'imperial\''
        })
        expect(unitSystemTriples(diagram)).toEqual([])
    })
})

//==============================================================================
//==============================================================================
