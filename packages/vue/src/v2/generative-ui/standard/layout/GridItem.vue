<script setup lang="ts">
import { computed, ref } from "vue";
import { defined, layoutStyle } from "@copilotkit/shared/generative-ui";
import type { gridItemSchema } from "@copilotkit/shared/generative-ui";
import type { z } from "zod";
import { useStandardStyles } from "../../standard-styles";
import { useVisibleOnce } from "../visible-once";
import { gridItemColumn, scrollAttributes, useGridColumns } from "./layout";
import type { LayoutContainerProps } from "./layout";

defineOptions({ name: "CopilotGenerativeUIGridItem" });

type GridItemProps = z.output<typeof gridItemSchema>;

/**
 * A cell of a Grid that spans `span` columns and `rowSpan` rows. A span
 * that covers every column the Grid renders fills the row.
 */
const props = defineProps<
  LayoutContainerProps & {
    span?: GridItemProps["span"];
    rowSpan?: GridItemProps["rowSpan"];
  }
>();

useStandardStyles();
const root = ref<HTMLElement | null>(null);
useVisibleOnce(root, () => props.onVisible);
const columns = useGridColumns();

const attributes = computed(() => ({
  "data-a2ui-std": "",
  ...scrollAttributes(props.scrollable),
  style: {
    ...layoutStyle(props),
    ...defined({
      gridColumn: gridItemColumn(props.span, columns?.value),
      gridRow: props.rowSpan ? `span ${props.rowSpan}` : undefined,
      flexDirection: "column",
    }),
  },
}));
</script>

<template>
  <div ref="root" v-bind="attributes"><slot name="children" /></div>
</template>
