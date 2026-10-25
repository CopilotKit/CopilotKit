import { logger } from "@copilotkit/shared";

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

interface ToolCall {
  id: string;
  name: string;
  args: string;
}

/** Events that end every open chunk stream, as in @ag-ui/client. */
const RUN_BOUNDARY_EVENTS = new Set([
  "RUN_STARTED",
  "RUN_FINISHED",
  "RUN_ERROR",
  "MESSAGES_SNAPSHOT",
]);

/** Events that pass between chunks without ending the open chunk stream. */
const CHUNK_TRANSPARENT_EVENTS = new Set([
  "TEXT_MESSAGE_CHUNK",
  "TOOL_CALL_CHUNK",
  "RAW",
  "ACTIVITY_SNAPSHOT",
  "ACTIVITY_DELTA",
  "REASONING_ENCRYPTED_VALUE",
  "SUBAGENT_STARTED",
]);

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
  let snapshotMessages: Message[] | undefined;

  // The chunk stream still open in each subagent lane. As in @ag-ui/client, a
  // TEXT_MESSAGE_CHUNK or TOOL_CALL_CHUNK without an id continues the open
  // chunk of the same kind; OpenAI-style streams send the tool call id only on
  // the first delta.
  const openChunks = new Map<string, { kind: "text" | "tool"; id: string }>();

  // Link a tool call to its assistant message the way @ag-ui/client does. A
  // tool-only turn streams no TEXT_MESSAGE_START, so the parent may not exist
  // yet; create it, keyed by toolCallId when parentMessageId is missing or
  // names a non-assistant message.
  const linkToolCallParent = (toolCallId: string, parentMessageId?: string) => {
    const parent = parentMessageId
      ? messagesById.get(parentMessageId)
      : undefined;
    const parentId =
      parentMessageId && (!parent || parent.role === "assistant")
        ? parentMessageId
        : toolCallId;
    if (!messagesById.has(parentId)) {
      messagesById.set(parentId, { id: parentId, role: "assistant" });
    }
    toolCallParent.set(toolCallId, parentId);
  };

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;

    let event: Record<string, any>;
    try {
      event = JSON.parse(trimmed.slice(5).trim());
    } catch {
      continue;
    }

    const lane: string = event.subagentRunId ?? "";
    if (RUN_BOUNDARY_EVENTS.has(event.type)) {
      openChunks.clear();
    } else if (!CHUNK_TRANSPARENT_EVENTS.has(event.type)) {
      openChunks.delete(lane);
    }

    switch (event.type) {
      case "RUN_STARTED":
        threadId = event.threadId;
        runId = event.runId;
        break;

      case "MESSAGES_SNAPSHOT":
        if (Array.isArray(event.messages)) {
          snapshotMessages = event.messages;
        }
        break;

      case "TEXT_MESSAGE_START":
        messagesById.set(event.messageId, {
          id: event.messageId,
          role: event.role ?? "assistant",
          content: "",
        });
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
        const open = openChunks.get(lane);
        const messageId: string | undefined =
          event.messageId ?? (open?.kind === "text" ? open.id : undefined);
        if (messageId) {
          const existing = messagesById.get(messageId);
          if (existing) {
            existing.content = (existing.content ?? "") + (event.delta ?? "");
          } else {
            messagesById.set(messageId, {
              id: messageId,
              role: event.role ?? "assistant",
              content: event.delta ?? "",
            });
          }
          openChunks.set(lane, { kind: "text", id: messageId });
        }
        break;
      }

      case "TOOL_CALL_START": {
        const tc: ToolCall = {
          id: event.toolCallId,
          name: event.toolCallName,
          args: "",
        };
        toolCallsById.set(event.toolCallId, tc);
        linkToolCallParent(event.toolCallId, event.parentMessageId);
        break;
      }

      case "TOOL_CALL_ARGS": {
        const tc = toolCallsById.get(event.toolCallId);
        if (tc) {
          tc.args += event.delta ?? "";
        }
        break;
      }

      case "TOOL_CALL_CHUNK": {
        // Chunk format: combined start+args. First chunk for a given
        // toolCallId creates the tool call, subsequent chunks append delta.
        const open = openChunks.get(lane);
        const toolCallId: string | undefined =
          event.toolCallId ?? (open?.kind === "tool" ? open.id : undefined);
        if (toolCallId) {
          let tc = toolCallsById.get(toolCallId);
          if (!tc) {
            tc = {
              id: toolCallId,
              name: event.toolCallName ?? "",
              args: "",
            };
            toolCallsById.set(toolCallId, tc);
            linkToolCallParent(toolCallId, event.parentMessageId);
          }
          if (event.toolCallName) {
            tc.name = event.toolCallName;
          }
          tc.args += event.delta ?? "";
          openChunks.set(lane, { kind: "tool", id: toolCallId });
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
            parent.toolCalls.push(tc);
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

  // Prefer MESSAGES_SNAPSHOT if present (contains full history).
  // Otherwise reconstruct from individual events.
  const messages = snapshotMessages ?? [...messagesById.values()];

  return { messages, threadId, runId };
}
