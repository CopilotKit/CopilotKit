<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  defined,
  layoutStyle,
  spacing,
} from "@copilotkit/shared/generative-ui";
import type { gridSchema } from "@copilotkit/shared/generative-ui";
import type { z } from "zod";
import { useStandardStyles } from "../../standard-styles";
import { useVisibleOnce } from "../visible-once";
import {
  gridTemplateColumns,
  hasGap,
  measureTracks,
  provideGridColumns,
  scrollAttributes,
} from "./layout";
import type { LayoutContainerProps } from "./layout";

defineOptions({ name: "CopilotGenerativeUIGrid" });

type GridProps = z.output<typeof gridSchema>;

/**
 * A CSS grid. A column count collapses towards one column on narrow
 * widths. The Grid measures the columns it renders, so a GridItem that
 * spans all of them fills the row.
 */
const props = defineProps<
  LayoutContainerProps & {
    columns?: GridProps["columns"];
    minChildWidth?: GridProps["minChildWidth"];
    rows?: GridProps["rows"];
  }
>();

useStandardStyles();
const root = ref<HTMLElement | null>(null);
useVisibleOnce(root, () => props.onVisible);

/** The column count that the props give, or `undefined` when unknown. */
const declared = computed(() => {
  if (typeof props.columns === "number") {
    return Math.max(1, Math.floor(props.columns));
  }
  const isDefault =
    props.columns === undefined && props.minChildWidth === undefined;
  return isDefault ? 2 : undefined;
});
/** The track count the browser renders; only known after mount. */
const measured = ref<number | undefined>(undefined);
provideGridColumns(computed(() => measured.value ?? declared.value));

let observer: ResizeObserver | undefined;
onMounted(() => {
  const element = root.value;
  if (!element) return;
  const update = () => {
    measured.value = measureTracks(element);
  };
  update();
  if (typeof ResizeObserver === "undefined") return;
  observer = new ResizeObserver(update);
  observer.observe(element);
});
onBeforeUnmount(() => observer?.disconnect());

const attributes = computed(() => ({
  "data-a2ui-std": "",
  ...scrollAttributes(props.scrollable),
  style: {
    ...layoutStyle(props),
    ...defined({
      display: "grid",
      gap: hasGap(props) ? undefined : spacing(4),
      gridTemplateColumns: gridTemplateColumns(props),
      gridTemplateRows:
        typeof props.rows === "number"
          ? `repeat(${props.rows}, auto)`
          : props.rows,
    }),
  },
}));
</script>

<template>
  <div ref="root" v-bind="attributes"><slot name="children" /></div>
</template>
