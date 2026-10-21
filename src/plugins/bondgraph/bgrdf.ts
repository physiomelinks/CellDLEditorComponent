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

import { initialised, RdfStore, type Statement } from '@celldl/rdf'

import { BG_RDF_SOURCES } from './bgrdf-sources'

export { BGF_ONTOLOGY_URI } from './bgrdf-sources'

//==============================================================================

let bgRdfStore: RdfStore|undefined

export function bgRdfStatements(): Statement[] {
    if (!initialised()) {
        return []
    } else if (bgRdfStore === undefined) {
        bgRdfStore = new RdfStore()
        for (const [uri, source] of BG_RDF_SOURCES.entries()) {
            bgRdfStore.load(uri, source)
        }
    }
    return bgRdfStore.statements()
}

//==============================================================================
//==============================================================================
