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

import type { MetadataPropertiesMap } from '@celldl/metadata'

//==============================================================================

import type { CellDLObject } from '#editor/celldlObjects'
import type { PointLike } from '#root/utils/points'
import type { StringProperties } from '#root/utils/types'

//==============================================================================

export interface ObjectTemplate {
    /**
     * The object's CellDL class.
     */
    CellDLClass: typeof CellDLObject
    /**
     * A description of the object.
     */
    description?: string
    /**
     * A depiction for the object, encoded as a data URL.
     */
    imageData?: string

    metadataProperties: MetadataPropertiesMap
    /**
     * A name for the object.
     */
    name?: string
}

//==============================================================================

export interface LibraryComponentTemplate {
    /**
     * A unique indentifier for the component template.
     */
    id: string

    /**
     * A descriptive name for the component template.
     */
    name: string

    /**
     * A depiction for the component, encoded as a data URL.
     */
    imageData: string

    /**
     * `true` if the component template is selected in the `Add component` tool.
     */
    selected?: boolean
}

export interface ComponentLibrary {
    /**
     * A unique indentifier for the component library.
     */
    id: string

    /**
     * A descriptive name for the component library.
     */
    name: string

    /**
     * Templates of components in the library.
     */
    templates: LibraryComponentTemplate[]
}

export interface ElementTypeName {
    type: string
    name: string
}

//==============================================================================

export interface NamedProperty {
    name: string
    property: string
}

//==============================================================================

export interface TemplateProperties {
    nodeSettings?: StringProperties
}

//==============================================================================

export type TemplateEventDetails = {
    id: string,
    centre: PointLike
    offset: PointLike
    /** A palette entry (../../plugins/bondgraph/palette.ts), placed centred with its defaults */
    entryId?: string
}

//==============================================================================

export function getTemplateEventDetails(id: string, target: HTMLImageElement,
                                        event: DragEvent|MouseEvent|null): TemplateEventDetails {
    const details = {
        id: id,
        // Centre of target.x/y wrt image top left
        centre: {
            x: target.naturalWidth / 2,
            y: target.naturalHeight / 2
        },
        offset: { x: 0, y: 0 }
    }
    if (event) {
        // Offset of event.x/y wrt centre
        details.offset = {
            x: event.offsetX - target.scrollWidth / 2,
            y: event.offsetY - target.scrollHeight / 2
        }
    }
    return details
}

//==============================================================================
//==============================================================================
