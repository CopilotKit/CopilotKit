<script setup lang="ts">
import { spacing } from "@copilotkit/shared/generative-ui";
import type { flowSchema } from "@copilotkit/shared/generative-ui";
import type { z } from "zod";
import { gridTemplateColumns, useLayoutContainer } from "./layout";
import type { LayoutContainerProps } from "./layout";

defineOptions({ name: "CopilotGenerativeUIFlow" });

type FlowProps = z.output<typeof flowSchema>;

/** A dense grid of tiles, 3 columns by default. */
const props = defineProps<
  LayoutContainerProps & {
    columns?: FlowProps["columns"];
    rows?: FlowProps["rows"];
    layout?: FlowProps["layout"];
  }
>();

const { root, attributes } = useLayoutContainer(props, (flow) => ({
  display: "grid",
  gap: spacing(flow.gap ?? 4),
  gridTemplateColumns: gridTemplateColumns({
    columns: flow.columns ?? 3,
    gap: flow.gap ?? 4,
  }),
  gridAutoFlow: flow.layout === "fixed" ? "row" : "dense",
}));
</script>

<template>
  <div ref="root" v-bind="attributes"><slot name="children" /></div>
</template>
