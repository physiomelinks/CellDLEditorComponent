<template lang="pug">
    ToolPopover(ref="popover")
        template(#title)
            .font-bold Bond graph tools
        template(#content)
            .text-xl Add component:
            .component-library
                .icons
                    img.icon(
                        v-for="toolDefn in componentDefns"
                        :class="{ selected: toolDefn.selected }"
                        :id="toolDefn.id"
                        :src="toolDefn.imageData"
                        :aria-label="toolDefn.name"
                        v-tippy="{ content: toolDefn.name, placement: 'right' }"
                        draggable="true"
                        @dragstart="dragStartEvent"
                        @mousedown="selectionEvent"
                    )
            .text-xl Draw bond:
            .icons.packed
                .icon.ci(
                    v-for="toolDefn in pathStyleDefns"
                    :class="[ toolDefn.icon, { selected: toolDefn.selected } ]"
                    :id="toolDefn.id"
                    :aria-label="toolDefn.name"
                    v-tippy="{ content: toolDefn.name, placement: 'right' }"
                    @mousedown="selectionEvent"
                )
            label.signal-bonds
                input#bondgraph-signal-bonds(type="checkbox" :checked="signalBonds" @change="toggleSignalBonds")
                |  Signal bonds (dashed, from a variable to a signal input or a parameter)
</template>

<script setup lang="ts">
import * as vue from 'vue'
import { type MaybeComputedElementRef, useElementVisibility } from '@vueuse/core'

//==============================================================================

import { type LibraryComponentTemplate, getTemplateEventDetails } from '#editor/components'
import { CONNECTION_STYLE_DEFINITIONS } from '#editor/connections'
import ToolPopover from '#root/components/toolbar/ToolPopover.vue'
import { componentLibraryPlugin } from '#root/plugins'

import { PLUGIN_ID } from '.'
import { drawSignalBonds } from './signals'

//==============================================================================

const props = defineProps<{
    toolId: string
}>()

//==============================================================================

// Helper utilities

function toolId(componentId: string): string {
    return `${PLUGIN_ID}/${componentId}`
}

function componentId(toolId: string): string {
    const prefix = `${PLUGIN_ID}/`
    if (toolId.startsWith(prefix)) {
        return toolId.slice(prefix.length)
    }
    return toolId
}

//==============================================================================

// What we show in the Vue component

type BondgraphTool = {
    id: string
    mode: string,
    name: string
    icon?: string
    imageData?: string
    selected?: boolean
}

const toolDefinitions = vue.ref<BondgraphTool[]>([])

// Whether new bonds are signal bonds, as the element palette's Signal toggle also sets
const signalBonds = vue.computed(() => drawSignalBonds.value)

function toggleSignalBonds() {
    drawSignalBonds.value = !drawSignalBonds.value
}

//==============================================================================

const idToComponent: Map<string, LibraryComponentTemplate> = new Map()
const idToToolDefinition: Map<string, BondgraphTool> = new Map()

let activeId: string | undefined

//==============================================================================

const bondgraphPlugin = componentLibraryPlugin.getPlugin(PLUGIN_ID)
if (bondgraphPlugin) {
    const library = bondgraphPlugin.componentLibrary
    library.templates.forEach((template: LibraryComponentTemplate) => {
        const id = toolId(template.id)
        idToComponent.set(id, template)
        toolDefinitions.value.push({
            id,
            name: template.name,
            mode: 'component',
            imageData: template.imageData,
            selected: false
        })
        const tool = toolDefinitions.value.at(-1) as BondgraphTool
        idToToolDefinition.set(id, tool)
    })
}
for (const styleDefinition of CONNECTION_STYLE_DEFINITIONS) {
    const id = toolId(styleDefinition.id)
    toolDefinitions.value.push({
        id,
        name: styleDefinition.name,
        mode: 'path',
        icon: styleDefinition.icon,
        selected: false
    })
    const tool = toolDefinitions.value.at(-1) as BondgraphTool
    idToToolDefinition.set(id, tool)
}

const componentDefns = vue.computed(() => {
    return toolDefinitions.value.filter(defn => defn.mode === 'component')
})

const pathStyleDefns = vue.computed(() => {
    return toolDefinitions.value.filter(defn => defn.mode === 'path')
})

//==============================================================================

function emitElementActiveEvent(element: HTMLImageElement) {
    const component = idToComponent.get(element.id)
    if (component) {
        // Tell the editor that a BG template has been selected
        document.dispatchEvent(
            new CustomEvent('component-selected', {
                detail: getTemplateEventDetails(element.id, element, null)
            })
        )
    } else {
        // Tell the editor that a path style has been selected
        document.dispatchEvent(
            new CustomEvent('connection-style', {
                detail: {
                    style: componentId(element.id)
                }
            })
        )
    }
}

//==============================================================================

const popover = vue.useTemplateRef('popover') as MaybeComputedElementRef
const isVisible = useElementVisibility(popover)

// Trigger your event when visibility changes
vue.watch(isVisible, (nowVisible) => {
  if (nowVisible && activeId) {
        const activeElement = document.getElementById(activeId) as HTMLImageElement
        if (activeElement) {
            emitElementActiveEvent(activeElement)
        }
    }
})

function selectionEvent(e: MouseEvent) {
    const target = e.target as HTMLImageElement
    const tool = idToToolDefinition.get(target.id)
    if (target.id && tool) {
        if (activeId && idToToolDefinition.has(activeId)) {
            // biome-ignore lint/style/noNonNullAssertion: idToComponent.has(activeId)
            idToToolDefinition.get(activeId)!.selected = false
        }
        tool.selected = true
        activeId = target.id
        emitElementActiveEvent(target)
    }
}

function dragStartEvent(e: DragEvent) {
    const target = e.target as HTMLImageElement
    e.dataTransfer?.items.add(JSON.stringify(getTemplateEventDetails(target.id, target, e)), 'text/plain')
    document.dispatchEvent(
        new CustomEvent('component-drag', {
            detail: {
                type: 'dragstart',
                source: props.toolId,
                value: target.id
            }
        })
    )
}

//==============================================================================
</script>

<style scoped>
.component-library
{
    width: 160px;
    display: flex;
    flex-direction: column;
    border: var(--p-accordion-header-border-width) solid var(--p-content-border-color);
    padding-bottom: 12px;
}
.title {
    padding: 2px;
    padding-top: 6px;
    font-size: var(--p-card-title-font-size);
    font-weight: var(--p-card-title-font-weight);
}
.icons
{
    display: flex;
    flex-wrap: wrap;
    align-items: start;
    justify-content: space-between;
    gap: 3px;
    overflow-y: auto;
    margin: 1px;
}
.icons.packed {
    justify-content: flex-start;
}
.icon
{
    width: 45px;
    height: 45px;
    border: 1px solid lightgrey;
    background-color: var(--p-content-background);
    margin: 0;
    padding: 2px;
}
.icon:hover {
    background-color: lightgrey;
}
.icon.selected
{
    background-color: #66aaff;
    border: 4px solid blue;
}
</style>
