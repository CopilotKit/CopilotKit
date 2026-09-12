import type { Message, ToolCall, ToolMessage } from "@ag-ui/core";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import { ToolCallStatus } from "@copilotkit/core";
import { partialJSONParse } from "@copilotkit/shared";
import type { CopilotChatToolCallRenderSlotProps } from "./types";
import type {
  VueToolCallRenderer,
  VueToolCallRendererRenderProps,
} from "../../types";

export function findToolMessage(
  messages: Message[],
  toolCallId: string,
): ToolMessage | undefined {
  return messages.find(
    (message) =>
      message.role === "tool" &&
      (message as ToolMessage).toolCallId === toolCallId,
  ) as ToolMessage | undefined;
}

export function getToolCallSlotName(toolName: string): `tool-call-${string}` {
  return `tool-call-${toolName}`;
}

export function getCoreRenderConfig(
  toolCall: ToolCall,
  renderToolCalls: readonly VueToolCallRenderer<unknown>[],
  agentId: string,
): VueToolCallRenderer<unknown> | undefined {
  const exactMatches = renderToolCalls.filter(
    (renderConfig) => renderConfig.name === toolCall.function.name,
  );

  return (
    exactMatches.find((renderConfig) => renderConfig.agentId === agentId) ??
    exactMatches.find((renderConfig) => !renderConfig.agentId) ??
    exactMatches[0] ??
    renderToolCalls.find((renderConfig) => renderConfig.name === "*")
  );
}

export function getToolCallRenderProps(
  toolCall: ToolCall,
  messages: Message[],
  executingToolCallIds: ReadonlySet<string>,
): CopilotChatToolCallRenderSlotProps {
  const toolMessage = findToolMessage(messages, toolCall.id);
  const parsedArgs = partialJSONParse(toolCall.function.arguments);

  if (toolMessage) {
    return {
      name: toolCall.function.name,
      args: parsedArgs,
      status: ToolCallStatus.Complete,
      result: toolMessage.content,
      toolCall,
      toolMessage,
    };
  }

  const isExecuting = executingToolCallIds.has(toolCall.id);
  return {
    name: toolCall.function.name,
    args: parsedArgs,
    status: isExecuting ? ToolCallStatus.Executing : ToolCallStatus.InProgress,
    result: undefined,
    toolCall,
    toolMessage: undefined,
  };
}

export function getCoreRenderProps(
  toolCall: ToolCall,
  messages: Message[],
  executingToolCallIds: ReadonlySet<string>,
): VueToolCallRendererRenderProps<unknown> {
  const toolMessage = findToolMessage(messages, toolCall.id);
  const parsedArgs = partialJSONParse(toolCall.function.arguments);

  if (toolMessage) {
    return {
      name: toolCall.function.name,
      toolCallId: toolCall.id,
      args: parsedArgs,
      status: ToolCallStatus.Complete,
      result: toolMessage.content,
    };
  }

  const isExecuting = executingToolCallIds.has(toolCall.id);
  if (isExecuting) {
    return {
      name: toolCall.function.name,
      toolCallId: toolCall.id,
      args: parsedArgs,
      status: ToolCallStatus.Executing,
      result: undefined,
    };
  }

  return {
    name: toolCall.function.name,
    toolCallId: toolCall.id,
    args: parsedArgs && typeof parsedArgs === "object" ? parsedArgs : {},
    status: ToolCallStatus.InProgress,
    result: undefined,
  };
}

export function getToolCallMemoDeps(
  toolCall: ToolCall,
  messages: Message[],
  executingToolCallIds: ReadonlySet<string>,
  renderToolCalls: readonly VueToolCallRenderer<unknown>[],
  agentId: string = DEFAULT_AGENT_ID,
): unknown[] {
  return [
    toolCall.id,
    toolCall.function.name,
    toolCall.function.arguments,
    findToolMessage(messages, toolCall.id)?.content,
    executingToolCallIds.has(toolCall.id),
    getCoreRenderConfig(toolCall, renderToolCalls, agentId)?.render,
  ];
}
