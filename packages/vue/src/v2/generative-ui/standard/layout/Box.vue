<script setup lang="ts">
import type { boxSchema } from "@copilotkit/shared/generative-ui";
import type { z } from "zod";
import { innerPanelStyle, useLayoutContainer } from "./layout";
import type { LayoutContainerProps } from "./layout";

defineOptions({ name: "CopilotGenerativeUIBox" });

/**
 * A flex column, or a row with `direction: "row"`. A bordered Box inside a
 * Card becomes the inner panel, not a 1px box.
 */
const props = defineProps<
  LayoutContainerProps & {
    direction?: z.output<typeof boxSchema>["direction"];
  }
>();

const { root, attributes } = useLayoutContainer(props, (box, nested) => ({
  flexDirection: box.direction === "row" ? "row" : "column",
  ...(nested && box.border ? innerPanelStyle(box) : {}),
}));
</script>

<template>
  <div ref="root" v-bind="attributes"><slot name="children" /></div>
</template>
