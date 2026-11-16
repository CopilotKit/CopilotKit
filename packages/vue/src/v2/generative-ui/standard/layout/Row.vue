<script setup lang="ts">
import { spacing } from "@copilotkit/shared/generative-ui";
import { hasGap, useLayoutContainer } from "./layout";
import type { LayoutContainerProps } from "./layout";

defineOptions({ name: "CopilotGenerativeUIRow" });

/**
 * A flex row. Its children are centered on the cross axis, 8px apart.
 * `data-a2ui-row` carries `justify`, so the standard stylesheet can align
 * the last text of a "spaceBetween" row to the right.
 */
const props = defineProps<LayoutContainerProps>();

const { root, attributes } = useLayoutContainer(props, (row) => ({
  flexDirection: "row",
  alignItems: row.align ? undefined : "center",
  gap: hasGap(row) ? undefined : spacing(2),
}));
</script>

<template>
  <div ref="root" v-bind="attributes" :data-a2ui-row="props.justify ?? 'start'">
    <slot name="children" />
  </div>
</template>
