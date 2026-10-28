<template lang="pug">
    ContextMenu(
        ref="menu" :model="items"
    )
</template>


<script setup lang="ts">
import * as vue from 'vue'
import { useThemeCssVariables } from '#root/utils/themeCssVariables'

useThemeCssVariables('contextmenu')

//==============================================================================

import { CANVAS_PRESS_EVENT, CONTEXT_MENU } from '#editor/editor'
import { groupingState } from '#editor/editor/grouping'

import { contextMenuEntries } from './contextMenuEntries'

export type ContextMenuProps = {
    state: Set<CONTEXT_MENU>,
    event?: Event
}

//==============================================================================

const props = defineProps<{
    contextMenuProps: ContextMenuProps
}>()

const menu = vue.ref()

vue.watch(
    () => props.contextMenuProps,
    () => {
        if (props.contextMenuProps.event) {
            menu.value.show(props.contextMenuProps.event)
            props.contextMenuProps.event = undefined
        }
    }
)

// Escape closes the menu even when it doesn't have focus
function keyDownEvent(event: KeyboardEvent) {
    if (event.key === 'Escape') {
        menu.value?.hide()
    }
}
// A press on the canvas closes it; PrimeVue only closes it on a click outside the canvas it opened over
function canvasPressEvent() {
    if (menu.value?.visible) {
        menu.value.hide()
    }
}
vue.onMounted(() => {
    document.addEventListener('keydown', keyDownEvent)
    document.addEventListener(CANVAS_PRESS_EVENT, canvasPressEvent)
})
vue.onUnmounted(() => {
    document.removeEventListener('keydown', keyDownEvent)
    document.removeEventListener(CANVAS_PRESS_EVENT, canvasPressEvent)
})

function contextMenuEvent(id: string) {
    document.dispatchEvent(
        new CustomEvent('context-menu-click', {
            detail: { id }
        })
    )
    menu.value.hide()
}

//==============================================================================

const items = vue.computed(() =>
    contextMenuEntries(props.contextMenuProps?.state, groupingState.enabled).map(entry =>
        'id' in entry ? { command: () => contextMenuEvent(entry.id), disabled: entry.disabled, label: entry.label } : entry
    )
)

//==============================================================================
</script>
