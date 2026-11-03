import type { Message, ToolCall } from "@ag-ui/core";
import {
  ɵbuildToolCallRenderProps,
  ɵfindToolMessage,
  ɵresolveToolCallAgentId,
  ɵresolveToolCallRenderer,
} from "@copilotkit/core";
import type { CopilotChatToolCallRenderSlotProps } from "./types";
import type {
  VueToolCallRenderer,
  VueToolCallRendererRenderProps,
} from "../../types";

export function getToolCallSlotName(toolName: string): `tool-call-${string}` {
  return `tool-call-${toolName}`;
}

/** Props for a `tool-call` / `tool-call-<name>` slot. */
export function getToolCallRenderProps(
  toolCall: ToolCall,
  messages: Message[],
  executingToolCallIds: ReadonlySet<string>,
): CopilotChatToolCallRenderSlotProps {
  const toolMessage = ɵfindToolMessage(messages, toolCall.id);
  const { name, args, status, result } = ɵbuildToolCallRenderProps(
    toolCall,
    toolMessage,
    { isExecuting: executingToolCallIds.has(toolCall.id) },
  );
  return { name, args, status, result, toolCall, toolMessage };
}

/** Props for a registered renderer's `render`. */
export function getCoreRenderProps(
  toolCall: ToolCall,
  messages: Message[],
  executingToolCallIds: ReadonlySet<string>,
): VueToolCallRendererRenderProps<unknown> {
  return ɵbuildToolCallRenderProps(
    toolCall,
    ɵfindToolMessage(messages, toolCall.id),
    { isExecuting: executingToolCallIds.has(toolCall.id) },
  );
}

export function getToolCallMemoDeps(
  toolCall: ToolCall,
  messages: Message[],
  executingToolCallIds: ReadonlySet<string>,
  renderToolCalls: readonly VueToolCallRenderer<unknown>[],
  agentId: string = ɵresolveToolCallAgentId(undefined, undefined),
): unknown[] {
  return [
    toolCall.id,
    toolCall.function.name,
    toolCall.function.arguments,
    ɵfindToolMessage(messages, toolCall.id)?.content,
    executingToolCallIds.has(toolCall.id),
    ɵresolveToolCallRenderer(renderToolCalls, toolCall.function.name, agentId)
      ?.render,
  ];
}
