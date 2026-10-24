<template lang="pug">
    .element-palette(:class="layout" role="toolbar" aria-label="Elements")
        select.palette-filter(v-model="shownDomain" aria-label="Which domain's elements")
            option(v-for="option in domainOptions" :key="option.domain" :value="option.domain") {{ option.label }}
        .palette-tiles
            .palette-tile(
                v-for="entry in entries"
                :key="entry.id"
                :data-entry-id="entry.id"
                :class="{ armed: entry.id === armedId }"
                role="button"
                tabindex="0"
                :aria-label="entry.name"
                :aria-pressed="entry.id === armedId"
                v-tippy="{ content: entry.name, placement: layout === 'left' ? 'right' : 'bottom' }"
                draggable="true"
                @dragstart="dragStart($event, entry)"
                @click="toggleArmed(entry)"
                @keydown.enter.prevent="toggleArmed(entry)"
                @keydown.space.prevent="toggleArmed(entry)"
            )
                img.palette-glyph(:src="entry.imageData" alt="" draggable="false")
                span.palette-label {{ entry.label }}
</template>

<script setup lang="ts">
// The element palette: a labelled tile for each element, dragged onto the canvas or clicked to arm it (clicks on
// the canvas then place it, until Escape or a click on the tile again). It sits beside the canvas, never over it.

import * as vue from 'vue'

import { type PaletteEntry, paletteDomains, paletteEntries } from '#root/plugins/bondgraph/palette'

import { armEntry, disarm, entryEventDetails, shownDomain } from './paletteState'

//==============================================================================

defineProps<{
    layout: 'top' | 'left'
}>()

const domainOptions = paletteDomains()

const entries = vue.computed(() => paletteEntries(shownDomain.value))

//==============================================================================

const armedId = vue.ref<string | null>(null)

function toggleArmed(entry: PaletteEntry) {
    if (armedId.value === entry.id) {
        disarm()
    } else {
        armEntry(entry)
        armedId.value = entry.id
    }
}

// The editor has left adding (Escape, another tool), or another tool's template is armed
function editorModeEvent(event: Event) {
    if ((<CustomEvent>event).detail.mode !== 'ADD-COMPONENT') {
        armedId.value = null
    }
}

function componentSelectedEvent(event: Event) {
    const entryId = (<CustomEvent>event).detail?.entryId
    if (entryId !== armedId.value) {
        armedId.value = entryId ?? null
    }
}

vue.onMounted(() => {
    document.addEventListener('editor-mode', editorModeEvent)
    document.addEventListener('component-selected', componentSelectedEvent)
})
vue.onUnmounted(() => {
    document.removeEventListener('editor-mode', editorModeEvent)
    document.removeEventListener('component-selected', componentSelectedEvent)
})

//==============================================================================

function dragStart(event: DragEvent, entry: PaletteEntry) {
    if (!event.dataTransfer) {
        return
    }
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData('text/plain', JSON.stringify(entryEventDetails(entry)))
    const glyph = (event.currentTarget as HTMLElement).querySelector('img')
    if (glyph) {
        event.dataTransfer.setDragImage(glyph, glyph.width / 2, glyph.height / 2)
    }
    // Lets the canvas accept the drop
    document.dispatchEvent(new CustomEvent('component-drag', {
        detail: { type: 'dragstart', source: 'element-palette', value: entry.id }
    }))
}
</script>

<style scoped>
.element-palette {
    display: flex;
    gap: 6px;
    padding: 4px 6px;
    background-color: var(--p-content-background);
    color: var(--p-text-color);
    border: 1px solid var(--editor-border-color);
    font-size: 11px;
    line-height: 1.2;
    user-select: none;
}
.element-palette.top {
    flex-direction: row;
    align-items: center;
    border-bottom: none;
    overflow-x: auto;
    overflow-y: hidden;
}
.element-palette.left {
    flex-direction: column;
    width: 92px;
    flex: none;
    overflow-y: auto;
    border-right: none;
}
.palette-filter {
    flex: none;
    padding: 2px 4px;
    font-size: 11px;
    border: 1px solid var(--editor-border-color);
    border-radius: 6px;
    background-color: var(--p-content-background);
    color: inherit;
    cursor: pointer;
}
.palette-filter option {
    background-color: var(--p-content-background);
    color: var(--p-text-color);
}
.palette-tiles {
    display: flex;
    gap: 4px;
}
.element-palette.top .palette-tiles {
    flex-direction: row;
}
.element-palette.left .palette-tiles {
    flex-direction: column;
}
.palette-tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    flex: none;
    min-width: 64px;
    max-width: 84px;
    padding: 3px 4px;
    border: 1px solid transparent;
    border-radius: 6px;
    cursor: grab;
    text-align: center;
}
.palette-tile:hover,
.palette-tile:focus-visible {
    border-color: var(--editor-border-color);
    background-color: var(--p-content-hover-background);
    outline: none;
}
.palette-tile.armed {
    border-color: #2f6fd6;
    background-color: color-mix(in srgb, #2f6fd6 15%, transparent);
}
.palette-glyph {
    height: 26px;
    max-width: 76px;
    pointer-events: none;
}
.palette-label {
    white-space: normal;
}
</style>
