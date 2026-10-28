/** biome-ignore-all lint/style/noNonNullAssertion: the container and menu state are there */


// With `chrome.grouping` off (src/CellDL/editor/grouping.ts), the context menu has no Group, Edit group or Ungroup,
// and the editor never enables them. On, the default, the menu is as before.

import { afterEach, describe, expect, test } from 'bun:test'

import { editor, openFixture } from './support/editor'

import { CONTEXT_MENU } from '#editor/editor'
import { setGrouping } from '#editor/editor/grouping'
import { contextMenuEntries } from '#root/components/widgets/contextMenuEntries'

const GROUP_LABELS = ['Group', 'Edit group', 'Ungroup']

const labels = (grouping: boolean, state = new Set([CONTEXT_MENU.DELETE, CONTEXT_MENU.GROUP_OBJECTS])) =>
    contextMenuEntries(state, grouping).map(entry => ('label' in entry ? entry.label : '-'))

afterEach(() => setGrouping(true))

describe('grouping', () => {
    test('the menu lists Group, Edit group and Ungroup by default', () => {
        expect(labels(true)).toEqual(['Delete', '-', ...GROUP_LABELS, '-', 'Info'])
    })

    test('the menu has no grouping entries, nor a doubled separator, when grouping is off', () => {
        expect(labels(false)).toEqual(['Delete', '-', 'Info'])
        expect(labels(false, new Set([CONTEXT_MENU.ADD_ELEMENT]))).toEqual(['Add element…', '-', 'Delete', '-', 'Info'])
    })

    test('the editor never enables a grouping item when grouping is off', async () => {
        await openFixture('enzyme.celldl')
        let state: Set<CONTEXT_MENU> | undefined
        const listener = (event: Event) => { state = (event as CustomEvent).detail.state }
        document.addEventListener('open-context-menu', listener)
        try {
            setGrouping(false)
            editor.enableContextMenuItem(CONTEXT_MENU.GROUP_OBJECTS)
            editor.enableContextMenuItem(CONTEXT_MENU.UNGROUP_OBJECTS)
            document.getElementById('svg-container')!.dispatchEvent(
                new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
            expect(state).toBeDefined()
            expect(state!.has(CONTEXT_MENU.GROUP_OBJECTS)).toBe(false)
            expect(state!.has(CONTEXT_MENU.UNGROUP_OBJECTS)).toBe(false)

            setGrouping(true)
            editor.enableContextMenuItem(CONTEXT_MENU.GROUP_OBJECTS)
            expect(state!.has(CONTEXT_MENU.GROUP_OBJECTS)).toBe(true)
        } finally {
            editor.enableContextMenuItem(CONTEXT_MENU.GROUP_OBJECTS, false)
            document.removeEventListener('open-context-menu', listener)
        }
    })
})
