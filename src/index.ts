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
    EditorData,
    EditorEditCommand,
    EditorExportCommand,
    EditorFileCommand,
    EditorSetStateCommand,
    EditorViewCommand,
    Theme
} from '#root/components/WrappedEditor.vue'

export { bgRdfStatements } from '#root/plugins/bondgraph/bgrdf'

export { editorInitialised } from '#root/utils'

export { version } from '../package.json'

//==============================================================================

export { CellDLEditor }
export default CellDLEditor

//==============================================================================
//==============================================================================
