<template lang="pug">
    div(
        ref="panelRef"
        :class="panelClasses"
        :style="panelStyle"
    )
        slot
    .ci.tool-button(
        :id="toolId"
        :class="buttonClasses"
        :style="buttonStyle"
        v-tippy="{ content: prompt, placement: 'right' }"
        :aria-label="prompt"
        @click="toolButtonClick"
    )
        component(
            :is="buttonIcon"
            v-if="buttonIcon"
            :size="24"
            stroke-width="1.5"
        )
</template>

<script setup lang="ts">
import * as vue from 'vue'
import * as LucideIcons from '@lucide/vue'

import type { PropertyGroup } from '#root/utils/editor-types'

const props = defineProps<{
    toolId: string
    active?: boolean
    prompt: string
    icon?: string
    image?: string
    modal?: boolean
    type?: string
    panel?: vue.Raw<vue.Component>
}>()

const buttonClasses = vue.computed(() => {
    const classes = []
    if (props.icon && !props.icon.startsWith('lucide-')) {
        classes.push(props.icon)
    }
    if (props.active) {
        classes.push('active')
    }
    if (props.type === 'popover' && props.modal) {
        classes.push('modal')
    }
    if (props.image) {
        classes.push('image')
    }
    return classes.join(' ')
})

const buttonIcon = vue.computed(() => {
    if (props.icon?.startsWith('lucide-')) {
        return (LucideIcons as Record<string, unknown>)[props.icon.slice(7)]
    }
})

const buttonStyle = vue.computed(() => {
    const style = []
    if (props.image) {
        style.push(`background: url("${props.image}");`)
    }
    return style.join(' ')
})

const panelVisible = vue.ref(false)

const panelClasses = vue.computed(() => {
    return [props.type==='panel' ? 'panel' : 'popover', { hidden: !panelVisible.value }]
})

const popoverTop = vue.ref()

const panelStyle = vue.computed(() => {
    if (props.type==='popover') {
       return { top: popoverTop.value }
   }
})

const pointerPos = vue.ref<number>()
vue.provide('pointerPos', vue.readonly(pointerPos))

const panelRef = vue.ref(null)
let panelElement: HTMLElement | null = null

vue.onMounted(() => {
    if (panelRef.value) {
        panelElement = (<HTMLElement>panelRef.value).firstElementChild as HTMLElement
    }
})

// Escape closes a tool's popover, leaving its tool armed
function closePopover() {
    if (props.type === 'popover') {
        panelVisible.value = false
    }
}
vue.onMounted(() => document.addEventListener('close-tool-popover', closePopover))
vue.onUnmounted(() => document.removeEventListener('close-tool-popover', closePopover))

// Make sure popover is closed when button is deactivated
vue.watch(
    () => props.active,
    () => {
        if (!props.active) {
            panelVisible.value = false
        }
    }
)

const emit = defineEmits<{
    'button-event': [
        toolId: string,
        active: boolean,
        panel: vue.Raw<vue.Component> | null
    ]
}>()

async function toolButtonClick(e: MouseEvent) {
    const clickedElement: HTMLElement | null = e.target as HTMLElement
    let target: HTMLElement | null = clickedElement
    while (target && !target.classList.contains('tool-button')) {
        target = target.parentElement
    }
    if (target) {
        if (props.type === 'panel') {
            target.classList.toggle('active')
            if (panelElement) {
                if (panelVisible.value) {
                    panelVisible.value = false
                } else {
                    panelVisible.value = true
                }
            }
        } else {
            // An active tool's button reopens its closed popover
            if (!target.classList.contains('active') || (panelElement && !panelVisible.value)) {
                target.classList.add('active')
                if (panelElement) {
                    if (!panelVisible.value) {
                        panelVisible.value = true

                        // Wait for panel to be rendered before getting its height
                        await vue.nextTick()

                        const popoverHeight = panelElement?.clientHeight
                        let top = target.offsetTop + (target.clientWidth - popoverHeight) / 2
                        pointerPos.value = popoverHeight / 2 - 10 // 10 is half of pointer's height

                        if (top < (20 + window.scrollY)) {
                            // Make sure our top is at least 20px below top containing element
                            const adjustment = (20 + window.scrollY) - top
                            top = (20 + window.scrollY)
                            pointerPos.value -= adjustment
                        }
                        popoverTop.value = `${top}px`
                    }
                }
            }
        }
        emit('button-event', target.id, target.classList.contains('active'), props.panel || null)
    }
}
</script>

<style scoped>
.tool-button {
    border-style: solid;
    border-color: var(--editor-border-color);
    border-width: 0 1px 2px;
    display: grid;
    place-items: center;
}
.tool-button:hover {
    background-color: lightgrey;
}

.tool-button.ci {
    width: 36px !important;
    height: 36px !important;
    scale: 1 !important;
    padding: 0;
    position: relative;
}

.tool-button.image {
    background-size: 100% 100% !important;
}

.tool-button.modal::before {
    display: inline-block;
    position: absolute;
    transform: scale(0.3);
    width: 10px;
    height: 10px;
    top: 22px;
    left: 22px;
}

.tool-button.modal::before {
    content: url("./icons/ModalButtonLight.svg");
}

.celldl-dark-mode .tool-button.modal::before {
    content: url("./icons/ModalButtonDark.svg");
}

.hidden {
    display: none;
}

.panel {
    width: 250px;
    border: 2px solid var(--editor-border-color);
    border-left-width: 1px;
    right: 38px; /* This depends on panel bar width... */
    top: 1.8em;
    bottom: 1.6em;
    position: absolute;
}
.popover {
    position: absolute;
}

.active {
    background-color: #66aaff !important;
}
</style>
