import { describe, expect, test } from 'bun:test'

import { countEdits, editor, fixture, openFixture, settle, viewerEvents } from './support/editor'

import { CellDLDiagram } from '#editor/diagram'
import type { EditorMessage } from '#editor/editor'
import {
    type DiagramElement, leadingDigitSpeciesWarning, listElements, setElements
} from '#root/plugins/bondgraph/elements'
import { PANEL_ID } from '#root/utils/editor-types'
import { updateItemProperty } from '#editor/components/properties'
import { DCT } from '@celldl/rdf'

//==============================================================================

const BGF = 'https://bg-rdf.org/ontologies/bondgraph-framework#'

// In the enzyme fixture
const STORE_S = 'ID-00000001'
const JUNCTION_S = 'ID-00000002'
const STORE_E = 'ID-00000003'
const REACTION_1 = 'ID-00000006'

function element(elements: DiagramElement[], id: string): DiagramElement {
    const found = elements.find(element => element.id === id)
    expect(found).toBeDefined()
    return found as DiagramElement
}

/** Changes a property as the Properties panel does, by its `panel-event` */
async function panelEdit(diagram: CellDLDiagram, id: string, itemId: string,
                         oldValue: string|number|undefined, newValue: string|number) {
    document.dispatchEvent(new CustomEvent('toolbar-event', {
        detail: { type: 'state', source: PANEL_ID.PROPERTIES_PANEL, value: true }
    }))
    expect(editor.selectObjectById(id)).toBe(true)
    expect(diagram.objectById(id)).not.toBeNull()
    document.dispatchEvent(new CustomEvent('panel-event', {
        detail: {
            type: 'value',
            source: PANEL_ID.PROPERTIES_PANEL,
            itemId,
            value: { oldValue, newValue }
        }
    }))
    // Property edits run in turn, so this waits for the panel's
    await editor.editProperties([], async () => {})
    await settle()
}

//==============================================================================

describe('list', () => {
    test('gives every bond graph element, and no bonds', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const elements = listElements(diagram)
        expect(elements.map(e => e.id)).toEqual([
            'ID-00000001', 'ID-00000002', 'ID-00000003', 'ID-00000004', 'ID-00000005', 'ID-00000006', 'ID-00000007',
            'ID-00000008', 'ID-00000009', 'ID-00000010', 'ID-00000011', 'ID-00000012', 'ID-00000013', 'ID-00000014'
        ])
        expect(elements.filter(e => e.isBondElement)).toHaveLength(6)
        expect(elements.filter(e => e.junctionType === `${BGF}ZeroNode`)).toHaveLength(4)
        expect(elements.filter(e => e.junctionType === `${BGF}OneNode`)).toHaveLength(4)
    })

    test('gives a store\'s templates, species, location, value and parameters', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const store = element(listElements(diagram), STORE_S)
        expect(store).toMatchObject({
            kind: `${BGF}QuantityStore`,
            kindName: 'Static energy store',
            isBondElement: true,
            template: `${BGF}ChemicalConcentration`,
            templateName: 'Chemical concentration',
            symbol: 'q',
            species: 'S',
            location: 'c',
            value: { value: '1', units: 'mol', stored: true },
            parameters: [{ name: 'K', value: '1', units: 'mol-1', stored: true }],
            variables: [],
            neighbours: [JUNCTION_S]
        })
        // The base component first, then templates with their domains
        expect(store.templates[0]).toEqual({ type: `${BGF}QuantityStore`, name: 'Static energy store' })
        expect(store.templates.slice(1)).toContainEqual({
            type: `${BGF}ChemicalConcentration`,
            name: 'Chemical concentration',
            domain: `${BGF}Chemical`
        })
        // Connected to a chemical junction, so only chemical templates are offered
        expect(store.templates.slice(1).every(t => t.domain === `${BGF}Chemical`)).toBe(true)
    })

    test('gives a reaction\'s parameter and a junction\'s neighbours', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const elements = listElements(diagram)
        const reaction = element(elements, REACTION_1)
        expect(reaction.template).toBe(`${BGF}ChemicalReaction`)
        expect(reaction.value).toBeUndefined()
        expect(reaction.parameters).toEqual([{ name: 'kappa', value: '10', units: 'mol/s', stored: true }])
        const junction = element(elements, JUNCTION_S)
        expect(junction).toMatchObject({ kindName: 'Zero node', isBondElement: false, species: 'S', location: 'c' })
        expect(junction.template).toBeUndefined()
        expect(junction.neighbours).toContain(STORE_S)
    })

    test('lists the elements of another domain', async () => {
        const diagram = await openFixture('rlc.celldl')
        const elements = listElements(diagram)
        expect(elements).toHaveLength(7)
        const capacitor = elements.find(e => e.template === `${BGF}MechanicalCapacitor`)
        expect(capacitor?.templates.slice(1).every(t => t.domain === `${BGF}Mechanical`)).toBe(true)
        expect(capacitor?.parameters.length).toBeGreaterThan(0)
    })
})

//==============================================================================

describe('set', () => {
    const EDITS = [
        { itemId: 'bg-element-properties/bg-element-species', field: 'species', old: 'S', value: 'Glc' },
        { itemId: 'bg-element-properties/bg-element-location', field: 'location', old: 'c', value: 'cyt' },
        { itemId: 'bg-element-parameters/K', field: 'parameter:K', old: '1', value: '2.5' },
        { itemId: 'bg-element-initial-value/bg-element-value', field: 'value', old: 1, value: '3' }
    ] as const

    for (const edit of EDITS) {
        test(`of ${edit.field} gives the Properties panel's RDF`, async () => {
            const panelDiagram = await openFixture('enzyme.celldl')
            const numeric = edit.field === 'parameter:K' || edit.field === 'value'
            await panelEdit(panelDiagram, STORE_S, edit.itemId, edit.old, numeric ? Number(edit.value) : edit.value)
            const panelRdf = await panelDiagram.rdf()

            const diagram = await openFixture('enzyme.celldl')
            const before = await diagram.rdf()
            const result = await setElements(editor, diagram, [{ id: STORE_S, field: edit.field, value: edit.value }])
            expect(result).toEqual({ ok: true })
            const rdf = await diagram.rdf()
            expect(rdf).not.toBe(before)
            expect(rdf).toBe(panelRdf)
        })
    }

    test('updates what list gives', async () => {
        const diagram = await openFixture('enzyme.celldl')
        await setElements(editor, diagram, [
            { id: STORE_S, field: 'species', value: 'Glc' },
            { id: STORE_S, field: 'parameter:K', value: '2.5' }
        ])
        const store = element(listElements(diagram), STORE_S)
        expect(store.species).toBe('Glc')
        expect(store.parameters).toEqual([{ name: 'K', value: '2.5', units: 'mol-1', stored: true }])
    })

    test('of type stores default parameters of 1, as the panel does', async () => {
        const panelDiagram = await openFixture('enzyme.celldl')
        await panelEdit(panelDiagram, STORE_S, 'bg-element-properties/bg-element-type',
                        `${BGF}ChemicalConcentration`, `${BGF}QuantityStore`)
        await panelEdit(panelDiagram, STORE_S, 'bg-element-properties/bg-element-type',
                        `${BGF}QuantityStore`, `${BGF}ChemicalConcentration`)
        const panelRdf = await panelDiagram.rdf()

        const diagram = await openFixture('enzyme.celldl')
        expect(await setElements(editor, diagram, [
            { id: STORE_S, field: 'parameter:K', value: '7' },
            { id: STORE_S, field: 'type', value: `${BGF}QuantityStore` }
        ])).toEqual({ ok: true })
        const untyped = element(listElements(diagram), STORE_S)
        expect(untyped.template).toBeUndefined()
        expect(untyped.parameters).toEqual([])

        expect(await setElements(editor, diagram, [
            { id: STORE_S, field: 'type', value: `${BGF}ChemicalConcentration` }
        ])).toEqual({ ok: true })
        const typed = element(listElements(diagram), STORE_S)
        expect(typed.template).toBe(`${BGF}ChemicalConcentration`)
        expect(typed.parameters).toEqual([{ name: 'K', value: '1', units: 'mol-1', stored: true }])
        expect(await diagram.rdf()).toBe(panelRdf)
    })

    test('of several fields is one undo step, which redo reapplies', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const before = await diagram.rdf()
        const listed = listElements(diagram)
        const result = await setElements(editor, diagram, [
            { id: STORE_S, field: 'species', value: 'Glc' },
            { id: STORE_S, field: 'location', value: 'cyt' },
            { id: JUNCTION_S, field: 'species', value: 'Glc' },
            { id: STORE_E, field: 'parameter:K', value: '4' },
            { id: REACTION_1, field: 'parameter:kappa', value: '0.5' },
            { id: STORE_E, field: 'type', value: `${BGF}QuantityStore` }
        ])
        expect(result).toEqual({ ok: true })
        const after = await diagram.rdf()
        const listedAfter = listElements(diagram)

        editor.undo()
        await settle()
        expect(await diagram.rdf()).toBe(before)
        expect(listElements(diagram)).toEqual(listed)

        editor.redo()
        await settle()
        expect(await diagram.rdf()).toBe(after)
        expect(listElements(diagram)).toEqual(listedAfter)

        // Undone once more, the edit is gone again
        editor.undo()
        await settle()
        expect(await diagram.rdf()).toBe(before)
    })

    test('makes the Properties panel\'s own edits undoable', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const before = await diagram.rdf()
        await panelEdit(diagram, STORE_S, 'bg-element-properties/bg-element-species', 'S', 'Glc')
        expect(element(listElements(diagram), STORE_S).species).toBe('Glc')
        editor.undo()
        await settle()
        expect(await diagram.rdf()).toBe(before)
        expect(element(listElements(diagram), STORE_S).species).toBe('S')
    })

    test('keeps a later change that isn\'t undoable, such as a description', async () => {
        const diagram = await openFixture('enzyme.celldl')
        await setElements(editor, diagram, [{ id: STORE_S, field: 'species', value: 'Glc' }])
        const object = diagram.objectById(STORE_S)
        expect(object).not.toBeNull()
        // biome-ignore lint/style/noNonNullAssertion: checked above
        updateItemProperty(DCT.uri('description').value, { oldValue: '', newValue: 'Glucose' }, object!)
        editor.undo()
        await settle()
        const rdf = await diagram.rdf()
        expect(element(listElements(diagram), STORE_S).species).toBe('S')
        expect(rdf).toContain('Glucose')
        editor.redo()
        await settle()
        expect(element(listElements(diagram), STORE_S).species).toBe('Glc')
        expect(await diagram.rdf()).toContain('Glucose')
    })

    test('of an unchanged value keeps what redo can reapply', async () => {
        const diagram = await openFixture('enzyme.celldl')
        await setElements(editor, diagram, [{ id: STORE_S, field: 'species', value: 'Glc' }])
        const after = await diagram.rdf()
        editor.undo()
        await settle()
        await setElements(editor, diagram, [{ id: STORE_S, field: 'species', value: 'S' }])
        editor.redo()
        await settle()
        expect(await diagram.rdf()).toBe(after)
    })

    test('reports a species that can\'t be typeset, and leaves the RDF unchanged', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const before = await diagram.rdf()
        const edits = countEdits()
        const result = await setElements(editor, diagram, [{ id: STORE_S, field: 'species', value: '{' }])
        edits.stop()
        expect(result.ok).toBe(false)
        expect(result.errors).toHaveLength(1)
        expect(result.errors?.[0]).toMatchObject({ id: STORE_S, field: 'species' })
        expect(await diagram.rdf()).toBe(before)
        expect(edits.count).toBe(0)
    })

    test('refuses a species that starts with a number, and leaves the RDF unchanged', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const before = await diagram.rdf()
        for (const value of ['3X', '13BPG', '2 A']) {
            const result = await setElements(editor, diagram, [{ id: STORE_S, field: 'species', value }])
            expect(result.ok).toBe(false)
            expect(result.errors?.[0]).toMatchObject({ id: STORE_S, field: 'species' })
            expect(result.errors?.[0]?.message).toMatch(/^A species name can't start with a number/)
        }
        expect(await diagram.rdf()).toBe(before)
        // digits later in a name are fine
        expect((await setElements(editor, diagram, [{ id: STORE_S, field: 'species', value: 'G6P' }])).ok).toBe(true)
        expect(element(listElements(diagram), STORE_S).species).toBe('G6P')
    })

    test('the Properties panel refuses a species that starts with a number', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const messages: EditorMessage[] = []
        editor.setMessageHandler(message => messages.push(message))
        try {
            await panelEdit(diagram, STORE_S, 'bg-element-properties/bg-element-species', 'S', '3X')
        } finally {
            editor.setMessageHandler(null)
        }
        expect(element(listElements(diagram), STORE_S).species).toBe('S')
        expect(messages.some(m => m.level === 'error' && /can't start with a number/.test(m.text))).toBe(true)
    })

    test('skips a bad edit but makes the others', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const result = await setElements(editor, diagram, [
            { id: STORE_S, field: 'parameter:K', value: 'lots' },
            { id: STORE_S, field: 'parameter:nope', value: '1' },
            { id: 'ID-99999999', field: 'species', value: 'X' },
            { id: STORE_S, field: 'type', value: `${BGF}ChemicalReaction` },
            { id: STORE_S, field: 'location', value: 'cyt' }
        ])
        expect(result.ok).toBe(false)
        expect(result.errors?.map(e => e.field)).toEqual(['species', 'parameter:K', 'parameter:nope', 'type'])
        const store = element(listElements(diagram), STORE_S)
        expect(store.location).toBe('cyt')
        expect(store.parameters[0]?.value).toBe('1')
        expect(store.template).toBe(`${BGF}ChemicalConcentration`)
    })

    test('of an unchanged value reports no edit and adds no undo step', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const before = await diagram.rdf()
        const edits = countEdits()
        const result = await setElements(editor, diagram, [
            { id: STORE_S, field: 'species', value: 'S' },
            { id: STORE_S, field: 'parameter:K', value: '1.0' },
            { id: STORE_S, field: 'value', value: '1' },
            { id: STORE_S, field: 'type', value: `${BGF}ChemicalConcentration` }
        ])
        edits.stop()
        expect(result).toEqual({ ok: true })
        expect(edits.count).toBe(0)
        expect(await diagram.rdf()).toBe(before)
        // Nothing to undo
        await setElements(editor, diagram, [{ id: STORE_S, field: 'species', value: 'Glc' }])
        editor.undo()
        await settle()
        expect(await diagram.rdf()).toBe(before)
        editor.undo()
        await settle()
        expect(await diagram.rdf()).toBe(before)
    })

    test('reports one edit for several fields', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const edits = countEdits()
        await setElements(editor, diagram, [
            { id: STORE_S, field: 'species', value: 'Glc' },
            { id: JUNCTION_S, field: 'species', value: 'Glc' }
        ])
        edits.stop()
        expect(edits.count).toBe(1)
    })
})

//==============================================================================

describe('select', () => {
    test('selects just the element, with select and unselect events', async () => {
        await openFixture('enzyme.celldl')
        expect(editor.selectObjectById(STORE_S)).toBe(true)
        expect(viewerEvents).toEqual([{ type: 'select', component: { id: STORE_S } }])
        viewerEvents.length = 0
        expect(editor.selectObjectById(STORE_E)).toBe(true)
        expect(viewerEvents).toEqual([
            { type: 'unselect', component: { id: STORE_S } },
            { type: 'select', component: { id: STORE_E } }
        ])
        viewerEvents.length = 0
        expect(editor.selectObjectById(null)).toBe(true)
        expect(viewerEvents).toEqual([{ type: 'unselect', component: { id: STORE_E } }])
    })

    test('carries the host\'s elementInfo for the element', async () => {
        await openFixture('enzyme.celldl')
        editor.setElementInfo({ [STORE_S]: { tooltip: 'q_S', primary: 'q_S' } }, { tooltip: 'tooltip' })
        expect(editor.selectObjectById(STORE_S)).toBe(true)
        expect(viewerEvents).toEqual([{ type: 'select', component: { id: STORE_S, info: { tooltip: 'q_S', primary: 'q_S' } } }])
        editor.selectObjectById(null)
        editor.setElementInfo(undefined, undefined)
    })

    test('reports an unknown id', async () => {
        await openFixture('enzyme.celldl')
        expect(editor.selectObjectById('ID-99999999')).toBe(false)
        expect(viewerEvents).toEqual([])
    })

    test('pans to centre the element, without zooming', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const svg = diagram.svgDiagram
        const viewBox = () => svg.getAttribute('viewBox')?.split(' ').map(Number) as number[]
        const centroid = diagram.objectById(STORE_S)?.celldlSvgElement?.centroid
        expect(Number.isFinite(centroid?.x)).toBe(true)
        const cx = centroid?.x as number
        const cy = centroid?.y as number

        // In view, so 'if-hidden' doesn't pan
        svg.setAttribute('viewBox', `${cx - 100} ${cy - 50} 400 300`)
        editor.selectObjectById(STORE_S, 'if-hidden')
        expect(viewBox()).toEqual([cx - 100, cy - 50, 400, 300])

        // Out of view, so it does
        svg.setAttribute('viewBox', `${cx + 1000} ${cy + 1000} 400 300`)
        editor.selectObjectById(STORE_S, 'if-hidden')
        expect(viewBox()).toEqual([cx - 200, cy - 150, 400, 300])

        // `true` always pans, and `false` never does
        svg.setAttribute('viewBox', `${cx - 100} ${cy - 50} 400 300`)
        editor.selectObjectById(STORE_S, false)
        expect(viewBox()).toEqual([cx - 100, cy - 50, 400, 300])
        editor.selectObjectById(STORE_S, true)
        expect(viewBox()).toEqual([cx - 200, cy - 150, 400, 300])
    })
})

//==============================================================================
//==============================================================================

//==============================================================================

describe('species starting with a number', () => {
    test('a diagram that has them opens, unchanged, with a warning', async () => {
        const text = fixture('enzyme.celldl').replaceAll('bgf:hasSpecies "S"', 'bgf:hasSpecies "3PG"')
        const messages: EditorMessage[] = []
        editor.setMessageHandler(message => messages.push(message))
        const diagram = new CellDLDiagram('digits.celldl', text, editor)
        try {
            await editor.editDiagram(diagram)
        } finally {
            editor.setMessageHandler(null)
        }
        expect(element(listElements(diagram), STORE_S).species).toBe('3PG')
        expect(leadingDigitSpeciesWarning()).toMatch(/can't start with a number.*'3PG'/)
        expect(messages.some(m => m.level === 'warn' && /'3PG'/.test(m.text))).toBe(true)
    })

    test('a diagram without them has no warning', async () => {
        await openFixture('enzyme.celldl')
        expect(leadingDigitSpeciesWarning()).toBe('')
    })
})
