<template lang="pug">
    .add-element-popover(
        ref="root"
        role="dialog"
        aria-label="Add element"
        :style="position"
        @keydown="keyDown"
    )
        select.popover-filter(
            ref="filter"
            v-model="shownDomain"
            aria-label="Which domain's elements"
            @change="search?.focus()"
        )
            option(v-for="option in domainOptions" :key="option.domain" :value="option.domain") {{ option.label }}
        input.popover-search(
            ref="search"
            type="search"
            placeholder="Search elements"
            aria-label="Search elements"
            :aria-activedescendant="current ? `add-element-${index}` : undefined"
            v-model="query"
        )
        ul.popover-list(role="listbox" aria-label="Elements")
            li.popover-item(
                v-for="(entry, k) in matches"
                :key="entry.id"
                :id="`add-element-${k}`"
                :data-entry-id="entry.id"
                role="option"
                :aria-selected="k === index"
                :class="{ current: k === index }"
                :title="entry.name"
                @pointerenter="index = k"
                @click="pick(entry)"
            )
                img.popover-glyph(:src="entry.imageData" alt="")
                span {{ entry.label }}
            li.popover-empty(v-if="matches.length === 0") No element matches
</template>

<script setup lang="ts">
// The context menu's Add element picker: a search over the palette's entries, opened where the menu was. Up and
// Down move through the matches, Enter or a click places one, and Escape or a click elsewhere closes it.

import * as vue from 'vue'

import { paletteDomains, searchEntries } from '#root/plugins/bondgraph/palette'
import { searchSpatialEntries } from '#root/plugins/drawing/spatial'

import { shownDomain } from './paletteState'

//==============================================================================

const props = defineProps<{
    /** Where to open, in client coordinates */
    at: { x: number, y: number }
}>()

const emit = defineEmits<{
    pick: [entryId: string]
    close: []
}>()

const domainOptions = paletteDomains()

const root = vue.ref<HTMLElement | null>(null)
const filter = vue.ref<HTMLSelectElement | null>(null)
const search = vue.ref<HTMLInputElement | null>(null)
const query = vue.ref('')
const index = vue.ref(0)

// and the spatial ones, whatever the domain
const matches = vue.computed(() => [...searchEntries(query.value, shownDomain.value), ...searchSpatialEntries(query.value)])
const current = vue.computed(() => matches.value[index.value])

vue.watch(matches, () => {
    index.value = 0
})

// Kept inside the window
const size = vue.ref({ width: 0, height: 0 })
const position = vue.computed(() => {
    const left = Math.max(4, Math.min(props.at.x, window.innerWidth - size.value.width - 4))
    const top = Math.max(4, Math.min(props.at.y, window.innerHeight - size.value.height - 4))
    return { left: `${left}px`, top: `${top}px` }
})

function pick(entry: { id: string }) {
    emit('pick', entry.id)
}

function keyDown(event: KeyboardEvent) {
    // The domain dropdown keeps its own arrow keys and Enter
    if (event.target === filter.value && event.key !== 'Escape') {
        return
    }
    const handled = ['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)
    if (event.key === 'ArrowDown') {
        index.value = Math.min(index.value + 1, matches.value.length - 1)
    } else if (event.key === 'ArrowUp') {
        index.value = Math.max(index.value - 1, 0)
    } else if (event.key === 'Enter') {
        if (current.value) {
            pick(current.value)
        }
    } else if (event.key === 'Escape') {
        emit('close')
    }
    if (handled) {
        // The editor's own keys (Escape disarms, Delete deletes) aren't for the picker's
        event.preventDefault()
        event.stopPropagation()
        root.value?.querySelector('.popover-item.current')?.scrollIntoView({ block: 'nearest' })
    }
}

function pointerDownElsewhere(event: PointerEvent) {
    if (root.value && !root.value.contains(event.target as Node)) {
        emit('close')
    }
}

vue.onMounted(async () => {
    await vue.nextTick()
    if (root.value) {
        size.value = { width: root.value.offsetWidth, height: root.value.offsetHeight }
    }
    search.value?.focus()
    document.addEventListener('pointerdown', pointerDownElsewhere, true)
})
vue.onUnmounted(() => {
    document.removeEventListener('pointerdown', pointerDownElsewhere, true)
})
</script>

<style scoped>
.add-element-popover {
    position: fixed;
    z-index: 1100;
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 240px;
    max-height: 340px;
    padding: 6px;
    border: 1px solid var(--editor-border-color);
    border-radius: 6px;
    background-color: var(--p-content-background);
    color: var(--p-text-color);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    font-size: 13px;
}
.popover-filter {
    padding: 2px 4px;
    font-size: 12px;
    border: 1px solid var(--editor-border-color);
    border-radius: 6px;
    background-color: var(--p-content-background);
    color: inherit;
    cursor: pointer;
}
.popover-filter option {
    background-color: var(--p-content-background);
    color: var(--p-text-color);
}
.popover-search {
    padding: 3px 6px;
    border: 1px solid var(--editor-border-color);
    border-radius: 4px;
    background-color: var(--p-content-background);
    color: inherit;
    font-size: 13px;
}
.popover-list {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
}
.popover-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 6px;
    border-radius: 4px;
    cursor: pointer;
}
.popover-item.current {
    background-color: color-mix(in srgb, #2f6fd6 18%, transparent);
}
.popover-glyph {
    height: 20px;
    width: 44px;
    object-fit: contain;
    flex: none;
}
.popover-empty {
    padding: 3px 6px;
    opacity: 0.7;
}
</style>
