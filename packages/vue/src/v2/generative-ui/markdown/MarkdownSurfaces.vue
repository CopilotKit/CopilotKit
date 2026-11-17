<script lang="ts">
/**
 * Experimental. The props of `MarkdownSurfaces`. Other attributes go to each
 * `StreamMarkdown` of the prose, as the props of `StreamMarkdown`.
 */
export interface MarkdownSurfacesProps {
  /** The text of the assistant message, complete or still streaming. */
  content: string;
  /** The id of the message. The fences of the message are found by it. */
  messageId: string;
}
</script>

<script setup lang="ts">
/**
 * Experimental. Renders an assistant message of the markdown transport.
 * Prose renders as markdown with `StreamMarkdown`. In place of each ```a2ui
 * fence:
 *
 * - the fence that created a chat surface renders that surface (and the
 *   prose lifted out of it) in the chat wrapper;
 * - every other fence renders nothing: a fence that updates the surface of
 *   an earlier fence, or a fence for a named target, which
 *   `<GenerativeUISurface id>` renders.
 *
 * Use it inside `<CopilotKitProvider :generativeUI="{ ui, transport: 'markdown' }">`.
 * `CopilotChatAssistantMessage` uses it there on its own.
 *
 * @example
 * ```vue
 * <MarkdownSurfaces :content="message.content" :message-id="message.id" />
 * ```
 */
import { computed } from "vue";
import { StreamMarkdown } from "streamdown-vue";
import { splitA2UIMarkdown } from "@copilotkit/core";
import { getMarkdownSurfaceSource } from "@copilotkit/core/generative-ui";
import type { ManagedSurface } from "@copilotkit/core/generative-ui";
import { GENERATIVE_UI_ROOT_ID } from "@copilotkit/shared";
import type { GenerativeUIRejectedOperation } from "@copilotkit/shared";
import type { AnyGenerativeUI } from "@copilotkit/shared/generative-ui";
import { useCopilotChatConfiguration } from "../../providers/useCopilotChatConfiguration";
import { GenerativeUIChatSurfaceOutlet } from "../chat";
import { useManagerVersion } from "../hooks";
import { useRequiredGenerativeUIRuntime } from "../runtime-context";
import type { GenerativeUIRuntime } from "../runtime-context";
import DefaultMarkdownChatSurface from "./DefaultMarkdownChatSurface.vue";

defineOptions({ name: "MarkdownSurfaces", inheritAttrs: false });
const props = defineProps<MarkdownSurfacesProps>();

type Part =
  | { kind: "markdown"; key: string; text: string }
  | {
      kind: "surface";
      key: string;
      surface: ManagedSurface;
      isStreaming: boolean;
      rejected: GenerativeUIRejectedOperation[];
    };

const runtime = useRequiredGenerativeUIRuntime();
const chat = useCopilotChatConfiguration();
const version = useManagerVersion(runtime);
const segments = computed(() => splitA2UIMarkdown(props.content));

/**
 * One chat surface of a fence, or nothing until the surface has its root
 * component, so a half-streamed fence shows no empty card.
 */
function surfacePart(
  current: GenerativeUIRuntime,
  threadId: string,
  surfaceId: string,
) {
  // A surface whose createSurface was rejected shows only the error.
  const surface =
    current.manager.getSurface(threadId, surfaceId) ??
    current.manager.getFailedSurface(threadId, surfaceId);
  const root = surface?.model.componentsModel.get(GENERATIVE_UI_ROOT_ID);
  if (!surface || (!root && !surface.failed)) return undefined;
  const part: Part = {
    kind: "surface",
    key: surfaceId,
    surface,
    isStreaming: surface.status === "streaming",
    rejected: [...surface.serverRejected, ...surface.clientRejected],
  };
  return part;
}

const parts = computed(() => {
  void version.value;
  const current = runtime.value;
  const threadId = chat.value?.threadId ?? current.manager.getActiveThread();
  // The engine's `ui` type takes function and class components only.
  const ui: AnyGenerativeUI = current.ui;
  const source = getMarkdownSurfaceSource({ manager: current.manager, ui });
  const result: Part[] = [];
  segments.value.forEach((segment, index) => {
    if (segment.type === "markdown") {
      result.push({ kind: "markdown", key: `md-${index}`, text: segment.text });
      return;
    }
    const blocks = threadId
      ? source.getFenceBlocks(threadId, props.messageId, segment.index)
      : undefined;
    if (!threadId || !blocks) return;
    // Keys follow the surfaces, so a surface keeps its element when prose
    // splits off around it during streaming.
    let surfaceCount = 0;
    for (const block of blocks) {
      if (block.kind === "markdown") {
        result.push({
          kind: "markdown",
          key: `md-${index}-${surfaceCount}`,
          text: block.markdown,
        });
        continue;
      }
      surfaceCount++;
      const part = surfacePart(current, threadId, block.surfaceId);
      if (part) result.push(part);
    }
  });
  return result;
});
</script>

<template>
  <template v-for="part in parts" :key="part.key">
    <StreamMarkdown
      v-if="part.kind === 'markdown'"
      v-bind="$attrs"
      :content="part.text"
    />
    <GenerativeUIChatSurfaceOutlet
      v-else
      :surface="part.surface"
      :is-streaming="part.isStreaming"
      :rejected="part.rejected"
      :card="DefaultMarkdownChatSurface"
    />
  </template>
</template>
