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
        //- Drawn boxes, which aren't any domain's, so shown whatever the filter. Icons only, named by their
        //- tooltips and aria-labels, so they take little width.
        .palette-group.spatial(role="group" aria-label="Spatial")
            span.palette-group-label Spatial
            .palette-tiles
                .palette-tile.icon-only(
                    v-for="entry in SPATIAL_ENTRIES"
                    :key="entry.id"
                    :data-entry-id="entry.id"
                    :class="{ armed: entry.id === armedId }"
                    role="button"
                    tabindex="0"
                    :aria-label="entry.name"
                    :aria-pressed="entry.id === armedId"
                    v-tippy="{ content: entry.name, placement: layout === 'left' ? 'right' : 'bottom' }"
                    draggable="true"
                    @dragstart="spatialDragStart($event, entry)"
                    @click="toggleSpatial(entry)"
                    @keydown.enter.prevent="toggleSpatial(entry)"
                    @keydown.space.prevent="toggleSpatial(entry)"
                )
                    img.palette-glyph(:src="entry.imageData" alt="" draggable="false")
        //- Whether new bonds are signal bonds (dashed, carrying a variable to a signal input or a parameter's scale)
        //- rather than power bonds; a bond to or from a signal block is always a signal bond
        .palette-group.bonds(role="group" aria-label="Bonds")
            span.palette-group-label Bonds
            .palette-tiles
                .palette-tile.icon-only.signal-toggle(
                    id="signal-bond-toggle"
                    :class="{ armed: signalBonds }"
                    role="switch"
                    tabindex="0"
                    aria-label="Draw signal bonds"
                    :aria-checked="signalBonds"
                    v-tippy="{ content: signalBonds ? 'Drawing signal bonds: click to draw power bonds' : 'Drawing power bonds: click to draw signal bonds', placement: layout === 'left' ? 'right' : 'bottom' }"
                    @click="toggleSignalBonds()"
                    @keydown.enter.prevent="toggleSignalBonds()"
                    @keydown.space.prevent="toggleSignalBonds()"
                )
                    svg.palette-glyph(viewBox="0 0 40 20" width="40" height="20" aria-hidden="true")
                        line(x1="3" y1="10" x2="31" y2="10" stroke="currentColor" stroke-width="2" stroke-dasharray="5 3")
                        polygon(points="30,5 38,10 30,15" fill="currentColor")
                    span.palette-label Signal
</template>

<script setup lang="ts">
// The element palette: a labelled tile for each element, dragged onto the canvas or clicked to arm it (clicks on
// the canvas then place it, until Escape or a click on the tile again). It sits beside the canvas, never over it.

import * as vue from 'vue'

import { type PaletteEntry, paletteDomains, paletteEntries } from '#root/plugins/bondgraph/palette'

import { type SpatialEntry, spatialEntries } from '#root/plugins/drawing/spatial'
import { drawSignalBonds } from '#root/plugins/bondgraph/signals'

import { armEntry, armSpatial, disarm, entryEventDetails, shownDomain, spatialEventDetails } from './paletteState'

//==============================================================================

defineProps<{
    layout: 'top' | 'left'
}>()

const domainOptions = paletteDomains()

const entries = vue.computed(() => paletteEntries(shownDomain.value))

const SPATIAL_ENTRIES = spatialEntries()

const signalBonds = vue.computed(() => drawSignalBonds.value)

function toggleSignalBonds() {
    drawSignalBonds.value = !drawSignalBonds.value
}

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

function toggleSpatial(entry: SpatialEntry) {
    if (armedId.value === entry.id) {
        disarm()
    } else {
        armSpatial(entry)
        armedId.value = entry.id
    }
}

// The editor has left adding (Escape, another tool), or another tool's template is armed. Drawing boxes keeps a
// spatial tile armed while it's that tile's kind they draw.
function editorModeEvent(event: Event) {
    const { mode, spatialKind } = (<CustomEvent>event).detail
    const armedKind = SPATIAL_ENTRIES.find(entry => entry.id === armedId.value)?.kind
    if (mode === 'DRAW-COMPARTMENT' ? spatialKind !== armedKind : mode !== 'ADD-COMPONENT') {
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
    startDrag(event, entry.id, entryEventDetails(entry))
}

function spatialDragStart(event: DragEvent, entry: SpatialEntry) {
    startDrag(event, entry.id, spatialEventDetails(entry))
}

function startDrag(event: DragEvent, entryId: string, details: object) {
    if (!event.dataTransfer) {
        return
    }
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData('text/plain', JSON.stringify(details))
    const glyph = (event.currentTarget as HTMLElement).querySelector('img')
    if (glyph) {
        event.dataTransfer.setDragImage(glyph, glyph.width / 2, glyph.height / 2)
    }
    // Lets the canvas accept the drop
    document.dispatchEvent(new CustomEvent('component-drag', {
        detail: { type: 'dragstart', source: 'element-palette', value: entryId }
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
/* The domain's tiles scroll, so the spatial ones stay in view however many there are */
.element-palette.top > .palette-tiles {
    flex: 1 1 auto;
    min-width: 0;
    overflow-x: auto;
}
.element-palette.left > .palette-tiles {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
}
.palette-group {
    display: flex;
    flex: none;
    align-items: center;
    gap: 4px;
}
.element-palette.top .palette-group {
    flex-direction: row;
    padding-left: 6px;
    border-left: 1px solid var(--editor-border-color);
}
.element-palette.left .palette-group {
    flex-direction: column;
    padding-top: 6px;
    border-top: 1px solid var(--editor-border-color);
}
.element-palette.left .palette-group .palette-tiles {
    flex-direction: column;
}
.palette-group-label {
    color: var(--p-text-muted-color);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
}
.element-palette.top .palette-group-label {
    writing-mode: vertical-rl;
    transform: rotate(180deg);
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
.palette-tile.icon-only {
    min-width: 0;
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
