<template lang="pug">
    Card.left-popover(
        :class="{ 'no-gap': !hasTitle, showtip: showtip }"
        :data-tip-top="pointerPos"
    )
        template(#title)
            div(v-if="hasTitle")
                slot(name="title")
        template(#content)
            slot(name="content")
</template>

<script setup lang="ts">
import * as vue from 'vue'
import { useThemeCssVariables } from '#root/utils/themeCssVariables'

useThemeCssVariables('card')

const slots = vue.useSlots()

const hasTitle = vue.computed(() => !!slots.title);

const pointerPos = vue.inject<vue.DeepReadonly<number>>('pointerPos')

// Don't show a wrongly positioned tooltip in Firefox
const showtip = vue.ref()
showtip.value = true //CSS.supports("x: attr(x type(*))")
</script>

<style>
.celldl-editor .p-card.no-gap > .p-card-body {
    gap: 0px !important;
}
</style>

<style scoped>
.left-popover {
    position: absolute;
    margin-left: 36px;
    z-index: 100;
    border: 1px solid grey;
}

.left-popover.showtip::before {
    display: inline-block;
    position: absolute;
    width: 20px;
    left: -16px;
    top: attr(data-tip-top px);
    z-index: 99;
}

.left-popover.showtip::before {
    content: url("./icons/LeftPanelArrowLight.svg");
}

.celldl-dark-mode .left-popover.showtip::before {
    content: url("./icons/LeftPanelArrowDark.svg");
}

</style>
