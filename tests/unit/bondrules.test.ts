/** biome-ignore-all lint/style/noNonNullAssertion: fixtures' objects and bonds exist */

import { describe, expect, test } from 'bun:test'

import { editor, openFixture } from './support/editor'

import type { CellDLConnection, CellDLObject } from '#editor/celldlObjects'
import { componentLibraryPlugin } from '#root/plugins'
import { type BondgraphPlugin, PLUGIN_ID } from '#root/plugins/bondgraph'
import {
    BOND_RULE_MESSAGES as M,
    type BondEnd,
    type BondEndKind,
    type BondRuleContext,
    bondRule
} from '#root/plugins/bondgraph/bondrules'

//==============================================================================

let ids = 0

function end(kind: BondEndKind, ports?: { inward: number, outward: number }): BondEnd {
    ids += 1
    return ports ? { id: `n${ids}`, kind, ports } : { id: `n${ids}`, kind }
}

const NO_BONDS: BondRuleContext = { bonds: [] }

function result(source: BondEnd, target: BondEnd, ctx: BondRuleContext = NO_BONDS): string {
    const status = bondRule(source, target, ctx)
    return 'alert' in status ? status.alert : 'ok'
}

const reactionPorts = { inward: 1, outward: 1 }

//==============================================================================

describe('bond direction rules', () => {
    test.each([
        ['zero', 'storage', 'ok'],
        ['storage', 'zero', M.storeIsTarget],
        ['one', 'storage', 'ok'],
        ['source', 'zero', 'ok'],
        ['zero', 'source', M.sourceIsSource],
        ['zero', 'dissipator', 'ok'],
        ['dissipator', 'one', M.dissipatorIsTarget],
        ['zero', 'one', 'ok'],
        ['one', 'zero', 'ok'],
        ['composite', 'composite', 'ok'],
        ['zero', 'composite', 'ok'],
        ['composite', 'zero', 'ok'],
        ['other', 'other', 'ok']
    ] as [BondEndKind, BondEndKind, string][])('%s → %s: %s', (source, target, expected) => {
        expect(result(end(source), end(target))).toBe(expected)
    })

    test('a reaction with ports takes one bond into f and one out of r', () => {
        const reaction = end('reaction', reactionPorts)
        const reactants = end('one')
        const products = end('one')
        expect(result(reactants, reaction)).toBe('ok')
        expect(result(reaction, products)).toBe('ok')
        const withReactants = { bonds: [{ source: reactants, target: reaction }] }
        expect(result(end('one'), reaction, withReactants)).toBe(M.reactionHasReactants)
        expect(result(reaction, products, withReactants)).toBe('ok')
        const withProducts = { bonds: [{ source: reaction, target: products }] }
        expect(result(reaction, end('one'), withProducts)).toBe(M.reactionHasProducts)
        expect(result(reactants, reaction, withProducts)).toBe('ok')
    })

    test('a reaction with more ports takes a bond for each', () => {
        const nke = end('reaction', { inward: 2, outward: 2 })
        const a = end('one')
        const b = end('one')
        expect(result(b, nke, { bonds: [{ source: a, target: nke }] })).toBe('ok')
        expect(result(end('one'), nke, { bonds: [{ source: a, target: nke }, { source: b, target: nke }] }))
            .toBe(M.reactionHasReactants)
    })

    test('a reaction without ports is a bond\'s target', () => {
        const reaction = end('reaction')
        expect(result(end('one'), reaction)).toBe('ok')
        expect(result(reaction, end('one'))).toBe(M.dissipatorIsTarget)
    })

    test('a transform node has one bond in and one out', () => {
        const transform = end('transform')
        const a = end('zero')
        const b = end('zero')
        const inward = { bonds: [{ source: a, target: transform }] }
        expect(result(b, transform, inward)).toBe(M.transformHasInward)
        expect(result(transform, b, inward)).toBe('ok')
        const outward = { bonds: [{ source: transform, target: a }] }
        expect(result(transform, b, outward)).toBe(M.transformHasOutward)
        expect(result(b, transform, outward)).toBe('ok')
    })

    test('a reaction\'s sides keep their direction', () => {
        const reaction = end('reaction', reactionPorts)
        const reactants = end('one')
        const products = end('one')
        const species = end('zero')
        const sides = { bonds: [{ source: reactants, target: reaction }, { source: reaction, target: products }] }
        expect(result(species, reactants, sides)).toBe('ok')
        expect(result(reactants, species, sides)).toBe(M.reactantsSide)
        expect(result(products, species, sides)).toBe('ok')
        expect(result(species, products, sides)).toBe(M.productsSide)
    })

    test('a composite reaction node takes bonds either way', () => {
        const node = end('composite')
        const species = end('composite')
        expect(result(species, node)).toBe('ok')
        expect(result(node, species)).toBe('ok')
    })
})

//==============================================================================

function plugin(): BondgraphPlugin {
    return componentLibraryPlugin.getPlugin(PLUGIN_ID) as unknown as BondgraphPlugin
}

/** The direction rule's result for each of a diagram's bonds, given its other bonds */
function existingBondResults(): string[] {
    const diagram = editor.celldlDiagram!
    const bg = plugin()
    const results: string[] = []
    for (const bond of diagram.objects.filter(object => object.isConnection) as CellDLConnection[]) {
        const source = bond.source! as CellDLObject
        const target = bond.target! as CellDLObject
        const bonds = [...new Set([...source.connections, ...target.connections])]
            .filter(other => other !== bond)
            .map(other => ({ source: bg.bondEnd(other.source!), target: bg.bondEnd(other.target!) }))
        const status = bondRule(bg.bondEnd(source), bg.bondEnd(target), { bonds })
        results.push('alert' in status ? `${bond.id}: ${status.alert}` : 'ok')
    }
    return results
}

describe('the rules allow existing diagrams\' bonds', () => {
    test.each(['enzyme.celldl', 'rlc.celldl'])('%s', async (name) => {
        await openFixture(name)
        const results = existingBondResults()
        expect(results.length).toBeGreaterThan(0)
        expect(results.filter(r => r !== 'ok')).toEqual([])
    })

    test('the enzyme fixture\'s ends are typed from BG-RDF', async () => {
        await openFixture('enzyme.celldl')
        const diagram = editor.celldlDiagram!
        const kind = (id: string) => plugin().bondEnd(diagram.objectById(id)!)
        expect(kind('ID-00000001')).toEqual({ id: 'ID-00000001', kind: 'storage' })
        expect(kind('ID-00000002').kind).toBe('zero')
        expect(kind('ID-00000005').kind).toBe('one')
        expect(kind('ID-00000006')).toEqual({ id: 'ID-00000006', kind: 'reaction', ports: { inward: 1, outward: 1 } })
    })

    test('the bond graph plugin refuses a reversed store bond', async () => {
        await openFixture('enzyme.celldl')
        const diagram = editor.celldlDiagram!
        // S's store and P's 0-junction aren't bonded
        const store = diagram.objectById('ID-00000001')!
        const zero = diagram.objectById('ID-00000013')!
        expect(componentLibraryPlugin.checkConnectionValid(store, zero)?.alert).toBe(M.storeIsTarget)
        expect(componentLibraryPlugin.checkConnectionValid(zero, store)?.alert).toBeUndefined()
    })
})
