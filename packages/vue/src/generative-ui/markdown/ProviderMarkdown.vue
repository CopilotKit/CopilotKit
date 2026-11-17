<script setup lang="ts">
/**
 * Markdown prose inside generative UI, rendered like the chat text around
 * it: the renderer set on the provider when there is one, else the built-in
 * streaming renderer. Config passed here wins over provider config.
 */
import { computed } from "vue";
import type { Component } from "vue";
import StreamingMarkdownDefault from "../../components/chat/StreamingMarkdownDefault.vue";
import {
  isVueComponentRenderer,
  useMarkdownRenderer,
} from "../../providers/markdown-renderer";
import type { DefaultMarkdownRendererProps } from "../../providers/markdown-renderer";

defineOptions({ name: "CopilotGenerativeUIProviderMarkdown" });

const props = withDefaults(
  defineProps<
    { content: string; isStreaming?: boolean } & DefaultMarkdownRendererProps
  >(),
  { isStreaming: false, caret: undefined },
);

const renderer = useMarkdownRenderer();
const rendererIsComponent = isVueComponentRenderer(renderer);

const config = computed(() => {
  const { content: _content, isStreaming: _isStreaming, ...own } = props;
  const defined = Object.fromEntries(
    Object.entries(own).filter(([, value]) => value !== undefined),
  );
  return {
    ...(rendererIsComponent ? {} : (renderer as DefaultMarkdownRendererProps)),
    ...defined,
  };
});
</script>

<template>
  <component
    :is="renderer as Component"
    v-if="rendererIsComponent"
    :content="props.content"
    :is-streaming="props.isStreaming"
    :class="props.class"
  />
  <StreamingMarkdownDefault
    v-else
    v-bind="config"
    :content="props.content"
    :is-streaming="props.isStreaming"
  />
</template>
