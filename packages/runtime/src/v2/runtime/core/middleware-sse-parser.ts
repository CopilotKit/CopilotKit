import { logger } from "@copilotkit/shared";
import type { ToolCall as SnapshotToolCall } from "@ag-ui/core";

export interface ParsedSSEResult {
  messages: Message[];
  threadId?: string;
  runId?: string;
}

/** Minimal message shape reconstructed from AG-UI events. */
export interface Message {
  id: string;
  role: string;
  content?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

type ToolCall = SnapshotToolCall | ReconstructedToolCall;

interface ReconstructedToolCall {
  id: string;
  name: string;
  args: string;
}

/**
 * Parse a cloned SSE Response body into structured messages.
 * Returns empty results for non-SSE responses.
 */
export async function parseSSEResponse(
  response: Response,
): Promise<ParsedSSEResult> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    return { messages: [] };
  }

  let text: string;
  try {
    text = await response.text();
  } catch {
    logger.warn("Failed to read SSE response body in afterRequestMiddleware");
    return { messages: [] };
  }

  if (!text.trim()) {
    return { messages: [] };
  }

  let threadId: string | undefined;
  let runId: string | undefined;
  const messagesById = new Map<string, Message>();
  const toolCallsById = new Map<string, ToolCall>();
  const toolCallParent = new Map<string, string>(); // toolCallId → messageId

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;

    let event: Record<string, any>;
    try {
      event = JSON.parse(trimmed.slice(5).trim());
    } catch {
      continue;
    }

    switch (event.type) {
      case "RUN_STARTED":
        threadId = event.threadId;
        runId = event.runId;
        break;

      case "MESSAGES_SNAPSHOT":
        if (Array.isArray(event.messages)) {
          // A snapshot replaces the history at this point in the stream;
          // subsequent events must still contribute to the final messages.
          messagesById.clear();
          toolCallsById.clear();
          toolCallParent.clear();
          for (const message of event.messages) {
            messagesById.set(message.id, message);
            for (const toolCall of message.toolCalls ?? []) {
              toolCallsById.set(toolCall.id, toolCall);
              toolCallParent.set(toolCall.id, message.id);
            }
          }
        }
        break;

      case "TEXT_MESSAGE_START":
        if (!messagesById.has(event.messageId)) {
          messagesById.set(event.messageId, {
            id: event.messageId,
            role: event.role ?? "assistant",
            content: "",
          });
        }
        break;

      case "TEXT_MESSAGE_CONTENT": {
        const msg = messagesById.get(event.messageId);
        if (msg) {
          msg.content = (msg.content ?? "") + (event.delta ?? "");
        }
        break;
      }

      case "TEXT_MESSAGE_CHUNK": {
        // Chunk format: combined start+content. First chunk creates the
        // message, subsequent chunks append delta to content.
        if (event.messageId) {
          const existing = messagesById.get(event.messageId);
          if (existing) {
            existing.content = (existing.content ?? "") + (event.delta ?? "");
          } else {
            messagesById.set(event.messageId, {
              id: event.messageId,
              role: event.role ?? "assistant",
              content: event.delta ?? "",
            });
          }
        }
        break;
      }

      case "TOOL_CALL_START": {
        const tc: ToolCall = toolCallsById.get(event.toolCallId) ?? {
          id: event.toolCallId,
          name: event.toolCallName,
          args: "",
        };
        toolCallsById.set(event.toolCallId, tc);
        if (event.parentMessageId) {
          toolCallParent.set(event.toolCallId, event.parentMessageId);
        }
        break;
      }

      case "TOOL_CALL_ARGS": {
        const tc = toolCallsById.get(event.toolCallId);
        if (tc) {
          if ("function" in tc) {
            tc.function.arguments += event.delta ?? "";
          } else {
            tc.args += event.delta ?? "";
          }
        }
        break;
      }

      case "TOOL_CALL_CHUNK": {
        // Chunk format: combined start+args. First chunk for a given
        // toolCallId creates the tool call, subsequent chunks append delta.
        if (event.toolCallId) {
          let tc = toolCallsById.get(event.toolCallId);
          if (!tc) {
            tc = {
              id: event.toolCallId,
              name: event.toolCallName ?? "",
              args: "",
            };
            toolCallsById.set(event.toolCallId, tc);
            if (event.parentMessageId) {
              toolCallParent.set(event.toolCallId, event.parentMessageId);
            }
          }
          if (event.toolCallName) {
            if ("function" in tc) {
              tc.function.name = event.toolCallName;
            } else {
              tc.name = event.toolCallName;
            }
          }
          if ("function" in tc) {
            tc.function.arguments += event.delta ?? "";
          } else {
            tc.args += event.delta ?? "";
          }
        }
        break;
      }

      case "TOOL_CALL_END": {
        const tc = toolCallsById.get(event.toolCallId);
        const parentId = toolCallParent.get(event.toolCallId);
        if (tc && parentId) {
          const parent = messagesById.get(parentId);
          if (parent) {
            parent.toolCalls = parent.toolCalls ?? [];
            if (!parent.toolCalls.some((toolCall) => toolCall.id === tc.id)) {
              parent.toolCalls.push(tc);
            }
          }
        }
        break;
      }

      case "TOOL_CALL_RESULT": {
        // langchain-mcp-adapters may send content as an array of
        // {type:"text", text:string} objects instead of a plain string.
        let resultContent = event.content;
        if (Array.isArray(resultContent)) {
          resultContent = resultContent
            .filter((part: any) => part && typeof part.text === "string")
            .map((part: any) => part.text)
            .join("");
        }
        messagesById.set(event.messageId, {
          id: event.messageId,
          role: "tool",
          content: resultContent,
          toolCallId: event.toolCallId,
        });
        break;
      }
    }
  }

  // Attach any tool calls not yet linked to their parent message.
  // This handles TOOL_CALL_CHUNK flows which don't emit TOOL_CALL_END.
  for (const [toolCallId, tc] of toolCallsById) {
    const parentId = toolCallParent.get(toolCallId);
    if (!parentId) continue;
    const parent = messagesById.get(parentId);
    if (!parent) continue;
    const alreadyAttached = parent.toolCalls?.some((t) => t.id === tc.id);
    if (!alreadyAttached) {
      parent.toolCalls = parent.toolCalls ?? [];
      parent.toolCalls.push(tc);
    }
  }

  const messages = [...messagesById.values()];

  return { messages, threadId, runId };
}
