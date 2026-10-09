import type { ActivityMessage } from "@ag-ui/core";
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
      const renderer = findRenderer(message.activityType);

      if (!renderer) {
        return null;
      }

      const parseResult = renderer.content["~standard"].validate(
        message.content,
      );

      if (parseResult instanceof Promise) {
        console.warn(
          `Async content validation is not supported for activity message '${message.activityType}'`,
        );
        return null;
      }

      if (parseResult.issues) {
        console.warn(
          `Failed to parse content for activity message '${message.activityType}':`,
          parseResult.issues,
        );
        return null;
      }

      const Component = renderer.render;
      const agent = copilotkit.getAgent(agentId);

      return (
        <Component
          key={message.id}
          activityType={message.activityType}
          content={parseResult.value}
          message={message}
          agent={agent}
        />
      );
    },
    [agentId, copilotkit, findRenderer],
  );

  return useMemo(
    () => ({ renderActivityMessage, findRenderer }),
    [renderActivityMessage, findRenderer],
  );
}
