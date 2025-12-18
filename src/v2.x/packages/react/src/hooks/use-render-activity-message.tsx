import { ActivityMessage } from "@ag-ui/core";
import { DEFAULT_AGENT_ID } from "@copilotkitnext/shared";
import { useCopilotKit, useCopilotChatConfiguration } from "@/providers";
import { useCallback } from "react";

export function useRenderActivityMessage() {
  const { copilotkit } = useCopilotKit();
  const config = useCopilotChatConfiguration();
  const agentId = config?.agentId ?? DEFAULT_AGENT_ID;

  const renderers = copilotkit.renderActivityMessages;

  return useCallback(
    (message: ActivityMessage): React.ReactElement | null => {
      if (!renderers.length) {
        return null;
      }

      const matches = renderers.filter(
        (renderer) => renderer.activityType === message.activityType
      );

      const renderer =
        matches.find((candidate) => candidate.agentId === agentId) ??
        matches.find((candidate) => candidate.agentId === undefined) ??
        renderers.find((candidate) => candidate.activityType === "*");

      if (!renderer) {
        return null;
      }

      const parseResult = renderer.content.safeParse(message.content);

      if (!parseResult.success) {
        console.warn(
          `Failed to parse content for activity message '${message.activityType}':`,
          parseResult.error
        );
        return null;
      }

      const Component = renderer.render;

      const agent = copilotkit.getAgent(agentId);

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
    [agentId, copilotkit, renderers]
  );
}
