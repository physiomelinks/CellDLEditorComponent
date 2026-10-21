<template lang="pug">
    .card
        .flexPrompt
            label Gradient fill:
            Checkbox#gradientCheckbox(
                v-model="fill.gradientFill"
                @change="gradientFillChange"
                binary
            )
        Divider
        .flexPrompt
            label {{ fill.startPrompt }}:
            input.colour#startColour(
                type="color"
                :value="fill.startColour"
                @input="colourChange"
            )
        Button#swapButton(
            icon="pi pi-sort-alt"
            variant="text"
            aria-label="Swap colours"
            size="small"
            :class="{ hidden: !fill.gradientFill }"
            @click="swapColours"
        )
        .flexPrompt(:class="{ hidden: !fill.gradientFill }")
            label Stop colour:
            input.colour#stopColour(
                type="color"
                :value="fill.stopColour"
                @input="colourChange"
            )
        Divider(:class="{ hidden: !fill.gradientFill }")
        .flexPrompt(:class="{ hidden: !fill.gradientFill }")
            label Middle colour:
            Checkbox#middleCheckbox(
                v-model="fill.middleEnabled"
                @change="enableMiddle"
                binary
            )
            input.colour#middleColour(
                type="color"
                :value="fill.middleColour"
                @input="colourChange"
            )
        Divider(:class="{ hidden: !fill.gradientFill }")
        .flexPrompt(:class="{ hidden: !fill.gradientFill }")
            label Direction:
            #directions
                .flex.items-right.gap-2
                    label.dirn H
                    RadioButton#horizontal(
                        v-model="fill.gradientDirn"
                        inputId="horizontal"
                        name="dirn"
                        value="H"
                        @change="emitChange"
                    )
                .flex.items-right.gap-2
                    label.dirn V
                    RadioButton#vertical(
                        v-model="fill.gradientDirn"
                        inputId="vertical"
                        name="dirn"
                        value="V"
                        @change="emitChange"
                    )
        Divider
        // middle colour??
</template>

<script setup lang="ts">
//==============================================================================

import * as vue from 'vue'
import { TinyColor } from '@ctrl/tinycolor'

import { STYLE_STRING_FIELD_SEPARATOR } from '#root/utils/styling'
import { useThemeCssVariables } from '#root/utils/themeCssVariables'

useThemeCssVariables('button')
useThemeCssVariables('checkbox')
useThemeCssVariables('divider')
useThemeCssVariables('radiobutton')

//==============================================================================

const { fillStyle } = defineProps<{ fillStyle: string }>()

const emit = defineEmits(['change'])

//==============================================================================

type FillFields = {
    startPrompt?: string
    startColour?: string
    middleEnabled?: boolean
    middleColour?: string
    stopColour?: string
    gradientDirn?: string
    gradientFill?: boolean
}

const fill = vue.ref<FillFields>({})

function  makeColour(colour: string): string {
    return new TinyColor(colour).toHexString()
}

function setFill(fillStyle: string) {
    const fillArray: string[] = fillStyle.split(STYLE_STRING_FIELD_SEPARATOR)
    fill.value.startPrompt = fillArray.length > 1 ? 'Start colour' : 'Fill colour'
    fill.value.startColour = makeColour((fillArray.length > 1 ? fillArray.at(1) : fillArray.at(0)) as string)
    fill.value.middleEnabled = fillArray.length > 3
    fill.value.middleColour = makeColour((fillArray.length > 3 ? fillArray.at(2) : 'white') as string)
    fill.value.stopColour = makeColour((fillArray.length > 1 ? fillArray.at(-1) : fillArray.at(0)) as string)
    fill.value.gradientFill = fillArray.length > 1
    fill.value.gradientDirn = fillArray.length > 1 ? fillArray.at(0) : 'H'
}

setFill(fillStyle)

vue.watch(
    () => fillStyle,
    () => setFill(fillStyle)
)

//==============================================================================

function colourChange(e: Event) {
    const target = e.target as HTMLInputElement
    if (target.id === 'startColour') {
        fill.value.startColour = target.value
    } else if (target.id === 'stopColour') {
        fill.value.stopColour = target.value
    } else if (target.id === 'middleColour') {
        fill.value.middleColour = target.value
    }
    emitChange()
}

function enableMiddle(e: Event) {
    emitChange()
}

function gradientFillChange(e: Event) {
    const target = e.target as HTMLInputElement
    if (target.checked) {
        fill.value.startPrompt = 'Start colour'
        fill.value.gradientFill = true
    } else {
        fill.value.startPrompt = 'Fill colour'
        fill.value.gradientFill = false
    }
    emitChange()
}

function swapColours(_e: Event) {
    const stopColour = fill.value.stopColour
    fill.value.stopColour = fill.value.startColour
    fill.value.startColour = stopColour
    emitChange()
}

function emitChange() {
    if (fill.value.gradientFill) {
        const fillString = [
            fill.value.gradientDirn,
            fill.value.startColour
        ]
        if (fill.value.middleEnabled) {
            fillString.push(fill.value.middleColour)
        }
        fillString.push(fill.value.stopColour)
        emit('change', fillString.join(STYLE_STRING_FIELD_SEPARATOR))
    } else {
        emit('change', fill.value.startColour)
    }
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

#gradientCheckbox {
    margin-right: 3px;
}
#swapButton {
    padding: 0;
}
#directions {
    display: flex;
    flex-direction: column;
}

.hidden {
    display: none;
}

.spacer {
    height: 20px;
}

.dirn {
    margin-right: 16px;
}

#middleCheckbox {
  margin-left: auto;
  margin-right: 10px;
}

/* Based on https://rebeccamdeprey.com/blog/styling-the-html-color-input */

input[type="color" i] {
  inline-size: 20px;
  block-size: 20px;
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
