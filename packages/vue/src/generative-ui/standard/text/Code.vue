<script setup lang="ts">
import type { CSSProperties } from "vue";
import type { z } from "zod";
import {
  backgroundColor,
  radius,
  spacing,
} from "@copilotkit/shared/generative-ui";
import type { codeSchema } from "@copilotkit/shared/generative-ui";
import { useStandardStyles } from "../../standard-styles";

defineOptions({ name: "CopilotGenerativeUICode" });

type CodeProps = z.output<typeof codeSchema>;

/**
 * A block of code in a monospace font. The block scrolls sideways, so a
 * keyboard user can focus it.
 */
defineProps<{
  text: CodeProps["text"];
  /** Set as `data-language` on the `<code>`. */
  language?: CodeProps["language"];
}>();

useStandardStyles();

const STYLE: CSSProperties = {
  margin: 0,
  padding: spacing(3),
  borderRadius: radius("md"),
  background: backgroundColor("surface-secondary"),
  overflowX: "auto",
  fontSize: ".8125em",
};
</script>

<template>
  <pre
    tabindex="0"
    data-a2ui-scroll=""
    :style="STYLE"
  ><code :data-language="language">{{ text }}</code></pre>
</template>
