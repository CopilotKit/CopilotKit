import type { ThreadDebuggerMessage } from "../../../shared/thread-debugger/types.js";

export interface ConversationUser {
  id: string;
  type: "user";
  content: string;
  createdAt: string;
}

export interface ConversationAssistant {
  id: string;
  type: "assistant";
  content: string;
  createdAt: string;
}

export interface ConversationToolCall {
  id: string;
  type: "tool_call";
  toolName: string;
  toolCallId: string;
  arguments: Record<string, unknown>;
  result: Record<string, unknown> | null;
  createdAt: string;
  groupId?: string;
}

export interface ConversationReasoning {
  id: string;
  type: "reasoning";
  duration: string;
  createdAt: string;
}

export interface ConversationStateUpdate {
  id: string;
  type: "state_update";
  createdAt: string;
}

export interface ConversationAgentResponded {
  id: string;
  type: "agent_responded";
  createdAt: string;
}

export interface ConversationGenerativeUIItem {
  id: string;
  type: "generative-ui";
  activityType: string;
  createdAt: string;
}

export interface ToolCallGroup {
  type: "tool_call_group";
  id: string;
  items: ConversationToolCall[];
}

export type ConversationItem =
  | ConversationUser
  | ConversationAssistant
  | ConversationToolCall
  | ConversationReasoning
  | ConversationStateUpdate
  | ConversationAgentResponded
  | ConversationGenerativeUIItem;

export type ConversationRenderItem = ConversationItem | ToolCallGroup;

function textFromUnknownContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (typeof part === "string") {
        parts.push(part);
        continue;
      }
      if (typeof part === "object" && part !== null && "text" in part) {
        const text = part.text;
        if (typeof text === "string") parts.push(text);
      }
    }
    return parts.join("");
  }
  if (typeof content === "object" && content !== null && "text" in content) {
    const text = content.text;
    if (typeof text === "string") return text;
  }
  return "";
}

function parseToolCallContent(
  content: string | null | undefined,
): Record<string, unknown> {
  const normalizedContent = content?.trim();
  if (!normalizedContent) return {};
  return JSON.parse(normalizedContent);
}

export function adaptThreadMessages(
  messages: ThreadDebuggerMessage[],
): ConversationItem[] {
  const items: ConversationItem[] = [];
  const toolCallMap = new Map<string, ConversationToolCall>();
  for (const message of messages) {
    if (message.role === "user") {
      const content = textFromUnknownContent(message.content);
      if (content) {
        items.push({
          id: message.id,
          type: "user",
          content,
          createdAt: "",
        });
      }
      continue;
    }

    if (message.role === "assistant") {
      for (const toolCall of message.toolCalls ?? []) {
        let args: Record<string, unknown> = {};
        if (typeof toolCall.args === "string") {
          try {
            args = parseToolCallContent(toolCall.args);
          } catch (error) {
            console.error(
              "[CopilotKit Inspector] Failed to parse tool-call arguments",
              { toolCallId: toolCall.id, raw: toolCall.args, error },
            );
            args = { __parseError: true, __raw: toolCall.args };
          }
        } else {
          args = toolCall.args;
        }
        const item: ConversationToolCall = {
          id: toolCall.id,
          type: "tool_call",
          toolName: toolCall.name,
          toolCallId: toolCall.id,
          arguments: args,
          result: null,
          createdAt: "",
        };
        toolCallMap.set(toolCall.id, item);
        items.push(item);
      }
      const content = textFromUnknownContent(message.content);
      if (content) {
        items.push({
          id: message.id,
          type: "assistant",
          content,
          createdAt: "",
        });
      }
      continue;
    }

    if (message.role === "activity") {
      items.push({
        id: message.id,
        type: "generative-ui",
        activityType: message.activityType ?? "unknown",
        createdAt: "",
      });
      continue;
    }

    if (message.role === "tool" && message.toolCallId) {
      const toolCall = toolCallMap.get(message.toolCallId);
      if (!toolCall) continue;
      try {
        toolCall.result = parseToolCallContent(message.content);
      } catch (error) {
        console.error(
          "[CopilotKit Inspector] Failed to parse tool-call result content",
          { toolCallId: message.toolCallId, raw: message.content, error },
        );
        toolCall.result = {
          __parseError: true,
          __raw: message.content ?? null,
        };
      }
    }
  }
  return items;
}

export function groupConversationItems(
  items: ConversationItem[],
): ConversationRenderItem[] {
  const result: ConversationRenderItem[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (item.type === "agent_responded") continue;
    if (item.type !== "tool_call" || !item.groupId) {
      result.push(item);
      continue;
    }
    if (seen.has(item.groupId)) continue;
    seen.add(item.groupId);
    result.push({
      type: "tool_call_group",
      id: item.groupId,
      items: items.filter(
        (candidate): candidate is ConversationToolCall =>
          candidate.type === "tool_call" && candidate.groupId === item.groupId,
      ),
    });
  }
  return result;
}
