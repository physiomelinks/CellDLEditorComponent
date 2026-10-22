/** biome-ignore-all lint/style/noNonNullAssertion: what a test places is there */

import { describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'

import { editor, openFixture, settle } from './support/editor'

import type { CellDLConnectedObject, CellDLConnection, CellDLObject } from '#editor/celldlObjects'
import type { CellDLDiagram } from '#editor/diagram'
import { notifyChanges } from '#editor/editor'
import { addBond } from '#editor/editor/placing'
import { sideLabels } from '#editor/editor/sidelabels'
import { componentLibraryPlugin } from '#root/plugins'
import { equationText } from '#root/plugins/bondgraph/equations'
import { paletteEntries, placeEntry, searchEntries, SIDE_OFFSET } from '#root/plugins/bondgraph/palette'

//==============================================================================

const BGF = 'https://bg-rdf.org/ontologies/bondgraph-framework#'

// The headless editor can't start an empty diagram, so elements are added to the enzyme fixture (species S, E, C, P,
// r1 and r2, all in c)
const diagramWithElements = () => openFixture('enzyme.celldl')

function values(object: CellDLObject, predicate: string): string[] {
    return object.rdfStore.query(`SELECT ?o WHERE { ${object.uri.toString()} <${predicate}> ?o }`)
                          .map(r => r.get('o')!.value)
}

function parameters(object: CellDLObject): Record<string, string> {
    return Object.fromEntries(object.rdfStore.query(`
        SELECT ?name ?value WHERE { ${object.uri.toString()} <${BGF}parameterValue> [ <${BGF}varName> ?name ; <${BGF}hasValue> ?value ] }`)
        .map(r => [r.get('name')!.value, r.get('value')!.value]))
}

function components(diagram: CellDLDiagram): number {
    return diagram.svgDiagram.querySelectorAll('g.celldl-Component').length
}

function connections(diagram: CellDLDiagram): number {
    return diagram.svgDiagram.querySelectorAll('.celldl-Connection').length
}

//==============================================================================

describe('the palette\'s entries', () => {
    test('have unique ids, labels and names, with no IRIs', () => {
        const entries = paletteEntries('all')
        for (const key of ['id', 'label', 'name'] as const) {
            const texts = entries.map(e => e[key].toLowerCase())
            expect(new Set(texts).size).toBe(texts.length)
        }
        for (const entry of entries) {
            expect(`${entry.label} ${entry.name}`).not.toMatch(/https?:|bgf:|#/)
            expect(entry.imageData).toStartWith('data:image/svg+xml')
        }
    })

    test('the chemical filter lists exactly the 8 chemical entries, and All domains adds the rest', () => {
        expect(paletteEntries('chemical').map(e => e.label)).toEqual([
            'Species', 'Store', 'Chemostat', 'Flux source', '0-junction', '1-junction', 'Reaction node',
            'Reaction with sides'
        ])
        const all = paletteEntries('all')
        expect(all.length).toBeGreaterThan(8)
        expect(all.slice(0, 8)).toEqual(paletteEntries('chemical'))
        expect(all.filter(e => e.label.startsWith('Zero storage node')).map(e => e.label))
            .toEqual(['Zero storage node (q)', 'Zero storage node (u)'])
    })

    test('search by label first, then by name', () => {
        expect(searchEntries('react', 'chemical').map(e => e.label)).toEqual(['Reaction node', 'Reaction with sides'])
        expect(searchEntries('potential', 'chemical').map(e => e.label)).toEqual(['Chemostat', '0-junction'])
        expect(searchEntries('', 'chemical')).toHaveLength(8)
    })

    test('each chemical entry\'s element template has a readable name for Properties, not an IRI', () => {
        const plugin = componentLibraryPlugin.getPlugin('bondgraph-components') as unknown as {
            getTemplateName(type: string): string|undefined
        }
        const names = paletteEntries('chemical').filter(e => e.elementType).map(e => plugin.getTemplateName(e.elementType!))
        for (const name of names) {
            expect(name).toBeTruthy()
            expect(name).not.toMatch(/https?:|bgf:|#/)
        }
        expect(plugin.getTemplateName(`${BGF}ChemicalPotential`)).toBe('Chemical potential')
        expect(plugin.getTemplateName(`${BGF}ChemicalFlow`)).toBe('Chemical flow')
    })
})

describe('placing a palette entry', () => {
    test('gives every chemical element its type, a new species name and stored parameters of 1', async () => {
        const diagram = await diagramWithElements()
        const existing = components(diagram)
        const expected: Record<string, string|undefined> = {
            'chemical/species': `${BGF}ChemicalStorageNode`,
            'chemical/store': `${BGF}ChemicalConcentration`,
            'chemical/chemostat': `${BGF}ChemicalPotential`,
            'chemical/flux-source': `${BGF}ChemicalFlow`,
            'chemical/zero-junction': `${BGF}ZeroNode`,
            'chemical/one-junction': `${BGF}OneNode`,
            'chemical/reaction-node': `${BGF}ChemicalReactionNode`,
            'chemical/reaction-sides': `${BGF}ChemicalReaction`
        }
        const species: string[] = []
        let x = 0
        for (const entry of paletteEntries('chemical')) {
            x += 200
            const [main] = await placeEntry(entry.id, { x, y: 100 })
            expect(main).toBeDefined()
            expect(values(main!, 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type')).toContain(expected[entry.id]!)
            expect(values(main!, `${BGF}hasLocation`)).toEqual(['c'])
            species.push(...values(main!, `${BGF}hasSpecies`))
            for (const value of Object.values(parameters(main!))) {
                expect(value).toStartWith('1 ')
            }
            const centroid = main!.celldlSvgElement!.centroid
            expect(Math.abs(centroid.x - x)).toBeLessThan(1)
            expect(Math.abs(centroid.y - 100)).toBeLessThan(1)
        }
        expect(species).toEqual(['S1', 'S2', 'S3', 'S4', 'J1', 'J2', 'R1', 'R2'])
        const store = diagram.objectById(diagram.svgDiagram.querySelectorAll('g.celldl-Component')[existing + 1]!.id)!
        expect(parameters(store)).toEqual({ K: '1 mol-1' })
        expect(values(store, `${BGF}hasValue`)).toEqual(['0 mol'])
        const reaction = [...diagram.svgDiagram.querySelectorAll('g.celldl-Component')]
            .map(e => diagram.objectById(e.id)!).find(o => values(o, `${BGF}hasSpecies`)[0] === 'R1')!
        expect(parameters(reaction)).toEqual({ kappa: '1 mol/s' })
    })

    test('uses the diagram\'s most used location', async () => {
        const diagram = await diagramWithElements()
        // all but one of the fixture's elements in `cyt`
        diagram.rdfStore.update(`
            DELETE { ?n <${BGF}hasLocation> "c" } INSERT { ?n <${BGF}hasLocation> "cyt" }
            WHERE { ?n <${BGF}hasLocation> "c" FILTER (?n != <${diagram.uri}#ID-00000001>) }`)
        const [store] = await placeEntry('chemical/store', { x: 0, y: 400 })
        expect(values(store!, `${BGF}hasLocation`)).toEqual(['cyt'])
    })

    test('a reaction with sides is a reaction between two labelled 1-junctions, undone as one step', async () => {
        const diagram = await diagramWithElements()
        const [existing, bonds] = [components(diagram), connections(diagram)]
        const before = await diagram.rdf()
        const placed = await placeEntry('chemical/reaction-sides', { x: 300, y: 200 })
        expect(components(diagram)).toBe(existing + 3)
        expect(connections(diagram)).toBe(bonds + 2)
        const [reaction, reactants, products, into, out] = placed as [CellDLObject, CellDLObject, CellDLObject,
                                                                      CellDLConnection, CellDLConnection]
        expect(values(reaction, `${BGF}hasSpecies`)).toEqual(['R1'])
        expect(values(reaction, `${BGF}hasSymbol`)).toEqual(['Rx'])
        expect(parameters(reaction)).toEqual({ kappa: '1 mol/s' })
        for (const [side, location, label, dx] of [[reactants, 'f', 'reactants', -SIDE_OFFSET],
                                                   [products, 'r', 'products', SIDE_OFFSET]] as const) {
            expect(values(side, 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type')).toContain(`${BGF}OneNode`)
            expect(values(side, `${BGF}hasSpecies`)).toEqual(['R1'])
            expect(values(side, `${BGF}hasLocation`)).toEqual([location])
            expect(values(side, 'http://www.w3.org/2000/01/rdf-schema#label')).toEqual([label])
            expect(side.celldlSvgElement!.centroid.x).toBeCloseTo(300 + dx, 0)
        }
        expect(values(into, `${BGF}hasSource`)).toEqual([reactants.uri.value])
        expect(values(into, `${BGF}hasTarget`)).toEqual([reaction.uri.value])
        expect(values(out, `${BGF}hasSource`)).toEqual([reaction.uri.value])
        expect(values(out, `${BGF}hasTarget`)).toEqual([products.uri.value])
        expect([...sideLabels(diagram).values()].sort()).toEqual(['products', 'reactants'])
        expect([...diagram.svgDiagram.querySelectorAll('text.side-label')].map(t => t.textContent).sort())
            .toEqual(['products', 'reactants'])

        editor.undo()
        await settle()
        expect(components(diagram)).toBe(existing)
        expect(connections(diagram)).toBe(bonds)
        expect(await diagram.rdf()).toBe(before)
        expect(diagram.svgDiagram.querySelectorAll('text.side-label')).toHaveLength(0)

        editor.redo()
        await settle()
        expect(components(diagram)).toBe(existing + 3)
        expect(connections(diagram)).toBe(bonds + 2)
        expect([...sideLabels(diagram).values()].sort()).toEqual(['products', 'reactants'])
    })
})

describe('the enzyme benchmark, built from the palette', () => {
    test('two reactions with sides and four species give its equations', async () => {
        const diagram = await diagramWithElements()
        // start from an empty diagram
        for (const element of [...diagram.svgDiagram.querySelectorAll('g.celldl-Component')]) {
            const object = diagram.objectById(element.id)
            if (object) diagram.removeObject(object)
        }
        expect(components(diagram)).toBe(0)
        expect(connections(diagram)).toBe(0)

        const place = async (id: string, x: number, y: number) => (await placeEntry(id, { x, y })) as CellDLConnectedObject[]
        const s = (await place('chemical/species', 0, 0))[0]!
        const e = (await place('chemical/species', 300, 200))[0]!
        const c = (await place('chemical/species', 450, 0))[0]!
        const p = (await place('chemical/species', 900, 0))[0]!
        const [, f1, r1] = await place('chemical/reaction-sides', 200, 0)
        const [, f2, r2] = await place('chemical/reaction-sides', 700, 0)
        for (const [source, target] of [[s, f1], [e, f1], [r1, c], [c, f2], [r2, p], [r2, e]]) {
            addBond(source!, target!)
        }
        notifyChanges()
        expect(componentLibraryPlugin.reactionEquations().map(eq => equationText(eq)).sort()).toEqual([
            'S1[c] + S2[c] ⇌ S3[c]',
            'S3[c] ⇌ S4[c] + S2[c]'
        ])
        const out = process.env.PALETTE_ENZYME_OUT
        // its RDF, for checking it converts with bg2cellml (the headless editor cannot serialise the SVG)
        if (out) writeFileSync(out, await diagram.rdf())
    })
})
