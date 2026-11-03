import { computed } from "vue";
import type { Component } from "vue";
import type { ActivityMessage } from "@ag-ui/core";
import { ɵresolveActivityRenderer } from "@copilotkit/core";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import { useCopilotKit } from "../providers/useCopilotKit";
import { useCopilotChatConfiguration } from "../providers/useCopilotChatConfiguration";
import type { VueActivityMessageRendererProps } from "../types";

/**
 * Returns helpers for rendering activity messages.
 *
 * Matches the React `useRenderActivityMessage` API: `findRenderer` locates a
 * registered renderer by activity type (preferring agent-scoped over global,
 * with `"*"` as a wildcard fallback), and `renderActivityMessage` resolves the
 * renderer and validates the content with the renderer's `content` schema
 * (any Standard Schema, such as zod).
 */
export function useRenderActivityMessage() {
  const { copilotkit } = useCopilotKit();
  const config = useCopilotChatConfiguration();
  const agentId = computed(() => config.value?.agentId ?? DEFAULT_AGENT_ID);

  function findRenderer(activityType: string) {
    const renderers = copilotkit.value.renderActivityMessages;
    const matches = renderers.filter(
      (renderer) => renderer.activityType === activityType,
    );

    return (
      matches.find((candidate) => candidate.agentId === agentId.value) ??
      matches.find((candidate) => candidate.agentId === undefined) ??
      renderers.find((candidate) => candidate.activityType === "*") ??
      null
    );
  }

  function renderActivityMessage(message: ActivityMessage) {
    const match = ɵresolveActivityRenderer(
      copilotkit.value.renderActivityMessages,
      {
        activityType: message.activityType,
        agentId: agentId.value,
        content: message.content,
      },
    );

    if (!match) {
      if (findRenderer(message.activityType)) {
        console.warn(
          `Failed to validate content for activity message ` +
            `'${message.activityType}'.`,
        );
      }
      return null;
    }

    return {
      renderer: match.renderer.render as Component<
        VueActivityMessageRendererProps<unknown>
      >,
      props: {
        activityType: message.activityType,
        content: match.content,
        message,
        agent: copilotkit.value.getAgent(agentId.value),
      },
    };
  }

  return { renderActivityMessage, findRenderer };
}
