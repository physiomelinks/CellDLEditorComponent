/** biome-ignore-all lint/style/noNonNullAssertion: what a test adds is there */

import { describe, expect, test } from 'bun:test'

import { countEdits, editor, openFixture, settle } from './support/editor'

import type { CellDLObject } from '#editor/celldlObjects'
import { addReaction, applyEquation } from '#editor/editor/reactions'
import { componentLibraryPlugin } from '#root/plugins'
import { equationText } from '#root/plugins/bondgraph/equations'

//==============================================================================

const BGF = 'https://bg-rdf.org/ontologies/bondgraph-framework#'

// Where added elements are drawn is checked in the browser (scripts/check-reactions.ts)

// In the enzyme fixture, drawn with side 1-junctions and species 0-junctions
const REACTION_1 = 'file://enzyme.celldl#ID-00000006'
const REACTION_2 = 'file://enzyme.celldl#ID-00000011'
const S_TO_SIDE = 'ID-00000016'         // S's 0-junction to r1's reactants' 1-junction
const E_TO_SIDE = 'ID-00000017'         // E's 0-junction to r1's reactants' 1-junction

function equations(): Record<string, string> {
    return Object.fromEntries(componentLibraryPlugin.reactionEquations().map(eq => [eq.id, equationText(eq)]))
}

function values(object: CellDLObject, predicate: string): string[] {
    return object.rdfStore.query(`SELECT ?o WHERE { ${object.uri.toString()} <${predicate}> ?o }`)
                          .map(r => r.get('o')?.value ?? '')
}

function parameters(object: CellDLObject): Record<string, string> {
    return Object.fromEntries(object.rdfStore.query(`
        SELECT ?name ?value WHERE { ${object.uri.toString()} <${BGF}parameterValue> [ <${BGF}varName> ?name ; <${BGF}hasValue> ?value ] }`)
        .map(r => [r.get('name')?.value, r.get('value')?.value]))
}

/** The diagram's element whose species is `species`. */
function elementOf(species: string): CellDLObject|undefined {
    const diagram = editor.celldlDiagram!
    return [...diagram.svgDiagram.querySelectorAll('g.celldl-Component')]
        .map(e => diagram.objectById(e.id))
        .find(o => o && values(o, `${BGF}hasSpecies`).includes(species)) ?? undefined
}

function bondCount(id: string): string|undefined {
    const diagram = editor.celldlDiagram!
    return diagram.rdfStore.query(`SELECT ?count WHERE { <${diagram.makeUri(id).value}> <${BGF}bondCount> ?count }`)[0]
                  ?.get('count')?.value
}

//==============================================================================

describe('the Reactions panel\'s equations', () => {
    test('read a reaction drawn with side junctions through them', async () => {
        await openFixture('enzyme.celldl')
        expect(equations()).toEqual({
            [REACTION_1]: 'S[c] + E[c] ⇌ C[c]',
            [REACTION_2]: 'C[c] ⇌ P[c] + E[c]'
        })
    })

    test('a coefficient sets the count of its species\' bond, as one undo step that reports the change', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const before = await diagram.rdf()
        const edits = countEdits()
        expect(await applyEquation(REACTION_1, '2 S[c] + E[c] ⇌ C[c]')).toBe(1)
        edits.stop()
        expect(edits.count).toBeGreaterThan(0)
        expect(bondCount(S_TO_SIDE)).toBe('2')
        expect(equations()[REACTION_1]).toBe('2 S[c] + E[c] ⇌ C[c]')
        const after = await diagram.rdf()

        editor.undo()
        await settle()
        expect(await diagram.rdf()).toBe(before)
        expect(bondCount(S_TO_SIDE)).toBeUndefined()
        editor.redo()
        await settle()
        expect(await diagram.rdf()).toBe(after)
    })

    test('a removed species takes its bond away, and undo puts it back', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const before = await diagram.rdf()
        await applyEquation(REACTION_1, 'S[c] ⇌ C[c]')
        expect(diagram.objectById(E_TO_SIDE)).toBeNull()
        expect(equations()[REACTION_1]).toBe('S[c] ⇌ C[c]')
        editor.undo()
        await settle()
        expect(diagram.objectById(E_TO_SIDE)).not.toBeNull()
        expect(await diagram.rdf()).toBe(before)
        expect(equations()[REACTION_1]).toBe('S[c] + E[c] ⇌ C[c]')
    })

    test('an added term\'s new store has its template, a K of 1 and an initial value of 0, undone as one step', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const before = await diagram.rdf()
        await applyEquation(REACTION_1, 'S[c] + E[c] + X[c] ⇌ C[c]')
        const store = elementOf('X')!
        expect(store).toBeDefined()
        expect(values(store, 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type')).toContain(`${BGF}ChemicalStorageNode`)
        expect(values(store, `${BGF}hasLocation`)).toEqual(['c'])
        expect(parameters(store)).toEqual({ K: '1 mol-1' })
        expect(values(store, `${BGF}hasValue`)).toEqual(['0 mol'])
        expect(equations()[REACTION_1]).toBe('S[c] + E[c] + X[c] ⇌ C[c]')
        editor.undo()
        await settle()
        expect(await diagram.rdf()).toBe(before)
    })

    test('a new reaction gets an unused name, the most used location and a kappa of 1', async () => {
        const diagram = await openFixture('enzyme.celldl')
        diagram.rdfStore.update(`
            DELETE { ?n <${BGF}hasLocation> "c" } INSERT { ?n <${BGF}hasLocation> "cyt" }
            WHERE { ?n <${BGF}hasLocation> "c" }`)
        await addReaction('X <=> Y', '')
        const reaction = elementOf('R1')!
        expect(reaction).toBeDefined()
        expect(values(reaction, `${BGF}hasLocation`)).toEqual(['cyt'])
        expect(parameters(reaction)).toEqual({ kappa: '1 mol/s' })
        for (const species of ['X', 'Y']) {
            const store = elementOf(species)!
            expect(values(store, `${BGF}hasLocation`)).toEqual(['cyt'])
            expect(parameters(store)).toEqual({ K: '1 mol-1' })
            expect(values(store, `${BGF}hasValue`)).toEqual(['0 mol'])
        }
    })
})
