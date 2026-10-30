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

import CellDLEditor from '#root/components/EditorComponent'

//==============================================================================

export { DEFAULT_VIEW_STATE } from '#editor/editor/editguides'

export {
    type EditorState,
    type ElementInfo,
    type ElementInfoById,
    type ElementInfoValue,
    EditorStatus,
    type FileStatus,
    type SvgViewerOptions,
    type ViewerEvent,
    type ViewInfo,
    type ViewState
} from '#root/utils/editor-types'

export type {
    CellDLEditorCommand,
    CellDLEditorProps,
    DiagramChange,
    EditorChrome,
    EditorData,
    EditorDocumentCommand,
    EditorEditCommand,
    EditorElementCommand,
    EditorExportCommand,
    EditorFileCommand,
    EditorPanelName,
    EditorReorganiseCommand,
    EditorSetStateCommand,
    EditorToolName,
    EditorViewCommand,
    ElementResult,
    ElementsChange,
    Theme,
    ViewStateChange
} from '#root/components/WrappedEditor.vue'

export type { EditorMessage, EditorMessageLevel } from '#editor/editor'

export {
    DEFAULT_REORGANISE_MODE,
    REORGANISE_MODES,
    type ReorganiseChrome,
    type ReorganiseMode,
    type ReorganiseResult,
    type ReorganiseState
} from '#editor/editor/reorganise'

export type { ValuesMode } from '#root/plugins/bondgraph/values'

export type { PaletteDomain } from '#root/plugins/bondgraph/palette'

/** Dispatched on `document` when a pointer is pressed on the canvas, for a host to close its own menus */
export { CANVAS_PRESS_EVENT } from '#editor/editor'

/** Dispatched on `document` when a plain click on empty canvas clears the selection, closing Properties and Style */
export { CANVAS_EMPTY_CLICK_EVENT } from '#editor/editor'

export { ARROW_STYLES, type ArrowStyle, DEFAULT_ARROW_STYLE } from '#root/utils/arrows'

export { DEFAULT_WHEEL_MODE, WHEEL_MODES, type WheelMode } from '#editor/editor/panzoom'

export type {
    DiagramElement,
    ElementEdit,
    ElementError,
    ElementField,
    ElementValue,
    NamedElementValue,
    UnitSystemResult
} from '#root/plugins/bondgraph/elements'

export {
    UNIT_SYSTEM_IDS,
    UNIT_SYSTEM_IRIS,
    UNIT_SYSTEM_PREDICATE,
    type UnitSystemId
} from '#root/plugins/bondgraph/unitsystem'

export { bgRdfStatements } from '#root/plugins/bondgraph/bgrdf'

export { type BgRdfFramework, bgRdfFramework } from '#root/plugins/bondgraph/bgrdf-sources'

export { editorInitialised, initialiseRdf, type OxigraphModule } from '#root/utils'

export { version } from '../package.json'

//==============================================================================

export { CellDLEditor }
export default CellDLEditor

//==============================================================================
//==============================================================================
