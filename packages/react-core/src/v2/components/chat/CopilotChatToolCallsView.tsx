import { useRenderToolCall } from "../../hooks";
import type { AssistantMessage, Message, ToolMessage } from "@ag-ui/core";
import React, { useLayoutEffect, useRef, useState } from "react";
import { useCopilotKitInspector } from "../CopilotKitInspectorContext";
import {
  CopilotChatDefaultLabels,
  useCopilotChatConfiguration,
} from "../../providers/CopilotChatConfigurationProvider";
import {
  SaveSnippetBesideChrome,
  SaveSnippetIconButton,
} from "./SaveSnippetIconButton";

export type CopilotChatToolCallsViewProps = {
  message: AssistantMessage;
  messages?: Message[];
};

export function CopilotChatToolCallsView({
  message,
  messages = [],
}: CopilotChatToolCallsViewProps) {
  const renderToolCall = useRenderToolCall();
  const { isLocalInspectorEnabled, saveEventSnippet } =
    useCopilotKitInspector();
  const chatConfiguration = useCopilotChatConfiguration();
  const labels = chatConfiguration?.labels ?? CopilotChatDefaultLabels;

  if (!message.toolCalls || message.toolCalls.length === 0) {
    return null;
  }

  return (
    <>
      {message.toolCalls.map((toolCall) => {
        const toolMessage = messages.find(
          (m) => m.role === "tool" && m.toolCallId === toolCall.id,
        ) as ToolMessage | undefined;
        const rendered = renderToolCall({
          toolCall,
          toolMessage,
        });

        if (!isLocalInspectorEnabled) {
          return <React.Fragment key={toolCall.id}>{rendered}</React.Fragment>;
        }

        const primaryLabel = labels.assistantMessageToolbarSaveSnippetLabel;

        return (
          <ToolCallSnippetChrome
            key={toolCall.id}
            label={primaryLabel}
            onSave={() =>
              void saveEventSnippet({
                kind: "tool-call",
                messageId: message.id,
                toolCallId: toolCall.id,
                toolName: toolCall.function.name,
                argsJson: toolCall.function.arguments || "{}",
                threadId: chatConfiguration?.threadId,
                agentId: chatConfiguration?.agentId,
              })
            }
          >
            {rendered}
          </ToolCallSnippetChrome>
        );
      })}
    </>
  );
}

function ToolCallSnippetChrome({
  children,
  label,
  onSave,
}: {
  children: React.ReactNode;
  label: string;
  onSave: () => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [showSave, setShowSave] = useState(false);

  useLayoutEffect(() => {
    const el = bodyRef.current;
    setShowSave(!!el && el.childElementCount > 0);
  });

  return (
    <SaveSnippetBesideChrome
      showSave={showSave}
      saveButton={
        <SaveSnippetIconButton
          data-testid="copilot-tool-save-snippet-button"
          title={label}
          onClick={onSave}
        />
      }
    >
      <div ref={bodyRef} className="cpk:contents">
        {children}
      </div>
    </SaveSnippetBesideChrome>
  );
}

export default CopilotChatToolCallsView;
