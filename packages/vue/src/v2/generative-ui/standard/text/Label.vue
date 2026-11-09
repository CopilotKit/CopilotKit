<script setup lang="ts">
import { computed } from "vue";
import type { CSSProperties } from "vue";
import type { z } from "zod";
import { FONT_WEIGHT, textFont } from "@copilotkit/shared/generative-ui";
import type { labelSchema } from "@copilotkit/shared/generative-ui";
import { useStandardStyles } from "../../standard-styles";
import { typographyStyle } from "./typography";

defineOptions({ name: "CopilotGenerativeUILabel" });

type LabelProps = z.output<typeof labelSchema>;

/** The `<label>` of a form field, tied to its control with `htmlFor`. */
const props = defineProps<{
  text: LabelProps["text"];
  /** The id of the control. */
  htmlFor?: LabelProps["htmlFor"];
  /** Default "secondary". */
  color?: LabelProps["color"];
  /** Default "sm". */
  size?: LabelProps["size"];
  /** Default "medium". */
  fontWeight?: LabelProps["fontWeight"];
  textAlign?: LabelProps["textAlign"];
  truncate?: LabelProps["truncate"];
  width?: LabelProps["width"];
}>();

useStandardStyles();

const style = computed<CSSProperties>(() => ({
  display: "block",
  ...textFont(props.size ?? "sm"),
  margin: 0,
  ...typographyStyle({ ...props, color: props.color ?? "secondary" }),
  fontWeight: FONT_WEIGHT[props.fontWeight ?? "medium"],
}));
</script>

<template>
  <label :for="htmlFor" :style="style">{{ text }}</label>
</template>
