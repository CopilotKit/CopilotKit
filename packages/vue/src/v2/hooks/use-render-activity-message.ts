import { computed } from "vue";
import type { Component } from "vue";
import type { ActivityMessage } from "@ag-ui/core";
import type { AbstractAgent } from "@ag-ui/client";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import { useCopilotKit } from "../providers/useCopilotKit";
import { useCopilotChatConfiguration } from "../providers/useCopilotChatConfiguration";
import type {
  VueActivityMessageRenderer,
  VueActivityMessageRendererProps,
} from "../types";

interface ActivityRendererResult {
  renderer: Component<VueActivityMessageRendererProps<unknown>>;
  props: VueActivityMessageRendererProps<unknown>;
}

/**
 * Returns helpers for rendering activity messages.
 *
 * Matches the React `useRenderActivityMessage` API: `findRenderer` locates a
 * registered renderer by activity type (preferring agent-scoped over global,
 * with `"*"` as a wildcard fallback), and `renderActivityMessage` resolves the
 * renderer and validates the content schema.
 */
export function useRenderActivityMessage() {
  const { copilotkit } = useCopilotKit();
  const config = useCopilotChatConfiguration();
  const agentId = computed(() => config.value?.agentId ?? DEFAULT_AGENT_ID);

  const renderers = computed(() => [
    ...copilotkit.value.renderActivityMessages,
  ]);

  function findRenderer(
    activityType: string,
  ): VueActivityMessageRenderer<unknown> | null {
    const list = renderers.value;
    if (!list.length) {
      return null;
    }

    const matches = list.filter(
      (renderer) => renderer.activityType === activityType,
    );

    return (
      matches.find((candidate) => candidate.agentId === agentId.value) ??
      matches.find((candidate) => candidate.agentId === undefined) ??
      list.find((candidate) => candidate.activityType === "*") ??
      null
    );
  }

  function renderActivityMessage(
    message: ActivityMessage,
  ): ActivityRendererResult | null {
    const renderer = findRenderer(message.activityType);

    if (!renderer) {
      return null;
    }

    const parseResult = renderer.content.safeParse(message.content);

    if (!parseResult.success) {
      console.warn(
        `Failed to parse content for activity message ` +
          `'${message.activityType}':`,
        parseResult.error,
      );
      return null;
    }

    const agent: AbstractAgent | undefined = copilotkit.value.getAgent(
      agentId.value,
    );

    return {
      renderer: renderer.render as Component<
        VueActivityMessageRendererProps<unknown>
      >,
      props: {
        activityType: message.activityType,
        content: parseResult.data,
        message,
        agent,
      },
    };
  }

  return { renderActivityMessage, findRenderer };
}
