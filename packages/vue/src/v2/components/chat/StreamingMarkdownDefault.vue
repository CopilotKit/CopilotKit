<script setup lang="ts">
import { computed, h, watchEffect } from "vue";
import {
  StreamingMarkdownRenderer,
  type VueStreamingMarkdownNodeRenderer,
} from "@copilotkit/markdown-renderer/vue";
import { warnUnsupportedRichSyntaxOnce } from "@copilotkit/markdown-renderer";
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

const defaultCodeBlockRenderer: VueStreamingMarkdownNodeRenderer = (
  node,
  defaultVNode,
) => {
  if (node.type !== "code-block") return defaultVNode;
  return h(
    "pre",
    {
      "data-streaming-markdown-node": "code-block",
      "data-node-open": String(!node.closed),
      class: "cpk:overflow-x-auto cpk:rounded-lg cpk:p-3",
    },
    [h("code", { "data-code-info": node.info ?? undefined }, node.text)],
  );
};

const mergedNodeRenderers = computed(() => ({
  codeBlock: defaultCodeBlockRenderer,
  ...props.nodeRenderers,
}));

// Dev-only: nudge upgraders from the bundled Streamdown default when their
// content needs math/syntax highlighting the built-in renderer doesn't do.
watchEffect(() => warnUnsupportedRichSyntaxOnce(props.content));
</script>

<template>
  <StreamingMarkdownRenderer
    :content="props.content"
    :is-complete="!props.isStreaming"
    :node-renderers="mergedNodeRenderers"
    :caret="props.caret ?? props.isStreaming"
    :options="resolvedOptions"
    :class="props.class"
  />
</template>
