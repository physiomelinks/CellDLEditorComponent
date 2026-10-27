// Draws BG-RDF Turtle models as editor-saved CellDL documents:
//
//     ./scripts/install-bgrdf.sh && bun scripts/import-bgrdf.ts OUTDIR MODEL.ttl...
//
// For each model, starts the editor app (Vite, headless Chrome driven over the DevTools protocol; CHROME, default
// google-chrome) on a new diagram, adds each of the model's bond elements, junctions and signal blocks as the
// palette does (addElement), then each power and signal bond (addBond, signal bonds with signal bonds chosen), and
// gives each the model's own properties in place of the editor's defaults (symbols, species, values, parameter
// values, a signal bond's input or modulation, ...), so the saved RDF is the model's; an element the model gives no
// symbol is given its identifier as its symbol, so bg2cellml names its variables as it does the model's. Power-bonded elements are laid
// out left to right along their bonds, and signal blocks in rows below, near what they are connected to. Writes
// OUTDIR/<model>.celldl.svg.

import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'
import { basename, join, resolve } from 'node:path'

import { initialise, RdfStore } from '@celldl/rdf'

const [outDir, ...models] = process.argv.slice(2)
if (!outDir || !models.length) {
    console.error('usage: bun scripts/import-bgrdf.ts OUTDIR MODEL.ttl...')
    process.exit(1)
}
mkdirSync(outDir, { recursive: true })

const BGF = 'https://bg-rdf.org/ontologies/bondgraph-framework#'
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string'
const BASE = 'https://example.org/model'

//==============================================================================

interface ModelElement {
    id: string                  // its fragment
    type: string
    isBlock: boolean
    triples: string             // its properties, as SPARQL data with SUBJECT for itself
    x: number
    y: number
}

interface ModelBond {
    id: string
    source: string
    target: string
    signal: boolean
    triples: string
}

// biome-ignore lint/suspicious/noExplicitAny: oxigraph terms
type Term = any

await initialise()

function readModel(path: string): { elements: ModelElement[], bonds: ModelBond[] } {
    const store = new RdfStore()
    store.load(BASE, readFileSync(path, 'utf8'))
    const statements = store.statements()
    const bySubject = new Map<string, { p: string, o: Term }[]>()
    for (const s of statements) {
        const key = s.subject.termType === 'BlankNode' ? `_:${s.subject.value}` : s.subject.value
        bySubject.set(key, [...(bySubject.get(key) ?? []), { p: s.predicate.value, o: s.object }])
    }
    const term = (o: Term): string => o.termType === 'NamedNode' ? `<${o.value}>`
        : o.termType === 'BlankNode' ? `_:n${o.value}`
        : `${JSON.stringify(o.value)}${o.language ? `@${o.language}` : (o.datatype && o.datatype.value !== XSD_STRING)
                                                                    ? `^^<${o.datatype.value}>` : ''}`
    // a subject's properties (and its blank nodes'), leaving out `skip`
    const data = (subject: string, skip: string[]): string => {
        const lines: string[] = []
        const visit = (s: string, name: string) => {
            for (const { p, o } of bySubject.get(s) ?? []) {
                if (name === 'SUBJECT' && skip.includes(p)) continue
                lines.push(`${name} <${p}> ${term(o)} .`)
                if (o.termType === 'BlankNode') visit(`_:${o.value}`, `_:n${o.value}`)
            }
        }
        visit(subject, 'SUBJECT')
        return lines.join('\n')
    }
    const model = [...bySubject].find(([, ps]) => ps.some(({ p, o }) => p === RDF_TYPE && o.value === `${BGF}BondgraphModel`))
    if (!model) throw new Error(`${path} has no bgf:BondgraphModel`)
    const listed = (predicate: string) => model[1].filter(({ p }) => p === `${BGF}${predicate}`).map(({ o }) => o.value as string)
    const typeOf = (s: string) => (bySubject.get(s) ?? []).find(({ p, o }) => p === RDF_TYPE && o.value.startsWith(BGF))?.o.value
    const fragment = (uri: string) => uri.slice(uri.indexOf('#') + 1)
    const elements: ModelElement[] = []
    for (const [predicate, isBlock] of [['hasBondElement', false], ['hasJunctionStructure', false], ['hasSignalBlock', true]] as const) {
        for (const uri of listed(predicate)) {
            // named by its identifier when the model gives no symbol, so the CellML's names are the model's
            const named = (bySubject.get(uri) ?? []).some(({ p }) => p === `${BGF}hasSymbol`)
            const triples = data(uri, [RDF_TYPE]) + (named ? '' : `\nSUBJECT <${BGF}hasSymbol> ${JSON.stringify(fragment(uri))} .`)
            elements.push({ id: fragment(uri), type: typeOf(uri)!, isBlock, triples, x: 0, y: 0 })
        }
    }
    const bonds: ModelBond[] = []
    for (const [subject, ps] of bySubject) {
        const source = ps.find(({ p }) => p === `${BGF}hasSource`)?.o.value
        const target = ps.find(({ p }) => p === `${BGF}hasTarget`)?.o.value
        if (!source || !target) continue
        bonds.push({
            id: fragment(subject), source: fragment(source), target: fragment(target),
            signal: typeOf(subject) === `${BGF}SignalBond`,
            triples: data(subject, [RDF_TYPE, `${BGF}hasSource`, `${BGF}hasTarget`])
        })
    }
    // in the model's order (s2 before s10)
    bonds.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
    layout(elements, bonds)
    return { elements, bonds }
}

//==============================================================================

const DX = 150, DY = 110

// Power-bonded elements left to right along their bonds, each connected group in its own band; blocks below, a row
// per depth of the signal chain, each near the mean x of what it is connected to
function layout(elements: ModelElement[], bonds: ModelBond[]) {
    const byId = new Map(elements.map(e => [e.id, e]))
    const power = elements.filter(e => !e.isBlock)
    const powerBonds = bonds.filter(b => !b.signal && byId.has(b.source) && byId.has(b.target))
    const layer = new Map<string, number>()
    const component = new Map<string, number>()
    let components = 0
    for (const start of power) {
        if (component.has(start.id)) continue
        // the group's elements, undirected
        const group: string[] = [], queue = [start.id]
        component.set(start.id, components)
        while (queue.length) {
            const id = queue.shift()!
            group.push(id)
            for (const b of powerBonds) {
                const other = b.source === id ? b.target : b.target === id ? b.source : undefined
                if (other && !component.has(other)) { component.set(other, components); queue.push(other) }
            }
        }
        components += 1
        // layers by bond direction, from the group's elements with no bond into them
        const roots = group.filter(id => !powerBonds.some(b => b.target === id))
        const order = roots.length ? roots : [group[0]!]
        for (const r of order) layer.set(r, 0)
        const pending = [...order]
        let guard = 0
        while (pending.length && guard++ < 10000) {
            const id = pending.shift()!
            for (const b of powerBonds.filter(b => b.source === id)) {
                const next = layer.get(id)! + 1
                if (!layer.has(b.target) || (layer.get(b.target)! < next && next < group.length)) {
                    layer.set(b.target, next)
                    pending.push(b.target)
                }
            }
        }
        for (const id of group) if (!layer.has(id)) layer.set(id, 0)
    }
    let top = 60
    for (let c = 0; c < components; c += 1) {
        const members = power.filter(e => component.get(e.id) === c)
        const rows = new Map<number, number>()
        let height = 0
        for (const e of members) {
            const l = layer.get(e.id)!
            const row = rows.get(l) ?? 0
            rows.set(l, row + 1)
            e.x = 80 + l * DX
            e.y = top + row * DY
            height = Math.max(height, row + 1)
        }
        top += height * DY + 20
    }
    // blocks: depth along the signal chain from what isn't a block
    const blocks = elements.filter(e => e.isBlock)
    const depth = new Map<string, number>()
    const depthOf = (id: string, seen = new Set<string>()): number => {
        if (depth.has(id)) return depth.get(id)!
        if (seen.has(id)) return 0
        seen.add(id)
        const from = bonds.filter(b => b.signal && b.target === id && byId.get(b.source)?.isBlock)
        const d = from.length ? 1 + Math.max(...from.map(b => depthOf(b.source, seen))) : 0
        depth.set(id, d)
        return d
    }
    for (const b of blocks) depthOf(b.id)
    const placed = new Set(power.map(e => e.id))
    const blockTop = power.length ? top + 30 : 60
    const used = new Map<number, number[]>()
    for (const block of [...blocks].sort((a, b) => depth.get(a.id)! - depth.get(b.id)!)) {
        const d = depth.get(block.id)!
        const near = bonds.filter(b => b.signal && (b.source === block.id || b.target === block.id))
                          .map(b => b.source === block.id ? b.target : b.source)
                          .filter(id => placed.has(id)).map(id => byId.get(id)!.x)
        let x = near.length ? near.reduce((a, b) => a + b, 0) / near.length : 80 + d * DX
        if (!power.length) x = 80 + d * DX
        const row = used.get(d) ?? []
        while (row.some(other => Math.abs(other - x) < DX - 10)) x += DX / 2
        row.push(x)
        used.set(d, row)
        block.x = x
        block.y = power.length ? blockTop + d * DY : 60 + row.length * 0 + (row.length - 1) * DY
        placed.add(block.id)
    }
}

//==============================================================================

const chrome = process.env.CHROME || 'google-chrome'
const port = Number(process.env.RENDER_PORT || 5199)
const debugPort = port + 1000

const vite = spawn('bunx', ['vite', '--config', 'vite.config.ts', 'app', '--base', '/', '--port', String(port), '--strictPort'],
                   { stdio: ['ignore', 'pipe', 'pipe'] })
await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Vite did not start')), 60000)
    vite.stdout.on('data', (data: Buffer) => {
        if (data.toString().includes('Local:')) {
            clearTimeout(timeout)
            resolve()
        }
    })
    vite.on('exit', code => reject(new Error(`Vite exited (${code})`)))
})
const profile = mkdtempSync(join(tmpdir(), 'import-bgrdf-chrome-'))
const browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${debugPort}`,
                               `--user-data-dir=${profile}`, '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' })

async function pageSocket(): Promise<WebSocket> {
    for (let i = 0; i < 100; i += 1) {
        try {
            const pages = await (await fetch(`http://localhost:${debugPort}/json/list`)).json() as
                { type: string, webSocketDebuggerUrl: string }[]
            const page = pages.find(p => p.type === 'page')
            if (page) {
                const socket = new WebSocket(page.webSocketDebuggerUrl)
                await new Promise(resolve => socket.addEventListener('open', resolve))
                return socket
            }
        } catch { /* not listening yet */ }
        await sleep(200)
    }
    throw new Error(`${chrome} did not start`)
}

let nextId = 0
// biome-ignore lint/suspicious/noExplicitAny: DevTools protocol results are untyped JSON
function send(socket: WebSocket, method: string, params: object = {}): Promise<any> {
    const id = ++nextId
    return new Promise((resolve, reject) => {
        const listener = (event: MessageEvent) => {
            const message = JSON.parse(String(event.data))
            if (message.id === id) {
                socket.removeEventListener('message', listener)
                if (message.error) reject(new Error(message.error.message))
                else resolve(message.result)
            }
        }
        socket.addEventListener('message', listener)
        socket.send(JSON.stringify({ id, method, params }))
    })
}

// Runs in the page: the modules are the app's own, by their /@fs URLs
const scenario = (src: string, model: object) => `(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms))
    const model = ${JSON.stringify(model)}
    const { CellDLEditor } = await import('${src}/CellDL/editor/index.ts')
    for (let i = 0; i < 300; i += 1) {
        if (CellDLEditor.instance?.celldlDiagram?.svgDiagram) break
        await wait(100)
    }
    await wait(1000)
    const diagram = CellDLEditor.instance.celldlDiagram
    if (diagram.svgDiagram.querySelector('g.celldl-Component')) throw new Error('the new diagram is not empty')
    const { addElement, addBond, bondgraphPlugin } = await import('${src}/CellDL/editor/placing.ts')
    const { notifyChanges } = await import('${src}/CellDL/editor/index.ts')
    const { drawSignalBonds } = await import('${src}/plugins/bondgraph/signals.ts')
    const plugin = bondgraphPlugin()
    const BGF = '${BGF}'
    // the model's own properties in place of the editor's defaults
    const replace = (object, triples, keep) => {
        const subject = '<' + object.uri.value + '>'
        object.rdfStore.update('DELETE { ' + subject + ' ?p ?o . ?o ?p2 ?o2 } WHERE { ' + subject + ' ?p ?o . '
            + 'FILTER (STRSTARTS(STR(?p), "' + BGF + '")' + keep.map(p => ' && ?p != <' + BGF + p + '>').join('') + ') '
            + 'OPTIONAL { ?o ?p2 ?o2 . FILTER (isBlank(?o)) } }')
        if (triples.trim()) {
            object.rdfStore.update('INSERT DATA { ' + triples.split('SUBJECT').join(subject) + ' }')
        }
    }
    const objects = new Map()
    for (const e of model.elements) {
        const object = await addElement(e.type, { x: e.x, y: e.y })
        replace(object, e.triples, [])
        await plugin.refreshObject(object)
        objects.set(e.id, object)
    }
    for (const b of model.bonds) {
        drawSignalBonds.value = b.signal
        const bond = addBond(objects.get(b.source), objects.get(b.target))
        drawSignalBonds.value = false
        if (plugin.isSignalBond(bond) !== b.signal) throw new Error(b.id + ' is not a ' + (b.signal ? 'signal' : 'power') + ' bond')
        replace(bond, b.triples, ['hasSource', 'hasTarget'])
    }
    notifyChanges()
    await wait(300)
    return { document: await diagram.serialise() }
})()`

let failed = false
try {
    const socket = await pageSocket()
    await send(socket, 'Runtime.enable')
    const src = `/@fs${resolve('src')}`
    for (const path of models) {
        const name = basename(path).replace(/\.ttl$/, '')
        const model = readModel(path)
        // Vite may reload the page once while it optimises dependencies: then try again
        // biome-ignore lint/suspicious/noExplicitAny: DevTools protocol results are untyped JSON
        let result: any
        for (let attempt = 1; ; attempt += 1) {
            await send(socket, 'Page.navigate', { url: `http://localhost:${port}/` })
            await sleep(1500)
            try {
                result = await send(socket, 'Runtime.evaluate', { expression: scenario(src, model), awaitPromise: true,
                                                                   returnByValue: true, timeout: 240000 })
                break
            } catch (error) {
                if (attempt >= 3) throw error
            }
        }
        if (result.exceptionDetails) {
            console.error(`${name}: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`)
            failed = true
            continue
        }
        const out = join(outDir, `${name}.celldl.svg`)
        writeFileSync(out, result.result.value.document)
        console.log(`${name}: ${model.elements.length} elements, ${model.bonds.length} bonds -> ${out}`)
    }
    socket.close()
} finally {
    browser.kill()
    vite.kill()
    await sleep(500)
    rmSync(profile, { recursive: true, force: true })
}
process.exit(failed ? 1 : 0)
