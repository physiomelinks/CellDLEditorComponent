
//==============================================================================

import { initialise, initialised as rdfInitialised } from '@celldl/rdf'
import type * as $oxigraph from 'oxigraph/web'

//==============================================================================

/**
 * The Oxigraph module used by the editor's RDF store.
 */
export type OxigraphModule = typeof $oxigraph

let rdfReady: Promise<OxigraphModule> | undefined

/**
 * Initialise the editor's RDF store backend without loading the editor.
 *
 * Once it resolves, `bgRdfStatements()` gives the BG-RDF framework, and a host
 * can use the resolved Oxigraph module rather than loading its own.
 */
export function initialiseRdf(): Promise<OxigraphModule> {
    if (rdfReady === undefined) {
        rdfReady = initialise().then(() => (globalThis as unknown as { rdfModule: OxigraphModule }).rdfModule)
    }
    return rdfReady
}

export function editorInitialised(): boolean {
    return rdfInitialised()
}

//==============================================================================
//==============================================================================
