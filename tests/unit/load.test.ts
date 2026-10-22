import { describe, expect, test } from 'bun:test'

import { editor, fixture, openFixture } from './support/editor'

import { CellDLDiagram } from '#editor/diagram'

//==============================================================================

const PARAMETER_VALUE = 'https://bg-rdf.org/ontologies/bondgraph-framework#parameterValue'

function parameterValues(diagram: CellDLDiagram): number {
    return [...diagram.rdfStore.statements()].filter(s => s.predicate.value === PARAMETER_VALUE).length
}

//==============================================================================

describe('open', () => {
    test('leaves the store as the file has it', async () => {
        const diagram = new CellDLDiagram('enzyme.celldl', fixture('enzyme.celldl'), editor)
        const before = diagram.rdfStore.statements().length
        const parameters = parameterValues(diagram)
        expect(parameters).toBe(6)
        await editor.editDiagram(diagram)
        expect(parameterValues(diagram)).toBe(parameters)
        expect(diagram.rdfStore.statements().length).toBe(before)
    })

    test('writes each parameter value once', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const rdf = await diagram.rdf()
        // One `bgf:parameterValue [ ... ]` per parameter, with no second `], [` copy
        expect(rdf.match(/bgf:parameterValue \[/g)).toHaveLength(6)
        expect(rdf).not.toContain('], [')
    })
})
