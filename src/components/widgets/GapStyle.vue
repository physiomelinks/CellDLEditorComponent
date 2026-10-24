<template lang="pug">
    .card
        FloatLabel(variant="on")
            InputText(v-model.number="gap")
            Slider(
                v-model="gap"
                :min="minGap"
                :max="maxGap"
                :step="gapStep"
                @change="slide"
                @slideend="slideCommit"
                @click="slideCommit"
                @keyup="slideCommit"
            )
            label Membrane gap (px)
        Divider
</template>

<script setup lang="ts">
//==============================================================================

import * as vue from 'vue'
import Slider from 'primevue/slider'

import { STYLE_STRING_FIELD_SEPARATOR } from '#root/utils/styling'
import { useThemeCssVariables } from '#root/utils/themeCssVariables'

useThemeCssVariables('floatlabel')
useThemeCssVariables('slider')

const { gapStyle } = defineProps<{ gapStyle: string }>()

const emit = defineEmits(['change'])

const gap = vue.ref<number>(0)

function setGap(gapStyle: string) {
    gap.value = Number(gapStyle.split(STYLE_STRING_FIELD_SEPARATOR).at(0) as string)
}

setGap(gapStyle)

vue.watch(
    () => gapStyle,
    () => setGap(gapStyle)
)

const minGap = vue.ref<number>(0)
const maxGap = vue.ref<number>(8)
const gapStep = vue.ref<number>(0.5)

// The slider's changes are `live` while it is dragged or stepped; a drag's end,
// a click or a key's release commits them, but only a slide's: focus stays on
// the slider, so the release of e.g. the undo key mustn't record a step.
let sliding = false

function slide() {
    sliding = true
    emitChange(true)
}

function slideCommit() {
    if (sliding) {
        sliding = false
        emitChange()
    }
}

function emitChange(live: boolean = false) {
    emit('change', String(gap.value), live)
}

//==============================================================================
</script>

<style scoped>
.flexPrompt {
    display: flex;
    justify-content: space-between;
    margin-bottom: 4px;
}
</style>
