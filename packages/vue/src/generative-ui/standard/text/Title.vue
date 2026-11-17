<script setup lang="ts">
import { computed } from "vue";
import type { CSSProperties } from "vue";
import type { z } from "zod";
import { FONT_WEIGHT } from "@copilotkit/shared/generative-ui";
import type { TitleSize, titleSchema } from "@copilotkit/shared/generative-ui";
import { useStandardStyles } from "../../standard-styles";
import { typographyStyle } from "./typography";

defineOptions({ name: "CopilotGenerativeUITitle" });

type TitleProps = z.output<typeof titleSchema>;

/**
 * A heading. The element changes with the size: "sm" is an h4, "md" and
 * "lg" an h3, "xl" and up an h2. Only what the model set is inline; the
 * size, line height and weight come from the heading styles of the host.
 */
const props = defineProps<{
  text: TitleProps["text"];
  /** Default "md". */
  size?: TitleProps["size"];
  /** Default true. False sets the normal weight. */
  strong?: TitleProps["strong"];
  color?: TitleProps["color"];
  fontWeight?: TitleProps["fontWeight"];
  textAlign?: TitleProps["textAlign"];
  italic?: TitleProps["italic"];
  truncate?: TitleProps["truncate"];
  maxLines?: TitleProps["maxLines"];
  tabularNums?: TitleProps["tabularNums"];
  width?: TitleProps["width"];
}>();

useStandardStyles();

/**
 * The heading level of each size. `STANDARD_CSS` has fallbacks for hosts
 * without heading styles.
 */
const TITLE_TAG: Record<TitleSize, "h2" | "h3" | "h4"> = {
  sm: "h4",
  md: "h3",
  lg: "h3",
  xl: "h2",
  "2xl": "h2",
  "3xl": "h2",
  "4xl": "h2",
  "5xl": "h2",
};

const size = computed(() => props.size ?? "md");
const style = computed<CSSProperties>(() => ({
  ...typographyStyle(props),
  fontWeight: props.fontWeight
    ? FONT_WEIGHT[props.fontWeight]
    : props.strong === false
      ? FONT_WEIGHT.normal
      : undefined,
}));
</script>

<template>
  <component
    :is="TITLE_TAG[size]"
    data-a2ui-std=""
    :data-a2ui-title="size"
    :style="style"
    >{{ text }}</component
  >
</template>
