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

import { CONTEXT_MENU } from '#editor/editor'

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
vue.onMounted(() => document.addEventListener('keydown', keyDownEvent))
vue.onUnmounted(() => document.removeEventListener('keydown', keyDownEvent))

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
  return [
    {
        command: () => contextMenuEvent(CONTEXT_MENU.DELETE),
        disabled: !props.contextMenuProps?.state.has(CONTEXT_MENU.DELETE),
        label: 'Delete'
    },
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
