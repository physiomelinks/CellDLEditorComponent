//==============================================================================

import { defineAsyncComponent } from 'vue'

import { initialiseRdf } from '#root/utils'

// Initialise the RDF store backend before the editor is imported

const EditorComponent = defineAsyncComponent(async () => {
    await initialiseRdf()
    return import('./WrappedEditor.vue')
})

export default EditorComponent

//==============================================================================

