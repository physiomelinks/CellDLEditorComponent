<template lang="pug">
    .arrange-bar(
        role="toolbar"
        aria-label="Align and distribute"
        @pointerdown.stop @pointerover.stop
        @click.stop @dblclick.stop @contextmenu.stop.prevent
    )
        template(v-for="(button, index) in buttons" :key="button.op")
            span.arrange-separator(v-if="index === 3 || index === 6")
            button.arrange-button(
                type="button"
                :aria-label="button.prompt"
                :disabled="count < minimumForArrange(button.op)"
                v-tippy="{ content: button.prompt, placement: 'bottom' }"
                @click="emit('arrange', button.op)"
            )
                component(:is="button.icon" :size="18" stroke-width="1.75")
</template>

<script setup lang="ts">
import type * as vue from 'vue'
import {
    AlignCenterHorizontal,
    AlignCenterVertical,
    AlignEndHorizontal,
    AlignEndVertical,
    AlignHorizontalSpaceAround,
    AlignStartHorizontal,
    AlignStartVertical,
    AlignVerticalSpaceAround
} from '@lucide/vue'

import { type ArrangeOp, minimumForArrange } from '#editor/editor/arrange'

defineProps<{
    /** How many selected components can be arranged */
    count: number
}>()

const emit = defineEmits<{
    arrange: [op: ArrangeOp]
}>()

const buttons: { op: ArrangeOp, prompt: string, icon: vue.Component }[] = [
    { op: 'left', prompt: 'Align left', icon: AlignStartVertical },
    { op: 'centre', prompt: 'Align centre', icon: AlignCenterVertical },
    { op: 'right', prompt: 'Align right', icon: AlignEndVertical },
    { op: 'top', prompt: 'Align top', icon: AlignStartHorizontal },
    { op: 'middle', prompt: 'Align middle', icon: AlignCenterHorizontal },
    { op: 'bottom', prompt: 'Align bottom', icon: AlignEndHorizontal },
    { op: 'distribute-h', prompt: 'Distribute horizontally (3 or more)', icon: AlignHorizontalSpaceAround },
    { op: 'distribute-v', prompt: 'Distribute vertically (3 or more)', icon: AlignVerticalSpaceAround }
]
</script>

<style scoped>
.arrange-bar {
    position: absolute;
    top: 6px;
    right: 8px;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    border: 1px solid var(--p-content-border-color);
    border-radius: 6px;
    color: var(--p-text-color);
    background-color: var(--p-content-background);
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.15);
    user-select: none;
}
.arrange-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: none;
    border-radius: 4px;
    color: inherit;
    background: transparent;
    cursor: pointer;
}
.arrange-button:hover:not(:disabled) {
    background-color: var(--p-content-hover-background);
}
.arrange-button:disabled {
    opacity: 0.35;
    cursor: default;
}
.arrange-button:focus-visible {
    outline: 2px solid var(--p-primary-color);
    outline-offset: -2px;
}
.arrange-separator {
    width: 1px;
    height: 18px;
    margin: 0 2px;
    background-color: var(--p-content-border-color);
}
</style>
