<script setup lang="ts">
import { StreamingMarkdownRenderer } from "@copilotkit/markdown-renderer/vue";
import type { DefaultMarkdownRendererProps } from "../../providers/markdown-renderer";

const props = withDefaults(
  defineProps<{ content: string; isStreaming?: boolean } & DefaultMarkdownRendererProps>(),
  { isStreaming: false },
);
</script>

<template>
  <StreamingMarkdownRenderer
    :content="props.content"
    :is-complete="!props.isStreaming"
    :node-renderers="props.nodeRenderers"
    :caret="props.caret ?? false"
    :options="(props.options as any)"
    :class="props.class"
  />
</template>
