<template lang="pug">
    Toolbar.vertical
        template(#start)
            ToolButton(
                v-for="button in buttons"
                :key="button.toolId"
                :toolId="button.toolId"
                :active="button?.active"
                :prompt="button.prompt"
                :icon="button.icon"
                :image="button.image"
                :modal="!!button?.panel"
                :type="type"
                :panel="button.panel"
                @button-event="buttonEvent"
            )
                component(
                    v-if="type === 'popover'"
                    :is="button.panel"
                    :title="button.prompt"
                    :toolId="button.toolId"
                )
                component(
                    v-if="type === 'panel'"
                    :is="button.panel"
                    :title="button.prompt"
                    :toolId="button.toolId"
                    @panel-event="panelEvent"
                    @style-event="styleEvent"
                )
            .tool-actions(v-if="actions?.length")
                .tool-action(
                    v-for="action in actions"
                    :key="action.actionId"
                    :id="action.actionId"
                    :class="{ disabled: action.disabled }"
                    role="button"
                    :aria-label="action.prompt"
                    :aria-disabled="action.disabled"
                    v-tippy="{ content: action.prompt, placement: 'right' }"
                    @click="!action.disabled && action.run()"
                )
                    component(
                        :is="actionIcon(action.icon)"
                        :size="24"
                        stroke-width="1.5"
                    )
</template>

<script setup lang="ts">
import * as vue from 'vue'
import * as LucideIcons from '@lucide/vue'

import { useThemeCssVariables } from '#root/utils/themeCssVariables'

useThemeCssVariables('toolbar')

//==============================================================================

import type { EditorToolAction, EditorToolButton, PopoverEventData } from '#root/utils/editor-types'
import type { Styling } from '#root/utils/styling'

import ToolButton from './ToolButton.vue'

//==============================================================================

const props = defineProps<{
    type?: string
    buttons: EditorToolButton[]
    actions?: EditorToolAction[]
}>()

function actionIcon(icon: string) {
    return (LucideIcons as Record<string, unknown>)[icon.replace(/^lucide-/, '')]
}

const emit = defineEmits<{
    'button-event': [
        toolId: string,
        active: boolean,
    ]
}>()

function buttonEvent(toolId: string, active: boolean, panel: vue.Raw<vue.Component> | null) {
    for (const button of props.buttons) {
        if (active && toolId === button.toolId) {
            button.active = true
        } else {
            button.active = false
        }
    }
    emit('button-event', toolId, active)
}

function panelEvent(toolId: string, itemId: string, oldValue: string, newValue: string) {
    document.dispatchEvent(
        new CustomEvent('panel-event', {
            detail: {
                type: 'value',
                source: toolId,
                itemId: itemId,
                value: {
                    oldValue,
                    newValue
                }
            }
        })
    )
}

function styleEvent(toolId: string, styling: Styling) {
    document.dispatchEvent(
        new CustomEvent('style-event', {
            detail: {
                type: 'value',
                source: toolId,
                styling: styling
            }
        })
    )
}

//==============================================================================

</script>

<style scoped>
.panel-content {
    width: 250px;
    border: 2px solid var(--editor-border-color);
    border-left-width: 1px;
    right: 38px; /* This depends on panel bar width... */
    top: 1.8em;
    bottom: 1.6em;
    position: absolute;
}
</style>

<style>
.celldl-editor .tool-action {
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    cursor: pointer;
    border-style: solid;
    border-color: var(--editor-border-color);
    border-width: 0 1px 2px;
}
.celldl-editor .tool-actions {
    margin-top: 8px;
    border-top: 1px solid var(--editor-border-color);
}
.celldl-editor .tool-action:hover:not(.disabled) {
    background-color: lightgrey;
}
.celldl-editor .tool-action.disabled {
    opacity: 0.35;
    cursor: default;
}
.celldl-editor .p-toolbar.vertical,
.celldl-editor .p-toolbar.vertical > .p-toolbar-start {
    flex-direction: column !important;
    width: 38px !important;
    padding: 0 !important;
    border-top: 1px solid grey;
    flex-wrap: nowrap !important;
    border-radius: 0 !important;
}
</style>
