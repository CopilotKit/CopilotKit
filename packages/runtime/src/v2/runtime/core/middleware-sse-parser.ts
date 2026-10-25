import { logger } from "@copilotkit/shared";

export interface ParsedSSEResult {
  response: Response;
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

/**
 * Consume an SSE response incrementally and retain a readable response for middleware.
 * Non-SSE responses are returned without consuming their bodies.
 */
export async function parseSSEResponse(
  response: Response,
): Promise<ParsedSSEResult> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream") || !response.body) {
    return { response, messages: [] };
  }

  // onResponse hooks can supply fetched responses. Preserve their native
  // metadata, which ResponseInit cannot reproduce, without buffering decoded text.
  const preserveMetadata =
    response.url !== "" || response.type !== "default" || response.redirected;
  const parserResponse = preserveMetadata ? response.clone() : response;
  const responseInit = {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  };
  const chunks: BlobPart[] = [];

  let threadId: string | undefined;
  let runId: string | undefined;
  const messagesById = new Map<string, Message>();
  const toolCallsById = new Map<string, ToolCall>();
  const toolCallParent = new Map<string, string>(); // toolCallId → messageId
  let snapshotMessages: Message[] | undefined;

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

  const processLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;

    let event: Record<string, any>;
    try {
      event = JSON.parse(trimmed.slice(5).trim());
    } catch {
      return;
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
        if (event.toolCallId) {
          let tc = toolCallsById.get(event.toolCallId);
          if (!tc) {
            tc = {
              id: event.toolCallId,
              name: event.toolCallName ?? "",
              args: "",
            };
            toolCallsById.set(event.toolCallId, tc);
            linkToolCallParent(event.toolCallId, event.parentMessageId);
          }
          if (event.toolCallName) {
            tc.name = event.toolCallName;
          }
          tc.args += event.delta ?? "";
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
  };

  const decoder = new TextDecoder();
  let pendingLine = "";
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    reader = parserResponse.body!.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!preserveMetadata) {
        // Copy the view, not its backing buffer, in case the producer reuses it.
        chunks.push(new Uint8Array(value));
      }
      pendingLine += decoder.decode(value, { stream: true });
      let start = 0;
      let end: number;
      while ((end = pendingLine.indexOf("\n", start)) !== -1) {
        processLine(pendingLine.slice(start, end));
        start = end + 1;
      }
      pendingLine = pendingLine.slice(start);
    }
    processLine(pendingLine + decoder.decode());
    pendingLine = "";
  } catch (error) {
    logger.warn("Failed to read SSE response body in afterRequestMiddleware");
    chunks.length = 0;
    return {
      response: preserveMetadata
        ? response
        : new Response(
            new ReadableStream({
              start(controller) {
                controller.error(error);
              },
            }),
            responseInit,
          ),
      messages: [],
    };
  } finally {
    reader?.releaseLock();
  }

  const middlewareResponse = preserveMetadata
    ? response
    : new Response(new Blob(chunks), responseInit);
  chunks.length = 0;

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

  return { response: middlewareResponse, messages, threadId, runId };
}
