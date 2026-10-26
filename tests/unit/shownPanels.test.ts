// The right-hand panels a host's `chrome.panels` shows (src/components/toolbar/shownPanels.ts): Variables and
// Annotations only when listed.

import { describe, expect, test } from 'bun:test'

import { isShownPanel } from '#root/components/toolbar/shownPanels'
import { PANEL_ID } from '#root/utils/editor-types'

const ALL = [PANEL_ID.PROPERTIES_PANEL, PANEL_ID.METADATA_PANEL, PANEL_ID.STYLE_PANEL, PANEL_ID.REACTIONS_PANEL,
             PANEL_ID.VARIABLES_PANEL, PANEL_ID.ANNOTATIONS_PANEL]

const shown = (panels: Parameters<typeof isShownPanel>[1]) => ALL.filter(id => isShownPanel(id, panels))

describe('shown panels', () => {
    test('by default, Properties, Metadata, Style and Reactions', () => {
        const defaults = [PANEL_ID.PROPERTIES_PANEL, PANEL_ID.METADATA_PANEL, PANEL_ID.STYLE_PANEL, PANEL_ID.REACTIONS_PANEL]
        expect(shown(undefined)).toEqual(defaults)
        expect(shown(true)).toEqual(defaults)
    })

    test('Variables and Annotations when listed', () => {
        expect(shown(['variables', 'annotations'])).toEqual([PANEL_ID.VARIABLES_PANEL, PANEL_ID.ANNOTATIONS_PANEL])
        expect(shown(['properties', 'metadata', 'style', 'reactions', 'variables', 'annotations'])).toEqual(ALL)
    })

    test('none when `false`', () => {
        expect(shown(false)).toEqual([])
    })
})
