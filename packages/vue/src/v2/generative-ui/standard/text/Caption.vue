<script setup lang="ts">
import { computed } from "vue";
import type { CSSProperties } from "vue";
import type { z } from "zod";
import { FONT_WEIGHT } from "@copilotkit/shared/generative-ui";
import type {
  CAPTION_SIZES,
  captionSchema,
} from "@copilotkit/shared/generative-ui";
import { useStandardStyles } from "../../standard-styles";
import { InlineMarkdown } from "./inline-markdown";
import { typographyStyle } from "./typography";

defineOptions({ name: "CopilotGenerativeUICaption" });

type CaptionProps = z.output<typeof captionSchema>;
type CaptionSize = (typeof CAPTION_SIZES)[number];

/** Small secondary text with inline markdown, sized in em. */
const props = defineProps<{
  /** Caption text, with inline markdown. */
  text: CaptionProps["text"];
  /** Default "secondary". */
  color?: CaptionProps["color"];
  /** Default "lg". */
  size?: CaptionProps["size"];
  /** Default "normal". */
  fontWeight?: CaptionProps["fontWeight"];
  textAlign?: CaptionProps["textAlign"];
  truncate?: CaptionProps["truncate"];
  maxLines?: CaptionProps["maxLines"];
}>();

useStandardStyles();

/** Caption "lg" (the default) is 14px at a 16px base. */
const CAPTION_EM: Record<CaptionSize, string> = {
  sm: ".75em",
  md: ".8125em",
  lg: ".875em",
};

const style = computed<CSSProperties>(() => ({
  display: "block",
  fontSize: CAPTION_EM[props.size ?? "lg"],
  margin: 0,
  ...typographyStyle({ ...props, color: props.color ?? "secondary" }),
  fontWeight: FONT_WEIGHT[props.fontWeight ?? "normal"],
}));
</script>

<template>
  <span :style="style"><InlineMarkdown :text="String(text)" /></span>
</template>
