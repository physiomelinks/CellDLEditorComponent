import { describe, expect, test } from 'bun:test'

import { bondgraphName, type NamingElement, variableNames } from '../../src/plugins/bondgraph/names'

const BGF = 'https://bg-rdf.org/ontologies/bondgraph-framework#'

const element = (identifier: string, label: string, variables: string[], extra: Partial<NamingElement> = {}): NamingElement =>
    ({ id: `m#${identifier}`, identifier, label, variables, ...extra })

describe('bg2cellml\'s variable names', () => {
    test('an element\'s variables take its symbol, species and location', () => {
        const q = element('q_B', 'q', ['v', 'u', 'q'], { species: 'B', location: 'c', intrinsic: 'q',
                                                          elementClass: `${BGF}QuantityStore` })
        const names = variableNames([q])
        expect(names.get('m#q_B|q')).toBe('q_B_c')
        expect(names.get('m#q_B|u')).toBe('u_q_B_c')
        expect(names.get('m#q_B|q')).toBe(bondgraphName(q, 'q'))
    })

    test('a later copy of a chemostat is named by its identifier (bgtool --list-variables: u_Se_A_c, u_Se_A_2)', () => {
        const copy = (identifier: string) => element(identifier, 'Se', ['v', 'u'], { species: 'A', location: 'c' })
        const names = variableNames([copy('Se_A_1'), copy('Se_A_2')])
        expect(names.get('m#Se_A_1|u')).toBe('u_Se_A_c')
        expect(names.get('m#Se_A_2|u')).toBe('u_Se_A_2')
    })

    test('reserved names are never given', () => {
        expect(variableNames([element('RT', '', ['RT'], { intrinsic: 'RT' })]).get('m#RT|RT')).toBe('RT_2')
    })
})
