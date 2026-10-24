/** biome-ignore-all lint/style/noNonNullAssertion: the fixture's objects are there */

// Style panel edits are undo steps: each restores the exact previous style, and a drag is one step

import { describe, expect, test } from 'bun:test'

import { editor, openFixture, settle } from './support/editor'

import type { CellDLObject } from '#editor/celldlObjects'
import type { CellDLDiagram } from '#editor/diagram'
import { undoRedoState } from '#editor/diagram/undoredo'
import { Bounds } from '#editor/geometry'
import { componentLibraryPlugin } from '#root/plugins'
import { setElements } from '#root/plugins/bondgraph/elements'

//==============================================================================

// In the enzyme fixture
const STORE_S = 'ID-00000001'
const BOND = 'ID-00000015'

async function undo() {
    editor.undo()
    await settle()
}

async function redo() {
    editor.redo()
    await settle()
}

/** Makes an edit and undoes it, so there is something to redo */
async function editAndUndo(diagram: CellDLDiagram) {
    await setElements(editor, diagram, [{ id: STORE_S, field: 'species', value: 'Glc' }])
    await undo()
    expect(undoRedoState.canRedo).toBe(true)
}

/** Counts the undo steps, by undoing them all and redoing them again */
async function countSteps(): Promise<number> {
    let steps = 0
    while (undoRedoState.canUndo) {
        await undo()
        steps += 1
    }
    for (let n = 0; n < steps; n += 1) {
        await redo()
    }
    return steps
}

/** What is saved: the diagram's SVG, with its definitions, and its RDF (`serialise()` needs CDATA, which happy-dom lacks) */
async function saved(diagram: CellDLDiagram): Promise<string> {
    const svg = diagram.svgDiagram!.cloneNode(true) as SVGSVGElement
    for (const element of Array.from(svg.getElementsByClassName('editor-specific'))) {
        element.remove()
    }
    // happy-dom measures elements loosely, so a redrawn element moves its bonds' ends;
    // a browser doesn't, and the Playwright check compares the whole saved diagram
    const html = svg.outerHTML.replace(/(<path class="celldl-Connection[^>]*?) d="[^"]*"/g, '$1')
    return `${html}\n${await diagram.rdf()}`
}

function styling(object: CellDLObject) {
    return componentLibraryPlugin.componentStyling(object)
}

//==============================================================================

describe('a style edit', () => {
    test('of an element\'s fill is undone to the exact saved diagram, and redone', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const object = diagram.objectById(STORE_S)!
        const start = await saved(diagram)
        const before = styling(object)
        expect(await editor.editStyling(object, { fillStyle: '#ff0000' })).toBe(true)
        const edited = await saved(diagram)
        expect(edited).not.toBe(start)
        expect(styling(object).fillStyle).toBe('#ff0000')

        await undo()
        expect(styling(object)).toEqual(before)
        expect(await saved(diagram)).toBe(start)
        expect(undoRedoState.canRedo).toBe(true)

        await redo()
        expect(styling(object).fillStyle).toBe('#ff0000')
        expect(await saved(diagram)).toBe(edited)
    })

    test('of a bond\'s path is undone to the exact saved diagram, and redone', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const bond = diagram.objectById(BOND)!
        const start = await saved(diagram)
        expect(await editor.editStyling(bond, { pathStyle: '#00ff00,4,1,3' })).toBe(true)
        const edited = await saved(diagram)
        expect(edited).not.toBe(start)
        await undo()
        expect(await saved(diagram)).toBe(start)
        await redo()
        expect(await saved(diagram)).toBe(edited)
    })

    test('of a compartment\'s fill, gap, corners and path are each a step, undone in turn', async () => {
        const diagram = await openFixture('enzyme.celldl')
        // happy-dom's SVG elements made in code don't measure themselves
        const proto = Element.prototype as unknown as { getBBox?: () => DOMRect }
        const hadBBox = Object.hasOwn(proto, 'getBBox')
        proto.getBBox ??= () => new DOMRect(-200, -300, 150, 150)
        const compartment = diagram.makeCompartment(new Bounds(-200, -300, -50, -150))
        if (!hadBBox) {
            delete proto.getBBox
        }
        await settle()
        const start = await saved(diagram)
        const steps = await countSteps()
        const edits = [
            { fillStyle: 'V,#ff0000,#0000ff' },
            { gapStyle: '4' },
            { cornerStyle: '12' },
            { pathStyle: '#123456,3,1,2' }
        ]
        const after: string[] = []
        for (const edit of edits) {
            expect(await editor.editStyling(compartment, edit)).toBe(true)
            after.push(await saved(diagram))
        }
        expect(await countSteps()).toBe(steps + edits.length)
        for (let n = edits.length - 2; n >= 0; n -= 1) {
            await undo()
            expect(await saved(diagram)).toBe(after[n]!)
        }
        await undo()
        expect(await saved(diagram)).toBe(start)
        for (const state of after) {
            await redo()
            expect(await saved(diagram)).toBe(state)
        }
    })

    test('that changes nothing records no step and keeps redo', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const object = diagram.objectById(STORE_S)!
        await editAndUndo(diagram)
        const undoable = undoRedoState.canUndo
        expect(await editor.editStyling(object, { fillStyle: styling(object).fillStyle! })).toBe(false)
        expect(undoRedoState.canRedo).toBe(true)
        expect(undoRedoState.canUndo).toBe(undoable)
    })

    test('made live, as a colour picker is dragged, is one step once committed', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const object = diagram.objectById(STORE_S)!
        const start = await saved(diagram)
        const steps = await countSteps()
        for (const colour of ['#110000', '#220000', '#330000', '#440000']) {
            await editor.editStyling(object, { fillStyle: colour }, true)
        }
        await editor.editStyling(object, { fillStyle: '#440000' })
        expect(await countSteps()).toBe(steps + 1)

        // A second pick is a step of its own
        await editor.editStyling(object, { fillStyle: '#550000' }, true)
        await editor.editStyling(object, { fillStyle: '#550000' })
        expect(await countSteps()).toBe(steps + 2)

        await undo()
        expect(styling(object).fillStyle).toBe('#440000')
        await undo()
        expect(await saved(diagram)).toBe(start)
    })

    test('dragged back to where it started records no step', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const object = diagram.objectById(STORE_S)!
        const start = styling(object).fillStyle!
        const steps = await countSteps()
        await editor.editStyling(object, { fillStyle: '#123123' }, true)
        await editor.editStyling(object, { fillStyle: start }, true)
        expect(await editor.editStyling(object, { fillStyle: start })).toBe(false)
        expect(await countSteps()).toBe(steps)
    })

    test('of a different field or object is a step of its own, even while live', async () => {
        const diagram = await openFixture('enzyme.celldl')
        const object = diagram.objectById(STORE_S)!
        const bond = diagram.objectById(BOND)!
        const steps = await countSteps()
        await editor.editStyling(object, { fillStyle: '#123123' }, true)
        await editor.editStyling(bond, { pathStyle: '#00ff00,4,1,3' }, true)
        expect(await countSteps()).toBe(steps + 2)
    })
})
