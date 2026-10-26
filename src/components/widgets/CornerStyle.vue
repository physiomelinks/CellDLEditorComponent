<template lang="pug">
    .card
        FloatLabel(variant="on")
            InputText(v-model.number="radius")
            Slider(
                v-model="radius"
                :min="minRadius"
                :max="maxRadius"
                :step="radiusStep"
                @change="slide"
                @slideend="slideCommit"
                @click="slideCommit"
                @keyup="slideCommit"
            )
            label Corner radius (px)
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

const { cornerStyle } = defineProps<{ cornerStyle: string }>()

const emit = defineEmits(['change'])

const radius = vue.ref<number>(0)

function setRadius(cornerStyle: string) {
    radius.value = Number(cornerStyle.split(STYLE_STRING_FIELD_SEPARATOR).at(0) as string)
}

setRadius(cornerStyle)

vue.watch(
    () => cornerStyle,
    () => setRadius(cornerStyle)
)

const minRadius = vue.ref<number>(0)
const maxRadius = vue.ref<number>(80)
const radiusStep = vue.ref<number>(1)

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
    emit('change', String(radius.value), live)
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
