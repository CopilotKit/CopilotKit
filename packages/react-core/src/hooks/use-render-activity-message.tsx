import type { ActivityMessage } from "@ag-ui/core";
import { ɵresolveActivityRenderer } from "@copilotkit/core";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import { useCopilotKit, useCopilotChatConfiguration } from "../providers";
import { useCallback, useMemo } from "react";
import type { ReactActivityMessageRenderer } from "../types";

/**
 * Explain why an activity message that has a renderer drew nothing: its
 * content validates asynchronously, or it fails the renderer's schema.
 */
function warnAboutRejectedContent(
  renderer: ReactActivityMessageRenderer<unknown>,
  message: ActivityMessage,
) {
  const result = renderer.content["~standard"].validate(message.content);

  if (result instanceof Promise) {
    console.warn(
      `Async content validation is not supported for activity message '${message.activityType}'`,
    );
    return;
  }

  if (result.issues) {
    console.warn(
      `Failed to parse content for activity message '${message.activityType}':`,
      result.issues,
    );
  }
}

export function useRenderActivityMessage() {
  const { copilotkit } = useCopilotKit();
  const agentId = useCopilotChatConfiguration()?.agentId ?? DEFAULT_AGENT_ID;

  const renderers = copilotkit.renderActivityMessages;

  // Find the renderer for a given activity type
  const findRenderer = useCallback(
    (activityType: string): ReactActivityMessageRenderer<unknown> | null => {
      if (!renderers.length) {
        return null;
      }

      const matches = renderers.filter(
        (renderer) => renderer.activityType === activityType,
      );

      return (
        matches.find((candidate) => candidate.agentId === agentId) ??
        matches.find((candidate) => candidate.agentId === undefined) ??
        renderers.find((candidate) => candidate.activityType === "*") ??
        null
      );
    },
    [agentId, renderers],
  );

  const renderActivityMessage = useCallback(
    (message: ActivityMessage): React.ReactElement | null => {
      const match = ɵresolveActivityRenderer(renderers, {
        activityType: message.activityType,
        agentId,
        content: message.content,
      });

      if (!match) {
        const renderer = findRenderer(message.activityType);
        if (renderer) warnAboutRejectedContent(renderer, message);
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
    [agentId, copilotkit, findRenderer, renderers],
  );

  return useMemo(
    () => ({ renderActivityMessage, findRenderer }),
    [renderActivityMessage, findRenderer],
  );
}
