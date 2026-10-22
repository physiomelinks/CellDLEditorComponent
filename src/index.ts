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
    type Annotation,
    type Annotations,
    type AnnotationValue,
    type EditorState,
    EditorStatus,
    type FileStatus,
    type SvgViewerOptions,
    type ViewerEvent,
    type ViewState
} from '#root/utils/editor-types'

export type {
    CellDLEditorCommand,
    CellDLEditorProps,
    DiagramChange,
    EditorChrome,
    EditorData,
    EditorEditCommand,
    EditorElementCommand,
    EditorExportCommand,
    EditorFileCommand,
    EditorPanelName,
    EditorSetStateCommand,
    EditorToolName,
    EditorViewCommand,
    ElementResult,
    ElementsChange,
    Theme
} from '#root/components/WrappedEditor.vue'

export type { ValuesMode } from '#root/plugins/bondgraph/values'

export type {
    DiagramElement,
    ElementEdit,
    ElementError,
    ElementField,
    ElementValue,
    NamedElementValue
} from '#root/plugins/bondgraph/elements'

export { bgRdfStatements } from '#root/plugins/bondgraph/bgrdf'

export { type BgRdfFramework, bgRdfFramework } from '#root/plugins/bondgraph/bgrdf-sources'

export { editorInitialised, initialiseRdf, type OxigraphModule } from '#root/utils'

export { version } from '../package.json'

//==============================================================================

export { CellDLEditor }
export default CellDLEditor

//==============================================================================
//==============================================================================
