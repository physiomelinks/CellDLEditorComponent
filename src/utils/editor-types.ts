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

import type * as vue from 'vue'

//==============================================================================

import type * as locApi from '#root/libopencor/locUIJsonApi'
import type { Styling } from './styling'

//==============================================================================

export enum PANEL_ID {
    METADATA_PANEL = 'metadata-property-panel',
    PROPERTIES_PANEL = 'properties-property-panel',
    REACTIONS_PANEL = 'reactions-panel',
    STYLE_PANEL = 'style-property-panel'
}

//==============================================================================

export type ItemDetails = locApi.IUiJsonInput & {
    itemId: string
    property: string
    possibleValues?: locApi.IUiJsonDiscreteInputPossibleValue[]
    units?: string
    optional?: boolean
    numeric?: boolean
    /** `false` when the shown value is a default the object doesn't store */
    stored?: boolean
}

export interface PropertyGroup {
    groupId: string
    items: ItemDetails[]
    styling?: Styling
    title?: string
}

export interface ValueChange {
    oldValue: string
    newValue: string
}

//==============================================================================

export type ComponentProperties = {
    objectId?: string
    panelId: string
    groups: PropertyGroup[]
}

//==============================================================================

export type EditorState = {
    msg?: string
    state: string
}

//==============================================================================

export class EditorStatus {
    #canPaste: boolean = false
    #canRedo: boolean = false
    #fileModified: boolean = false
    #objectSelected: boolean = false

    get canPaste(): boolean {
        return this.#canPaste
    }
    set canPaste(value: boolean) {
        this.#canPaste = value
    }

    get canRedo(): boolean {
        return this.#canRedo
    }
    set canRedo(value: boolean) {
        this.#canRedo = value
    }

    get fileModified(): boolean {
        return this.#fileModified
    }
    set fileModified(value: boolean) {
        this.#fileModified = value
    }

    get objectSelected(): boolean {
        return this.#objectSelected
    }
    set objectSelected(value: boolean) {
        this.#objectSelected = value
    }
}

//==============================================================================

export type EditorToolButton = {
    toolId: string
    prompt: string
    active?: boolean
    icon?: string
    image?: string
    panel?: vue.Raw<vue.Component>
    props?: vue.Ref<PropertyGroup[]>
}

/** A toolbar button that runs a command, such as Undo, rather than arming a tool */
export type EditorToolAction = {
    actionId: string
    prompt: string
    icon: string
    disabled?: boolean
    run: () => void
}

//==============================================================================

export type PopoverEventData = {
    icon?: string
    id: string
    imageData: string
    name: string
}

//==============================================================================

export type FileStatus = {
    haveData: boolean
    modified: boolean
}
//==============================================================================

export type ViewState = {
    showGrid?: boolean
    gridSpacing?: number
    snapToGrid?: number
    alignmentGuides?: boolean
    /**
     * Zoom the view in or out by a step, to fit the diagram, or to a scale
     * (screen pixels per SVG unit), centred on `centre`, or else on the diagram
     */
    zoom?: 'in' | 'out' | 'fit' | number
    /** With `zoom: 'fit'`, the most it zooms in, e.g. `1` to never enlarge a small diagram */
    maxScale?: number
    /** With a numeric `zoom`, the point (in SVG coordinates) to centre the view on */
    centre?: { x: number, y: number }
    /** Asks for a `view-state` reply, carrying this kind, once the view has been set */
    kind?: string
}

/** The view, as `view-state` reports it */
export type ViewInfo = {
    /** Screen pixels per SVG unit */
    scale: number
    /** The point (in SVG coordinates) at the centre of the view */
    centre: { x: number, y: number }
    /** The scale `zoom: 'fit'` would zoom to, or null for a blank diagram */
    fitScale: number | null
    /** The diagram's components' bounds, in SVG coordinates, or null for a blank diagram */
    bounds: { left: number, top: number, right: number, bottom: number } | null
}

//==============================================================================

// Component annotations and events, the same as `@celldl/viewer`'s

export type AnnotationValue = string | number | boolean | object
export type Annotation = Record<string, AnnotationValue>

// Annotations keyed by the id of a diagram's component
export type Annotations = Record<string, Annotation>

export type SvgViewerOptions = {
    tooltip?: string // The annotation field to show as a component's tooltip
    /** Emit `elements` with each `diagram-changed`, for a host that lists the diagram's elements */
    elementList?: boolean
}

export type ViewerEvent = {
    type: 'select' | 'unselect' | 'active' | 'unactive'
    component?: {
        id: string
        annotation?: Annotation
    }
}

//==============================================================================
//==============================================================================
