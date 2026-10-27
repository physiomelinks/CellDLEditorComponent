// Checks that CellDL documents open from a link in a served editor app:
//
//     bun scripts/check-open-link.ts URL OUTDIR DOCUMENT.celldl.svg...
//
// For each document, opens URL?open=celldl&name=<name>#<base64 of the document> in headless Chrome (driven over the
// DevTools protocol; CHROME, default google-chrome; a new profile per run), waits for the diagram, and checks that
// every component of the document (by id) is in the opened diagram, and that its signal bonds (bgf:SignalBond) are
// there and drawn as signal bonds (class `signal`). Writes OUTDIR/<name>.png, a screenshot of the opened diagram,
// and prints each document's link length. Exits 1 if a check fails.

import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'
import { basename, join } from 'node:path'

const [url, outDir, ...documents] = process.argv.slice(2)
if (!url || !outDir || !documents.length) {
    console.error('usage: bun scripts/check-open-link.ts URL OUTDIR DOCUMENT.celldl.svg...')
    process.exit(1)
}
mkdirSync(outDir, { recursive: true })
const chrome = process.env.CHROME || 'google-chrome'
const debugPort = Number(process.env.DEBUG_PORT || 9475)

const profile = mkdtempSync(join(tmpdir(), 'check-open-link-chrome-'))
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

// What a document has: its components' ids, and its signal bonds' ids (from its RDF, `:ID a ..., bgf:SignalBond`)
function expected(celldl: string): { components: string[], signals: string[] } {
    const components = [...celldl.matchAll(/<g[^>]*class="[^"]*celldl-Component[^"]*"[^>]*>/g)]
        .map(m => m[0].match(/\sid="([^"]+)"/)?.[1]).filter((id): id is string => !!id)
    const signals = [...celldl.matchAll(/:(\S+) a celldl:Connection, bgf:SignalBond/g)].map(m => m[1]!)
    return { components, signals }
}

// Runs in the page: what the opened diagram has
const opened = `(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms))
    let svg
    for (let i = 0; i < 200; i += 1) {
        svg = document.querySelector('svg g.celldl-Component')?.ownerSVGElement
        if (svg) break
        await wait(100)
    }
    await wait(500)
    if (!svg) return { components: [], signals: [], power: 0 }
    const components = [...svg.querySelectorAll('g.celldl-Component')].map(g => g.id)
    const connections = [...svg.querySelectorAll('.celldl-Connection')].filter(c => c.id)
    const signals = connections.filter(c => c.classList.contains('signal')).map(c => c.id)
    const dashed = connections.filter(c => c.classList.contains('signal'))
        .every(c => { const p = c.tagName === 'path' ? c : c.querySelector('path'); return getComputedStyle(p).strokeDasharray !== 'none' })
    return { components, signals, power: connections.length - signals.length, dashed, url: location.href }
})()`

let failed = false
try {
    const socket = await pageSocket()
    await send(socket, 'Runtime.enable')
    await send(socket, 'Page.enable')
    for (const path of documents) {
        const name = basename(path).replace(/\.celldl\.svg$|\.svg$/, '')
        const celldl = readFileSync(path, 'utf8')
        const link = `${url}?open=celldl&name=${encodeURIComponent(name)}#${Buffer.from(celldl, 'utf8').toString('base64')}`
        // A blank page first, so each link is a fresh load of the app
        await send(socket, 'Page.navigate', { url: 'about:blank' })
        await sleep(300)
        await send(socket, 'Page.navigate', { url: link })
        await sleep(1500)
        const result = await send(socket, 'Runtime.evaluate', { expression: opened, awaitPromise: true,
                                                                returnByValue: true, timeout: 60000 })
        const found = result.result.value as { components: string[], signals: string[], power: number, dashed: boolean, url: string }
        const want = expected(celldl)
        const missing = want.components.filter(id => !found.components.includes(id))
        const missingSignals = want.signals.filter(id => !found.signals.includes(id))
        const ok = want.components.length > 0 && missing.length === 0 && missingSignals.length === 0
                && found.signals.length === want.signals.length && found.dashed
        failed ||= !ok
        console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${found.components.length}/${want.components.length} components, `
                    + `${found.signals.length}/${want.signals.length} signal bonds (dashed: ${found.dashed}), `
                    + `${found.power} power bonds; link ${link.length} characters`
                    + (missing.length ? `; missing ${missing.join(', ')}` : '')
                    + (missingSignals.length ? `; missing signal bonds ${missingSignals.join(', ')}` : ''))
        const shot = await send(socket, 'Page.captureScreenshot', { format: 'png' })
        writeFileSync(join(outDir, `${name}.png`), Buffer.from(shot.data, 'base64'))
    }
    socket.close()
} finally {
    browser.kill()
    await sleep(500)
    rmSync(profile, { recursive: true, force: true })
}
process.exit(failed ? 1 : 0)
