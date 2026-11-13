<script setup lang="ts">
import { StreamMarkdown } from "streamdown-vue";
import type { z } from "zod";
import type { markdownSchema } from "@copilotkit/shared/generative-ui";
import { useKatexStyles } from "../../../hooks/use-katex-styles";
import { useStandardStyles } from "../../standard-styles";

defineOptions({ name: "CopilotGenerativeUIMarkdown" });

type MarkdownProps = z.output<typeof markdownSchema>;

/**
 * Full GitHub-flavored markdown, rendered with Streamdown like the chat
 * messages. It has no typography of its own, so it reads like the chat
 * text around the surface. While `streaming` is true, Streamdown closes
 * markdown that is not complete yet.
 */
defineProps<{
  /** The markdown source. */
  text: MarkdownProps["text"];
  /** Default false. */
  streaming?: MarkdownProps["streaming"];
}>();

useStandardStyles();
useKatexStyles();
</script>

<template>
  <div class="a2ui-markdown" data-a2ui-std="">
    <StreamMarkdown :content="text" :parse-incomplete-markdown="streaming" />
  </div>
</template>
