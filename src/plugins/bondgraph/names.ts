/******************************************************************************

CellDL Editor

Copyright (c) 2022 - 2025 David Brooks

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

// The names bg2cellml gives a model's variables when nothing renames them, for an element's hover (./lawtext.ts).
// From Finbar Argus's naming.ts, without its naming rules and explicit names (BG-RDF terms not upstream yet).

//==============================================================================

const BGF = 'https://bg-rdf.org/ontologies/bondgraph-framework#'

// the classes of element whose variables are named
export const ELEMENT_CLASSES: string[] = [
    `${BGF}QuantityStore`, `${BGF}Reaction`, `${BGF}PotentialSource`, `${BGF}FlowSource`, `${BGF}Resistance`,
    `${BGF}FlowStore`
]

export interface NamingElement {
    id: string                  // its URI
    identifier: string          // the URI's fragment
    elementClass?: string       // one of ELEMENT_CLASSES
    domain?: string             // its physical domain's URI
    label?: string              // its symbol (q, Re, Se, ...)
    species?: string
    location?: string
    variables: string[]         // the template's names of its variables
    intrinsic?: string          // the variable that is its own name (a store's q)
}

//==============================================================================

// bg2cellml's clean_latex (species and locations) and clean_name (identifiers)
function cleanLatex(latex: string): string {
    return latex.trim().replace(/\\[^{]*\{([^}]*)\}/g, '_$1').replace(/\^/g, '_').replace(/[^a-zA-Z_0-9]/g, '').replace(/^_*/, '')
}
function cleanName(name: string): string {
    return name.replace(/[:\-. ]/g, '_')
}

/** The bond graph's name for an element on its own (its symbol, species and location), as bg2cellml makes it. */
export function elementName(e: NamingElement): string {
    let name = e.label || e.identifier
    if (e.species) name += `_${cleanLatex(e.species)}`
    if (e.location) name += `_${cleanLatex(e.location)}`
    return name
}

/**
 * Every element's bond graph name, as bg2cellml makes them: in the order of the elements' identifiers, an element
 * whose name is taken (a copy of a chemostat) is named by its identifier instead, numbered if that is taken too.
 */
export function elementNames(elements: NamingElement[]): Map<string, string> {
    const names = new Map<string, string>(), taken = new Set<string>()
    for (const e of [...elements].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
        let name = elementName(e)
        if (taken.has(name)) {
            name = cleanName(e.identifier)
            for (let n = 2; taken.has(name); n++) name = `${cleanName(e.identifier)}_${n}`
        }
        taken.add(name)
        names.set(e.id, name)
    }
    return names
}

/** The bond graph's name for one of an element's variables (`element`: its name from elementNames). */
export function bondgraphName(e: NamingElement, variable: string, element: string = elementName(e)): string {
    return variable === e.intrinsic ? element : `${variable}_${element}`
}

/**
 * The CellML name of every element variable, keyed `${element id}|${variable}`, numbered when taken. `reserved`
 * names (time, the domains' constants) are never given.
 */
export function variableNames(elements: NamingElement[], reserved: string[] = ['t', 'RT', 'F']): Map<string, string> {
    const names = new Map<string, string>()
    const taken = new Set(reserved)
    const ofElement = elementNames(elements)
    const ordered = [...elements].sort((a, b) => a.identifier < b.identifier ? -1 : a.identifier > b.identifier ? 1 : 0)
    for (const e of ordered) {
        for (const variable of e.variables) {
            const wanted = bondgraphName(e, variable, ofElement.get(e.id))
            let name = wanted
            for (let n = 2; taken.has(name); n++) name = `${wanted}_${n}`
            taken.add(name)
            names.set(`${e.id}|${variable}`, name)
        }
    }
    return names
}

//==============================================================================
//==============================================================================
