<script setup lang="ts">
import { computed } from "vue";
import {
  borderColor,
  defined,
  spacing as spacingOf,
} from "@copilotkit/shared/generative-ui";
import type { dividerSchema } from "@copilotkit/shared/generative-ui";
import type { z } from "zod";
import { useStandardStyles } from "../../standard-styles";

defineOptions({ name: "CopilotGenerativeUIDivider" });

type DividerProps = z.output<typeof dividerSchema>;

/** An `<hr>` rule: horizontal, or vertical with `axis: "vertical"`. */
const props = defineProps<{
  axis?: DividerProps["axis"];
  weight?: DividerProps["weight"];
  color?: DividerProps["color"];
  size?: DividerProps["size"];
  spacing?: DividerProps["spacing"];
  flush?: DividerProps["flush"];
}>();

useStandardStyles();
const isVertical = computed(() => props.axis === "vertical");
const style = computed(() => {
  const line = `${props.size ?? 1}px solid ${borderColor(props.color ?? "subtle")}`;
  const margin = props.flush ? 0 : spacingOf(props.spacing ?? 2);
  return defined({
    border: 0,
    ...(isVertical.value
      ? { borderLeft: line, margin: `0 ${margin}`, height: "auto" }
      : { borderTop: line, margin: `${margin} 0`, width: "100%" }),
    flexShrink: 0,
    flexGrow: props.weight,
    alignSelf: "stretch",
  });
});
</script>

<template>
  <hr :aria-orientation="isVertical ? 'vertical' : undefined" :style="style" />
</template>
