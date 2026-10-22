<template lang="pug">
    .bottom-margin(v-if="possibleValues !== undefined")
        FloatLabel(variant="on")
            Select(
                v-model="discreteValue"
                :options="possibleValues"
                optionLabel="name"
                @change="selectChange"
                class="w-full"
                scrollHeight="400px"
                size="small"
            )
                template(#value="slotProps")
                    span(
                        v-if="slotProps.value"
                        :class="{ emphasise: slotProps.value.emphasise }"
                    ) {{ slotProps.value.name }}
                    span(v-else) {{ slotProps.placeholder }}
                template(#option="slotProps")
                    .flex.items-center
                        span(:class="{ emphasise: slotProps.option.emphasise }") {{ slotProps.option.name }}
            label {{ name }}
    .bottom-margin(v-else-if="scalarType")
        FloatLabel(variant="on")
            InputText(
                :modelValue="scalarValue"
                :readonly="readonly"
                :class="{ 'readonly-value': readonly }"
                :title="readonly ? 'Read-only' : undefined"
                v-keyfilter.num
                v-on:focusout="inputTextFocusOut"
                v-on:keypress="inputTextKeyPress"
                class="w-full"
                size="small"
            )
            label {{ nameUnits }}
    .bottom-margin(v-else)
        FloatLabel(variant="on")
            InputText(
                :modelValue="value"
                :readonly="readonly"
                :class="{ 'readonly-value': readonly }"
                @value-change="inputTextChange"
                class="w-full"
                size="small"
            )
            label {{ name }}
</template>

<script setup lang="ts">
import * as vue from 'vue'
import { useThemeCssVariables } from '#root/utils/themeCssVariables'

useThemeCssVariables('floatlabel')
useThemeCssVariables('inputtext')
useThemeCssVariables('select')

import KeyFilter from 'primevue/keyfilter';
//  v-keyfilter="{ pattern: /^[+-]?((\d+(\.\d*)?)|(\.\d+))([eE][+-]?\d+)?$/, validateOnly: true }"

import type * as locApi from '../../libopencor/locUIJsonApi'

type ValueType = number|string|locApi.IUiJsonDiscreteInputPossibleValue

const inputValue = defineModel<ValueType>({ required: true })

const emits = defineEmits(['change'])

const props = defineProps<{
    name: string
    value: ValueType
    maximumValue?: number
    minimumValue?: number
    itemId: string
    units?: string
    numeric?: boolean
    possibleValues?: locApi.IUiJsonDiscreteInputPossibleValue[]
    stepValue?: number
    stored?: boolean
    /** Shown but not editable */
    readonly?: boolean
}>()

const nameUnits = vue.computed(() => props.units ? `${props.name} (${props.units})` : props.name)

const scalarType = !!props.numeric

// Whether this widget has committed a value, which the object then stores
let committed = false

/** The value the object stores; a shown default that isn't stored has none, so committing it stores it. */
function storedValue(): ValueType|undefined {
    return (props.stored === false && !committed)
         ? undefined
         : (props.possibleValues === undefined)
         ? inputValue.value
         : (inputValue.value as locApi.IUiJsonDiscreteInputPossibleValue)?.value
}

let oldValue = storedValue()

const discreteValue = vue.computed<locApi.IUiJsonDiscreteInputPossibleValue>({
    get() {
        return (inputValue.value as locApi.IUiJsonDiscreteInputPossibleValue)
    },
    set(_: ValueType) {
    }
})

const scalarValue = vue.ref<number>(Number(inputValue.value))
const stringValue = vue.ref<string>(String(inputValue.value))

vue.watch(
    () => [props.value, props.stored],
    () => {
        if (scalarType) {
            scalarValue.value = Number(props.value)
            stringValue.value = String(inputValue.value)
        }
        // The value was set from outside, e.g. by choosing a template
        oldValue = storedValue()
    }
)

// Some methods to handle a scalar value using an input text and a slider.

function emitChange(newValue: number | string) {
    const previousValue = oldValue
    oldValue = newValue
    committed = true
    void vue.nextTick().then(() => {
        if (scalarType && props.possibleValues === undefined) {
            inputValue.value = newValue
            scalarValue.value = <number>newValue
            stringValue.value = String(newValue) // This will properly format the input text.
        }

        emits('change', props.itemId, previousValue, newValue)
    })
}

interface ISelectChangeEvent {
    value: {
        name: string
        value: number
    }
}

function selectChange(event: ISelectChangeEvent) {
    if (event.value.value !== oldValue) {
        emitChange(event.value.value)
        // Show the choice, which a later reload would otherwise replace with the old one
        inputValue.value = event.value
    }
}

function inputTextChange(newValueString: string) {
    if (props.readonly) {
        return
    }
    if (scalarType && newValueString === '') {
        newValueString = String(props.minimumValue)
    }

    if (props.minimumValue !== undefined && Number(newValueString) < props.minimumValue) {
        newValueString = String(props.minimumValue)
    }

    if (props.maximumValue !== undefined && Number(newValueString) > props.maximumValue) {
        newValueString = String(props.maximumValue)
    }

    const newValue = scalarType ? Number(newValueString) : newValueString

    if (newValue !== oldValue) {
        emitChange(newValue)
    }
}

function inputTextFocusOut(event: Event) {
    inputTextChange((event.target as HTMLInputElement).value)
}

function inputTextKeyPress(event: KeyboardEvent) {
    if (event.key === 'Enter') {
        inputTextChange((event.target as HTMLInputElement).value)
    }
}
</script>

<style scoped>
    .bottom-margin {
        margin-bottom: 30px;
    }
    .readonly-value {
        background: var(--p-inputtext-disabled-background);
        color: var(--p-inputtext-disabled-color);
        border-style: dashed;
        cursor: default;
    }
    .emphasise {
        font-style: italic;
    }
</style>
