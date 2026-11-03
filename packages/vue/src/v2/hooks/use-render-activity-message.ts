import { computed } from "vue";
import type { Component } from "vue";
import type { ActivityMessage } from "@ag-ui/core";
import {
  ɵdescribeActivityRendererFailure,
  ɵfindActivityRenderer,
  ɵmatchActivityRenderer,
} from "@copilotkit/core";
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
    return ɵfindActivityRenderer(copilotkit.value.renderActivityMessages, {
      activityType,
      agentId: agentId.value,
    });
  }

  function renderActivityMessage(message: ActivityMessage) {
    const match = ɵmatchActivityRenderer(
      copilotkit.value.renderActivityMessages,
      {
        activityType: message.activityType,
        agentId: agentId.value,
        content: message.content,
      },
    );

    if (!match.ok) {
      // Explain why a message that has a renderer drew nothing.
      const warning = ɵdescribeActivityRendererFailure(
        message.activityType,
        match,
      );
      if (warning) console.warn(warning.message, ...warning.details);
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
