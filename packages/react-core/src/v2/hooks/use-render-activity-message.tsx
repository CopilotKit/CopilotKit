import { ActivityMessage } from "@ag-ui/core";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import { useCopilotKit, useCopilotChatConfiguration } from "../providers";
import { useCallback, useMemo } from "react";
import { ReactActivityMessageRenderer } from "../types";
import { getThreadClone } from "./use-agent";

export function useRenderActivityMessage() {
  const { copilotkit } = useCopilotKit();
  const config = useCopilotChatConfiguration();
  const agentId = config?.agentId ?? DEFAULT_AGENT_ID;

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

      const parseResult = renderer.content.safeParse(message.content);

      if (!parseResult.success) {
        console.warn(
          `Failed to parse content for activity message '${message.activityType}':`,
          parseResult.error,
        );
        return null;
      }

      const Component = renderer.render;
      // Prefer the per-thread clone so that handleAction in ReactSurfaceHost
      // calls runAgent on the same agent instance that CopilotChat renders from.
      // Without this, button clicks accumulate messages on the registry agent
      // while CopilotChat displays from the clone — responses appear to vanish.
      const registryAgent = copilotkit.getAgent(agentId);
      const agent =
        getThreadClone(registryAgent, config?.threadId) ?? registryAgent;

      return (
        <Component
          key={message.id}
          activityType={message.activityType}
          content={parseResult.data}
          message={message}
          agent={agent}
        />
      );
    },
    [agentId, config?.threadId, copilotkit, findRenderer],
  );

  return useMemo(
    () => ({ renderActivityMessage, findRenderer }),
    [renderActivityMessage, findRenderer],
  );
}
