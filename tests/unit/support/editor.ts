// A headless editor, with the bond graph and drawing plugins, for opening CellDL files in `bun test`

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { CellDLDiagram } from '#editor/diagram'
import { CellDLEditor } from '#editor/editor'
import { componentLibraryPlugin } from '#root/plugins'
import { BondgraphPlugin } from '#root/plugins/bondgraph'
import { DrawingPlugin } from '#root/plugins/drawing'
import type { ViewerEvent } from '#root/utils/editor-types'

componentLibraryPlugin.registerPlugin(new BondgraphPlugin())
componentLibraryPlugin.registerPlugin(new DrawingPlugin())

const container = document.createElement('div')
container.id = 'svg-container'
document.body.appendChild(container)
for (const id of ['status-msg', 'status-pos']) {
    const span = document.createElement('span')
    span.id = id
    document.body.appendChild(span)
}

export const editor = new CellDLEditor()
editor.mount(container)

export const viewerEvents: ViewerEvent[] = []
editor.setViewerEventHandler(event => viewerEvents.push(event))

export function fixture(name: string): string {
    return readFileSync(join(import.meta.dir, '../fixtures', name), 'utf8')
}

/** Opens a fixture in the editor, as a host's `open` command does */
export async function openFixture(name: string): Promise<CellDLDiagram> {
    const diagram = new CellDLDiagram(name, fixture(name), editor)
    await editor.editDiagram(diagram)
    viewerEvents.length = 0
    return diagram
}

/** Counts the edits that the editor reports, as `diagram-changed` follows them */
export function countEdits(): { readonly count: number, stop: () => void } {
    let count = 0
    const listener = () => { count += 1 }
    document.addEventListener('file-edited', listener)
    return {
        get count() { return count },
        stop: () => document.removeEventListener('file-edited', listener)
    }
}

/** Lets pending promise callbacks, such as an undo's SVG refresh, run */
export async function settle() {
    for (let n = 0; n < 5; n += 1) {
        await new Promise(resolve => setTimeout(resolve, 0))
    }
}
