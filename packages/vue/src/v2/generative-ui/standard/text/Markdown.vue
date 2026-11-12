<script setup lang="ts">
import type { z } from "zod";
import type { markdownSchema } from "@copilotkit/shared/generative-ui";
import ProviderMarkdown from "../../markdown/ProviderMarkdown.vue";
import { useStandardStyles } from "../../standard-styles";

defineOptions({ name: "CopilotGenerativeUIMarkdown" });

type MarkdownProps = z.output<typeof markdownSchema>;

/**
 * Full GitHub-flavored markdown, rendered like the chat messages: with the
 * provider's markdown renderer when there is one, else the built-in
 * streaming renderer. It has no typography of its own, so it reads like the
 * chat text around the surface. While `streaming` is true, the renderer
 * closes markdown that is not complete yet.
 */
defineProps<{
  /** The markdown source. */
  text: MarkdownProps["text"];
  /** Default false. */
  streaming?: MarkdownProps["streaming"];
}>();

useStandardStyles();
</script>

<template>
  <div class="a2ui-markdown" data-a2ui-std="">
    <ProviderMarkdown :content="text" :is-streaming="streaming === true" />
  </div>
</template>
