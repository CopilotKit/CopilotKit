<script setup lang="ts">
import { useLayoutContainer } from "./layout";
import type { LayoutContainerProps } from "./layout";

defineOptions({ name: "CopilotGenerativeUIColumn" });

/** A flex column. */
const props = defineProps<LayoutContainerProps>();

const { root, attributes } = useLayoutContainer(props, () => ({
  flexDirection: "column",
}));
</script>

<template>
  <div ref="root" v-bind="attributes"><slot name="children" /></div>
</template>
