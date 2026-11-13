<script setup lang="ts">
import type { CSSProperties } from "vue";
import type { z } from "zod";
import {
  borderColor,
  spacing,
  textColor,
} from "@copilotkit/shared/generative-ui";
import type { blockquoteSchema } from "@copilotkit/shared/generative-ui";
import { useStandardStyles } from "../../standard-styles";
import { InlineMarkdown } from "./inline-markdown";

defineOptions({ name: "CopilotGenerativeUIBlockquote" });

type BlockquoteProps = z.output<typeof blockquoteSchema>;

/** A `<blockquote>` with inline markdown and a line on the left. */
defineProps<{
  /** The quoted text, with inline markdown. */
  text: BlockquoteProps["text"];
}>();

useStandardStyles();

const STYLE: CSSProperties = {
  margin: 0,
  paddingLeft: spacing(3),
  borderLeft: `3px solid ${borderColor("strong")}`,
  color: textColor("secondary"),
};
</script>

<template>
  <blockquote data-a2ui-std="" :style="STYLE">
    <InlineMarkdown :text="text" />
  </blockquote>
</template>
