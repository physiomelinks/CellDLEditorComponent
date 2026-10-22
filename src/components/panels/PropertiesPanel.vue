<template lang="pug">
    ToolPanel
        template(#title)
            div {{ title }}
        template(#content)
            div(
                v-if="!properties.objectId"
            ) Please select a single element or path.
            template(
                v-else
            )
                //- Keyed by the object, so each selection gets fresh widgets rather than the last one's state
                .group(
                    v-for="group in properties.groups"
                    :key="`${properties.objectId}/${group.groupId}`"
                )
                    InputWidget(
                        v-for="item in group.items"
                        :key="`${properties.objectId}/${item.itemId}`"
                        v-model="item.value"
                        :itemId="item.itemId"
                        :name="item.name"
                        :value="item.value"
                        :units="item.units"
                        :numeric="item.numeric"
                        :maximumValue="item.maximumValue"
                        :minimumValue="item.minimumValue"
                        :possibleValues="item.possibleValues"
                        :stepValue="item.stepValue"
                        :stored="item.stored"
                        @change="updateProperties"
                    )
</template>
<script setup lang="ts">
import * as vue from 'vue'
import { useThemeCssVariables } from '#root/utils/themeCssVariables'

useThemeCssVariables('accordion')
useThemeCssVariables('accordioncontent')
useThemeCssVariables('accordioncontent')
useThemeCssVariables('accordionpanel')

import type { ComponentProperties } from '#root/utils/editor-types'

import InputWidget from '../widgets/InputWidget.vue'

import ToolPanel from './ToolPanel.vue'

const props = defineProps<{
    title: string
    toolId: string
}>()

const properties = vue.inject<vue.Ref<ComponentProperties>>(`${props.toolId}-componentProperties`)

const disabled = vue.ref<boolean>(properties?.value ? !properties.value.objectId : true)

vue.watch(
    () => properties?.value,
    (newValue) => {
        disabled.value = !newValue?.objectId
    },
    { deep: true }
)

const emit = defineEmits(['panel-event'])

function updateProperties(itemId: string, oldValue: number | string, newValue: number | string) {
    vue.nextTick().then(() => {
        emit('panel-event', props.toolId, itemId, oldValue, newValue)
    })
}
</script>

<style>
/* Allow for FloatLabel text of InputWidget */
.celldl-editor .p-accordioncontent-content {
    padding-top: 8px !important;
}
</style>
