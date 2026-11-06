<script setup lang="ts">
import { computed, watchEffect } from "vue";
import { StreamingMarkdownRenderer } from "@copilotkit/markdown/vue";
import {
  CHAT_MARKDOWN_NODE_CLASS_NAMES,
  warnUnsupportedRichSyntaxOnce,
} from "@copilotkit/markdown";
import type { StreamingMarkdownParserOptions } from "@copilotkit/markdown";
import type { DefaultMarkdownRendererProps } from "../../providers/markdown-renderer";

const props = withDefaults(
  defineProps<
    { content: string; isStreaming?: boolean } & DefaultMarkdownRendererProps
  >(),
  { isStreaming: false, caret: undefined },
);

// vue-tsc reads the renderer's `options` prop as the full options type; the
// renderer itself accepts a partial object.
const resolvedOptions = computed(
  () => props.options as StreamingMarkdownParserOptions | undefined,
);

// Dev-only: nudge upgraders from the bundled Streamdown default when their
// content needs math/syntax highlighting the built-in renderer doesn't do.
watchEffect(() => warnUnsupportedRichSyntaxOnce(props.content));
</script>

<template>
  <StreamingMarkdownRenderer
    v-if="props.content"
    :content="props.content"
    :is-complete="!props.isStreaming"
    :node-renderers="props.nodeRenderers"
    :node-class-names="CHAT_MARKDOWN_NODE_CLASS_NAMES"
    :caret="props.caret ?? props.isStreaming"
    :options="resolvedOptions"
    :class="props.class"
    :on-link-click="props.onLinkClick"
    :on-citation-click="props.onCitationClick"
  />
</template>
