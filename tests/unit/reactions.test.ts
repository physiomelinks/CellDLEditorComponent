import { describe, expect, test } from 'bun:test'

import { countEdits, editor, openFixture, settle } from './support/editor'

import { applyEquation } from '#editor/editor/reactions'
import { componentLibraryPlugin } from '#root/plugins'
import { equationText } from '#root/plugins/bondgraph/equations'

//==============================================================================

const BGF = 'https://bg-rdf.org/ontologies/bondgraph-framework#'

// Adding elements is checked in the browser (scripts/check-reactions.ts), as the headless editor can't place them

// In the enzyme fixture, drawn with side 1-junctions and species 0-junctions
const REACTION_1 = 'file://enzyme.celldl#ID-00000006'
const REACTION_2 = 'file://enzyme.celldl#ID-00000011'
const S_TO_SIDE = 'ID-00000016'         // S's 0-junction to r1's reactants' 1-junction
const E_TO_SIDE = 'ID-00000017'         // E's 0-junction to r1's reactants' 1-junction

function equations(): Record<string, string> {
    return Object.fromEntries(componentLibraryPlugin.reactionEquations().map(eq => [eq.id, equationText(eq)]))
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


})
