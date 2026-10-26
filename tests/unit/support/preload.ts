// Lets `bun test` load modules written for Vite: `import.meta.glob(..., { query: '?raw', eager: true })`
// becomes an object of the matching files' text.

import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { plugin } from 'bun'

import { initialise } from '@celldl/rdf'

// Oxigraph loads its WebAssembly with the runtime's own `fetch`, so before happy-dom replaces it
await initialise()

// The editor's modules touch `document` and `window` when they load
GlobalRegistrator.register({ url: 'http://localhost/' })

const ROOT = join(import.meta.dir, '../../..')

plugin({
    name: 'vite-import-meta-glob',
    setup(build) {
        build.onLoad({ filter: /bgrdf-sources\.ts$/ }, async (args) => {
            const source = readFileSync(args.path, 'utf8')
            const contents = source.replace(/import\.meta\.glob\('#root\/([^']+)'[^)]*\)/g, (_match, pattern: string) => {
                const glob = new Bun.Glob(pattern)
                const files: Record<string, string> = {}
                for (const file of glob.scanSync({ cwd: join(ROOT, 'src') })) {
                    files[`/src/${relative('.', file)}`] = readFileSync(join(ROOT, 'src', file), 'utf8')
                }
                return JSON.stringify(files)
            })
            return { contents, loader: 'ts' }
        })
    }
})

// happy-dom's XML parser drops CDATA sections, which hold a CellDL file's RDF, so put them back

const parseFromString = DOMParser.prototype.parseFromString
DOMParser.prototype.parseFromString = function (text: string, type: DOMParserSupportedType) {
    const sections: string[] = []
    const marked = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_match, data: string) => {
        sections.push(data)
        return `<cdata-section-marker data-index="${sections.length - 1}"/>`
    })
    const document = parseFromString.call(this, marked, type)
    for (const marker of [...document.querySelectorAll('cdata-section-marker')]) {
        const index = Number(marker.getAttribute('data-index'))
        // happy-dom has no CDATASection, so use a text node named as one
        const section = document.createTextNode(sections[index] as string)
        Object.defineProperty(section, 'nodeName', { value: '#cdata-section' })
        marker.replaceWith(section)
    }
    return document
}
