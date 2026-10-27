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

const items = vue.computed(() => {
  // Add element is only offered on empty canvas, so it isn't listed when an element was right clicked
  const canAdd = !!props.contextMenuProps?.state.has(CONTEXT_MENU.ADD_ELEMENT)
  return [
    ...(canAdd
        ? [{ command: () => contextMenuEvent(CONTEXT_MENU.ADD_ELEMENT), label: 'Add element…' }, { separator: true }]
        : []),
    {
        command: () => contextMenuEvent(CONTEXT_MENU.DELETE),
        disabled: !props.contextMenuProps?.state.has(CONTEXT_MENU.DELETE),
        label: 'Delete'
    },
    // Only when a selected bond, or one between selected elements, has bends
    ...(props.contextMenuProps?.state.has(CONTEXT_MENU.STRAIGHTEN)
        ? [{ command: () => contextMenuEvent(CONTEXT_MENU.STRAIGHTEN), label: 'Straighten' }]
        : []),
    { separator: true },
    {
        command: () => contextMenuEvent(CONTEXT_MENU.GROUP_OBJECTS),
        disabled: !props.contextMenuProps?.state.has(CONTEXT_MENU.GROUP_OBJECTS),
        label: 'Group'
    },
    {
        command: () => contextMenuEvent(CONTEXT_MENU.EDIT_GROUP),
        disabled: !props.contextMenuProps?.state.has(CONTEXT_MENU.EDIT_GROUP),
        label: 'Edit group'
    },
    {
        command: () => contextMenuEvent(CONTEXT_MENU.UNGROUP_OBJECTS),
        disabled: !props.contextMenuProps?.state.has(CONTEXT_MENU.UNGROUP_OBJECTS),
        label: 'Ungroup'
    },
    { separator: true },
    {
        command: () => contextMenuEvent(CONTEXT_MENU.INFO),
        disabled: true,
        label: 'Info'
    }
  ]}
)

//==============================================================================
</script>
