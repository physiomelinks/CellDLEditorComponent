<template lang="pug">
    .canvas-controls(
        :class="{ vertical }"
        role="toolbar"
        aria-label="Zoom"
        @pointerdown.stop @pointerover.stop
        @click.stop @dblclick.stop @contextmenu.stop.prevent
    )
        button.canvas-control(
            type="button"
            aria-label="Zoom out (-)"
            v-tippy="{ content: 'Zoom out (-)', placement: tipPlacement }"
            @click="emit('zoom-out')"
        )
            Minus(:size="16" stroke-width="2")
        span.zoom-percent(aria-live="polite" aria-label="Zoom level") {{ percent }}
        button.canvas-control(
            type="button"
            aria-label="Zoom in (+)"
            v-tippy="{ content: 'Zoom in (+)', placement: tipPlacement }"
            @click="emit('zoom-in')"
        )
            Plus(:size="16" stroke-width="2")
        button.canvas-control.fit(
            type="button"
            aria-label="Zoom to fit (Shift+1)"
            v-tippy="{ content: 'Zoom to fit (Shift+1)', placement: tipPlacement }"
            @click="emit('zoom-fit')"
        )
            Scan(:size="16" stroke-width="2")
            span(v-if="!vertical") Fit
</template>

<script setup lang="ts">
import * as vue from 'vue'
import { Minus, Plus, Scan } from '@lucide/vue'

const props = defineProps<{
    /** Screen pixels per SVG unit */
    scale: number
    /** Stacked, for a canvas too narrow for them across */
    vertical?: boolean
}>()

const emit = defineEmits<{
    'zoom-in': []
    'zoom-out': []
    'zoom-fit': []
}>()

const tipPlacement = vue.computed(() => props.vertical ? 'left' : 'top')

const percent = vue.computed(() => `${Math.round(100 * props.scale)}%`)
</script>

<style scoped>
.canvas-controls {
    position: absolute;
    right: 8px;
    bottom: 8px;
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
    font-size: 12px;
    user-select: none;
}
.canvas-controls.vertical {
    flex-direction: column-reverse;
}
.canvas-controls.vertical .zoom-percent {
    min-width: 0;
    font-size: 10px;
}
.canvas-control {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 24px;
    min-width: 24px;
    padding: 0 4px;
    border: none;
    border-radius: 4px;
    color: inherit;
    background: transparent;
    cursor: pointer;
}
.canvas-control:hover {
    background-color: var(--p-content-hover-background);
}
.canvas-control:focus-visible {
    outline: 2px solid var(--p-primary-color);
    outline-offset: -2px;
}
.zoom-percent {
    min-width: 3.2em;
    text-align: center;
    font-variant-numeric: tabular-nums;
}
</style>
