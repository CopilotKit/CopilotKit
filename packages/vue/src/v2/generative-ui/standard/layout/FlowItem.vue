<script setup lang="ts">
import type { flowItemSchema } from "@copilotkit/shared/generative-ui";
import type { z } from "zod";
import { useLayoutContainer } from "./layout";
import type { LayoutContainerProps } from "./layout";

defineOptions({ name: "CopilotGenerativeUIFlowItem" });

type FlowItemProps = z.output<typeof flowItemSchema>;

/** A tile of a Flow, square unless it sets `aspectRatio`. */
const props = defineProps<
  LayoutContainerProps & {
    span?: FlowItemProps["span"];
    rowSpan?: FlowItemProps["rowSpan"];
    aspectMode?: FlowItemProps["aspectMode"];
  }
>();

const { root, attributes } = useLayoutContainer(props, (item) => ({
  gridColumn: item.span ? `span ${item.span}` : undefined,
  gridRow: item.rowSpan ? `span ${item.rowSpan}` : undefined,
  flexDirection: "column",
  aspectRatio: item.aspectRatio ?? "1 / 1",
}));
</script>

<template>
  <div ref="root" v-bind="attributes"><slot name="children" /></div>
</template>
