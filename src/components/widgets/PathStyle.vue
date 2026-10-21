<template lang="pug">
    .card
        .flexPrompt
            label Path colour
            input.colour#colour(
                type="color"
                :value="stroke.colour"
                @input="colourChange"
            )
        .spacer
        FloatLabel(variant="on")
            InputText(v-model.number="stroke.width")
            Slider(
                v-model="stroke.width"
                :min="minWidth"
                :max="maxWidth"
                :step="widthStep"
                @change="emitChange"
            )
            label Width (px)
        .spacer
        .flexPrompt
            label Dashed:
            Checkbox#gradientCheckbox(
                v-model="stroke.dashed"
                binary
                @change="emitChange"
            )
        Divider
</template>

<script setup lang="ts">
//==============================================================================

import * as vue from 'vue'
import Slider from 'primevue/slider'
import { TinyColor } from '@ctrl/tinycolor'

import { STYLE_STRING_FIELD_SEPARATOR } from '#root/utils/styling'
import { useThemeCssVariables } from '#root/utils/themeCssVariables'

useThemeCssVariables('checkbox')
useThemeCssVariables('floatlabel')
useThemeCssVariables('inputtext')
useThemeCssVariables('slider')

//==============================================================================

const { pathStyle } = defineProps<{ pathStyle: string }>()

const emit = defineEmits(['change'])

//==============================================================================

type StrokeFields = {
    colour?: string
    dashed?: boolean
    width?: number
    dashScale?: number
}

const stroke = vue.ref<StrokeFields>({})

function  makeColour(colour: string): string {
    return new TinyColor(colour).toHexString()
}

function setStroke(strokeStyle: string) {
    const strokeArray: string[] = strokeStyle.split(STYLE_STRING_FIELD_SEPARATOR)
    stroke.value.colour = makeColour((strokeArray.at(0)) as string)
    stroke.value.width = Number((strokeArray.at(1)) as string)
    stroke.value.dashed = strokeArray.at(2) === '1'
    stroke.value.dashScale = Number(strokeArray.at(3) as string)
}

setStroke(pathStyle)

vue.watch(
    () => pathStyle,
    () => setStroke(pathStyle)
)

const minWidth = vue.ref<number>(0.5)
const maxWidth = vue.ref<number>(10)
const widthStep = vue.ref<number>(0.5)

//==============================================================================

function colourChange(e: Event) {
    const target = e.target as HTMLInputElement
    stroke.value.colour = target.value
    emitChange()
}

function emitChange() {
    emit('change', [
        stroke.value.colour,
        String(stroke.value.width),
        stroke.value.dashed ? '1' : '0',
        String(stroke.value.dashScale)
    ].join(STYLE_STRING_FIELD_SEPARATOR))
}
//==============================================================================
</script>

<style>
/* Otherwise the tick mark is not obvious */
.celldl-editor .p-checkbox-checked .p-checkbox-icon {
    color: red !important;
}
</style>

<style scoped>
.flexPrompt {
    display: flex;
    justify-content: space-between;
    margin-bottom: 4px;
}

.spacer {
    height: 20px;
}
/* Based on https://rebeccamdeprey.com/blog/styling-the-html-color-input */

input[type="color" i] {
  inline-size: 24px;
  block-size: 24px;
}

/* Affects area between outer circle and color swatch. Firefox doesn't have an equivalent. */
input[type="color" i]::-webkit-color-swatch-wrapper {
  padding: 1px;
}

/* Affects the inner circle, i.e. the current color selection */
input[type="color" i]::-webkit-color-swatch {
  border-radius: 40%;
}

input[type="color" i]::-moz-color-swatch {
  border-radius: 40%;
}
</style>
