import { useRenderToolCall } from "../../hooks";
import { useCopilotKit } from "../../context";
import type { AssistantMessage, Message, ToolMessage } from "@ag-ui/core";
import React, { useCallback, useContext, useSyncExternalStore } from "react";
import { SubagentLayoutContext } from "./CopilotChatSubagent";

export type CopilotChatToolCallsViewProps = {
  message: AssistantMessage;
  messages?: Message[];
};

export function CopilotChatToolCallsView({
  message,
  messages = [],
}: CopilotChatToolCallsViewProps) {
  const renderToolCall = useRenderToolCall();
  const subagents = useContext(SubagentLayoutContext);
  const { copilotkit } = useCopilotKit();
  const subscribe = useCallback(
    (onChange: () => void) =>
      copilotkit.ɵsubscribeToLearningConfigured(onChange),
    [copilotkit],
  );
  const getSnapshot = () => copilotkit.ɵlearningConfigured;
  // Driven by the learning config, not by the Trajectory: a wrapper that comes
  // and goes with capture state would remount the tool UI on every reconnect.
  // Only adding or removing the config itself changes the tree.
  const learningConfigured = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot,
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
        // The subagents this call started, even when no renderer is registered for the call.
        const groups = subagents?.layout.byToolCallId
          .get(toolCall.id)
          ?.map(subagents.renderGroup);
        if (rendered === null && !groups?.length) return null;

        return (
          <React.Fragment key={toolCall.id}>
            {rendered !== null && learningConfigured ? (
              // The id lets interaction capture attribute clicks to this tool call.
              <div
                data-tool-call-id={toolCall.id}
                style={{ display: "contents" }}
              >
                {rendered}
              </div>
            ) : (
              rendered
            )}
            {groups}
          </React.Fragment>
        );
      })}
    </>
  );
}

export default CopilotChatToolCallsView;
