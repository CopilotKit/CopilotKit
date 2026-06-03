<script setup lang="ts">
import { StreamingMarkdownRenderer } from "@copilotkit/markdown-renderer/vue";

const props = withDefaults(
  defineProps<{ content: string; isStreaming?: boolean }>(),
  { isStreaming: false },
);
</script>

<template>
  <StreamingMarkdownRenderer
    :content="props.content"
    :is-complete="!props.isStreaming"
  />
</template>
