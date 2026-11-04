import type { ActivityMessage } from "@ag-ui/core";
import {
  ɵdescribeActivityRendererFailure,
  ɵfindActivityRenderer,
  ɵmatchActivityRenderer,
} from "@copilotkit/core";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import { useCopilotKit, useCopilotChatConfiguration } from "../providers";
import { useCallback, useMemo } from "react";
import type { ReactActivityMessageRenderer } from "../types";

export function useRenderActivityMessage() {
  const { copilotkit } = useCopilotKit();
  const agentId = useCopilotChatConfiguration()?.agentId ?? DEFAULT_AGENT_ID;

  const renderers = copilotkit.renderActivityMessages;

  // Find the renderer for a given activity type
  const findRenderer = useCallback(
    (activityType: string): ReactActivityMessageRenderer<unknown> | null =>
      ɵfindActivityRenderer(renderers, { activityType, agentId }),
    [agentId, renderers],
  );

  const renderActivityMessage = useCallback(
    (message: ActivityMessage): React.ReactElement | null => {
      const match = ɵmatchActivityRenderer(renderers, {
        activityType: message.activityType,
        agentId,
        content: message.content,
      });

      if (!match.ok) {
        // Explain why a message that has a renderer drew nothing.
        const warning = ɵdescribeActivityRendererFailure(
          message.activityType,
          match,
        );
        if (warning) {
          console.warn(warning.message, ...warning.details);
        }
        return null;
      }

      const Component = match.renderer.render;
      const agent = copilotkit.getAgent(agentId);

      return (
        <Component
          key={message.id}
          activityType={message.activityType}
          content={match.content}
          message={message}
          agent={agent}
        />
      );
    },
    [agentId, copilotkit, renderers],
  );

  return useMemo(
    () => ({ renderActivityMessage, findRenderer }),
    [renderActivityMessage, findRenderer],
  );
}
