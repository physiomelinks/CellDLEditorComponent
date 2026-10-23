<template lang="pug">
    .right-panel
        ScrollPanel(class="h-full")
            .panel-title
                slot(name="title")
            .panel-content
                slot(name="content")
</template>

<script setup lang="ts">
import { useThemeCssVariables } from '#root/utils/themeCssVariables'

// The panel is styled with the card's tokens, which are otherwise only defined
// once a tool popover's Card mounts (never when the left toolbar is hidden)
useThemeCssVariables('card')
useThemeCssVariables('scrollpanel')
</script>

<style scoped>
.right-panel {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--p-card-background, var(--p-content-background, #ffffff));
    color: var(--p-card-color, var(--p-content-color, inherit));
    padding: var(--p-card-body-padding, 1.25rem);
    gap: var(--p-card-caption-gap, 0.5rem);
}

.panel-title {
    font-size: var(--p-card-title-font-size, 1.25rem);
    font-weight: var(--p-card-title-font-weight, 500);
    margin-bottom: 20px;
}

.panel-content {
    flex: 1;
}
</style>
