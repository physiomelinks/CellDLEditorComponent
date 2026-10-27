/******************************************************************************

CellDL Editor

Copyright (c) 2022 - 2026 David Brooks

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

******************************************************************************/

//==============================================================================

// URIs for the BG-RDF framework

export const BGF_ONTOLOGY_URI = 'https://bg-rdf.org/ontologies/bondgraph-framework'

const BG_RDF_TEMPLATE_BASE_URI = 'https://bg-rdf.org/'

const BG_RDF_TEMPLATE_URIS = [
    `${BG_RDF_TEMPLATE_BASE_URI}templates/chemical.ttl`,
    `${BG_RDF_TEMPLATE_BASE_URI}templates/electrical.ttl`,
    `${BG_RDF_TEMPLATE_BASE_URI}templates/hydraulic.ttl`,
    `${BG_RDF_TEMPLATE_BASE_URI}templates/mechanical.ttl`,
    `${BG_RDF_TEMPLATE_BASE_URI}templates/signal.ttl`
]

//==============================================================================

// Map from BG-RDF source URIs to local Turtle files

export const BG_RDF_SOURCES: Map<string, string> = new Map()

const BG_RDF_ASSET_BASE = '/src/assets/bg-rdf/'

const BG_RDF_ONTOLOGY_ASSET_PATH = `${BG_RDF_ASSET_BASE}ontology.ttl`

// See https://vite.dev/guide/features#custom-queries

// N.B. The path to `glob()` must be a literal, not a computed constant

const BG_RDF_ONTOLOGY_SOURCE: Record<string, string> = import.meta.glob('#root/assets/bg-rdf/ontology.ttl', {
    eager: true,
    import: 'default',
    query: '?raw'
})

for (const [path, data] of Object.entries(BG_RDF_ONTOLOGY_SOURCE)) {
    if (path.endsWith(BG_RDF_ONTOLOGY_ASSET_PATH)) {
        BG_RDF_SOURCES.set(BGF_ONTOLOGY_URI, data)
        break
    }
}

// N.B. The path to `glob()` must be a literal, not a computed constant

const BG_RDF_TEMPLATE_SOURCES: Record<string, string> = import.meta.glob('#root/assets/bg-rdf/templates/*.ttl', {
    eager: true,
    import: 'default',
    query: '?raw'
})

for (const [path, data] of Object.entries(BG_RDF_TEMPLATE_SOURCES)) {
    for (const templateUri of BG_RDF_TEMPLATE_URIS) {
        const templatePath = templateUri.substring(BG_RDF_TEMPLATE_BASE_URI.length)
        const templateKey = `${BG_RDF_ASSET_BASE}${templatePath}`
        if (path.endsWith(templateKey)) {
            BG_RDF_SOURCES.set(templateUri, data)
            break
        }
    }
}

//==============================================================================

/**
 * The BG-RDF framework as Turtle: the ontology, and templates keyed by file
 * name, such as `electrical.ttl`.
 */
export interface BgRdfFramework {
    ontology: string
    templates: Record<string, string>
}

/**
 * The BG-RDF framework's Turtle sources, as bundled with the editor.
 *
 * Unlike `bgRdfStatements()` this needs no RDF store, so a web worker can load
 * the framework (e.g. with `@physiomelinks/bg2cellml`'s `loadFramework()`)
 * without the editor or its oxigraph.
 */
export function bgRdfFramework(): BgRdfFramework {
    const templates: Record<string, string> = {}
    for (const uri of BG_RDF_TEMPLATE_URIS) {
        const source = BG_RDF_SOURCES.get(uri)
        if (source !== undefined) {
            templates[uri.substring(uri.lastIndexOf('/') + 1)] = source
        }
    }
    return {
        ontology: BG_RDF_SOURCES.get(BGF_ONTOLOGY_URI) ?? '',
        templates
    }
}

//==============================================================================
//==============================================================================
