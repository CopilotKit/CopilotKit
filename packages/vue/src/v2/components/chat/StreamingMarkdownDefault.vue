<script setup lang="ts">
import { computed } from "vue";
import { StreamingMarkdownRenderer } from "@copilotkit/markdown-renderer/vue";
import type { StreamingMarkdownParserOptions } from "@copilotkit/markdown-renderer";
import type { DefaultMarkdownRendererProps } from "../../providers/markdown-renderer";

const props = withDefaults(
  defineProps<
    { content: string; isStreaming?: boolean } & DefaultMarkdownRendererProps
  >(),
  { isStreaming: false },
);

const resolvedOptions = computed(
  () => props.options as StreamingMarkdownParserOptions | undefined,
);
</script>

<template>
  <StreamingMarkdownRenderer
    :content="props.content"
    :is-complete="!props.isStreaming"
    :node-renderers="props.nodeRenderers"
    :caret="props.caret ?? props.isStreaming"
    :options="resolvedOptions"
    :class="props.class"
  />
</template>
