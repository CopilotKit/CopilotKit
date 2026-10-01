import { useRenderToolCall } from "../../hooks";
import { useCopilotKit } from "../../context";
import type { AssistantMessage, Message, ToolMessage } from "@ag-ui/core";
import React, { useSyncExternalStore } from "react";

export type CopilotChatToolCallsViewProps = {
  message: AssistantMessage;
  messages?: Message[];
};

export function CopilotChatToolCallsView({
  message,
  messages = [],
}: CopilotChatToolCallsViewProps) {
  const renderToolCall = useRenderToolCall();
  const { copilotkit } = useCopilotKit();
  const trajectoryId = useSyncExternalStore(
    (callback) =>
      copilotkit.subscribe({ onTrajectoryChanged: callback }).unsubscribe,
    () => copilotkit.trajectoryId,
    () => null,
  );

  if (!message.toolCalls || message.toolCalls.length === 0) {
    return null;
  }

  return (
    <>
      {message.toolCalls.map((toolCall) => {
        const toolMessage = messages.find(
          (m) => m.role === "tool" && m.toolCallId === toolCall.id,
        ) as ToolMessage | undefined;

        const rendered = renderToolCall({ toolCall, toolMessage });
        if (rendered === null) return null;
        if (trajectoryId === null) return rendered;

        // The id lets active interaction capture attribute clicks to this tool call.
        return (
          <div
            key={toolCall.id}
            data-tool-call-id={toolCall.id}
            style={{ display: "contents" }}
          >
            {rendered}
          </div>
        );
      })}
    </>
  );
}

export default CopilotChatToolCallsView;
