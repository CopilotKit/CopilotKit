import type {
  BaseEvent,
  InputContent,
  Message,
  TextMessageChunkEvent,
  RawEvent,
  ToolCallArgsEvent,
  ToolCallEndEvent,
  ToolCallStartEvent,
  ToolCallResultEvent,
} from "@ag-ui/client";
import { EventType, randomUUID } from "@ag-ui/client";
import type {
  A2AMessage,
  A2APart,
  A2ATextPart,
  A2ADataPart,
  A2AFilePart,
  A2AStreamEvent,
  ConvertAGUIMessagesOptions,
  ConvertedA2AMessages,
  ConvertA2AEventOptions,
} from "./types";

const ROLE_MAP: Record<string, "user" | "agent" | undefined> = {
  user: "user",
  assistant: "agent",
  tool: "agent",
  system: "user",
  developer: "user",
};

const TOOL_RESULT_PART_TYPE = "tool-result";
const TOOL_CALL_PART_TYPE = "tool-call";
const SURFACE_OPERATION_KEYS = [
  "beginRendering",
  "surfaceUpdate",
  "dataModelUpdate",
] as const;

type SurfaceOperationKey = (typeof SURFACE_OPERATION_KEYS)[number];

const isBinaryContent = (
  content: InputContent,
): content is Extract<InputContent, { type: "binary" }> => content.type === "binary";

const isTextContent = (content: InputContent): content is Extract<InputContent, { type: "text" }> =>
  content.type === "text";

const createTextPart = (text: string): A2ATextPart => ({
  kind: "text",
  text,
});

const createFilePart = (content: Extract<InputContent, { type: "binary" }>): A2AFilePart | null => {
  if (content.url) {
    return {
      kind: "file",
      file: {
        uri: content.url,
        mimeType: content.mimeType,
        name: content.filename,
      },
    };
  }

  if (content.data) {
    return {
      kind: "file",
      file: {
        bytes: content.data,
        mimeType: content.mimeType,
        name: content.filename,
      },
    };
  }

  return null;
};

const extractSurfaceOperation = (
  payload: unknown,
): { surfaceId: string; operation: Record<string, unknown> } | null => {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;

  for (const key of SURFACE_OPERATION_KEYS) {
    const value = record[key as SurfaceOperationKey];
    if (value && typeof value === "object" && (value as { surfaceId?: unknown }).surfaceId) {
      const surfaceId = (value as { surfaceId?: unknown }).surfaceId;
      if (typeof surfaceId === "string" && surfaceId.length > 0) {
        return { surfaceId, operation: record };
      }
    }
  }

  return null;
};

const safeJsonParse = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch (error) {
    return value;
  }
};

const messageContentToParts = (message: Message): A2APart[] => {
  const parts: A2APart[] = [];
  const { content } = message as { content?: Message["content"] };

  if (typeof content === "string") {
    const trimmed = content.trim();
    if (trimmed.length > 0) {
      parts.push(createTextPart(trimmed));
    }
  } else if (Array.isArray(content)) {
    for (const chunk of content) {
      if (isTextContent(chunk)) {
        const value = chunk.text.trim();
        if (value.length > 0) {
          parts.push(createTextPart(value));
        }
      } else if (isBinaryContent(chunk)) {
        const filePart = createFilePart(chunk);
        if (filePart) {
          parts.push(filePart);
        }
      } else {
        parts.push({ kind: "data", data: chunk } as A2ADataPart);
      }
    }
  } else if (content && typeof content === "object") {
    parts.push({
      kind: "data",
      data: content as Record<string, unknown>,
    });
  }

  if (message.role === "assistant" && "toolCalls" in message && message.toolCalls?.length) {
    for (const toolCall of message.toolCalls) {
      parts.push({
        kind: "data",
        data: {
          type: TOOL_CALL_PART_TYPE,
          id: toolCall.id,
          name: toolCall.function.name,
          arguments: safeJsonParse(toolCall.function.arguments),
          rawArguments: toolCall.function.arguments,
        },
      });
    }
  }

  if (message.role === "tool") {
    const payload = typeof message.content === "string" ? safeJsonParse(message.content) : message.content;
    parts.push({
      kind: "data",
      data: {
        type: TOOL_RESULT_PART_TYPE,
        toolCallId: message.toolCallId,
        payload,
      },
    });
  }

  return parts;
};

const messageContentToText = (message: Message): string => {
  const { content } = message as { content?: Message["content"] };
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((part): part is Extract<InputContent, { type: "text" }> => isTextContent(part))
      .map((part) => part.text)
      .join("\n");
  }
  if (content && typeof content === "object") {
    return JSON.stringify(content);
  }
  return "";
};

export function convertAGUIMessagesToA2A(
  messages: Message[],
  options: ConvertAGUIMessagesOptions = {},
): ConvertedA2AMessages {
  const history: A2AMessage[] = [];
  const includeToolMessages = options.includeToolMessages ?? true;
  const contextId = options.contextId;

  for (const message of messages) {
    if (message.role === "activity") {
      continue;
    }

    if (message.role === "tool" && !includeToolMessages) {
      continue;
    }

    if (message.role === "system" || message.role === "developer") {
      continue;
    }

    const mappedRole = ROLE_MAP[message.role] ?? (message.role === "tool" ? "agent" : undefined);

    if (!mappedRole) {
      continue;
    }

    const parts = messageContentToParts(message);

    if (parts.length === 0 && mappedRole !== "agent") {
      continue;
    }

    const messageId = message.id ?? randomUUID();

    history.push({
      kind: "message",
      messageId,
      role: mappedRole,
      parts,
      contextId,
    });
  }

  const latestUserMessage = [...history].reverse().find((msg) => msg.role === "user");

  return {
    contextId,
    history,
    latestUserMessage,
  };
}

const isA2AMessage = (event: A2AStreamEvent): event is A2AMessage => event.kind === "message";

const isA2ATask = (event: A2AStreamEvent): event is import("@a2a-js/sdk").Task => event.kind === "task";

const isA2AStatusUpdate = (
  event: A2AStreamEvent,
): event is import("@a2a-js/sdk").TaskStatusUpdateEvent => event.kind === "status-update";

function resolveMappedMessageId(
  originalId: string,
  options: ConvertA2AEventOptions,
  aliasKey?: string,
): string {
  if (aliasKey) {
    const existingAliasId = options.messageIdMap.get(aliasKey);
    if (existingAliasId) {
      options.messageIdMap.set(originalId, existingAliasId);
      return existingAliasId;
    }
  }

  const existingId = options.messageIdMap.get(originalId);
  if (existingId) {
    if (aliasKey) {
      options.messageIdMap.set(aliasKey, existingId);
    }
    return existingId;
  }

  const newId = randomUUID();
  options.messageIdMap.set(originalId, newId);
  if (aliasKey) {
    options.messageIdMap.set(aliasKey, newId);
  }
  return newId;
}

function convertMessageToEvents(
  message: A2AMessage,
  options: ConvertA2AEventOptions,
  aliasKey?: string,
): BaseEvent[] {
  const role = options.role ?? "assistant";
  const events: BaseEvent[] = [];

  const originalId = message.messageId ?? randomUUID();
  const mappedId = resolveMappedMessageId(originalId, options, aliasKey);

  const openToolCalls = new Set<string>();

  for (const part of message.parts ?? []) {
    if (part.kind === "text") {
      const textPart = part as A2ATextPart;
      const partText = textPart.text ?? "";
      if (partText) {
        const previousText = options.getCurrentText?.(mappedId) ?? "";

        if (partText !== previousText) {
          const deltaText = partText.startsWith(previousText)
            ? partText.slice(previousText.length)
            : partText;

          if (deltaText.length > 0) {
            const chunkEvent: TextMessageChunkEvent = {
              type: EventType.TEXT_MESSAGE_CHUNK,
              messageId: mappedId,
              role,
              delta: deltaText,
            };
            options.onTextDelta?.({ messageId: mappedId, delta: deltaText });
            events.push(chunkEvent);
          }
        }
      }
      continue;
    }

    if (part.kind === "data") {
      const dataPart = part as A2ADataPart;
      const payload = dataPart.data;

      if (payload && typeof payload === "object" && (payload as any).type === TOOL_CALL_PART_TYPE) {
        const toolCallId = (payload as any).id ?? randomUUID();
        const toolCallName = (payload as any).name ?? "unknown_tool";
        const args = (payload as any).arguments;

        const startEvent: ToolCallStartEvent = {
          type: EventType.TOOL_CALL_START,
          toolCallId,
          toolCallName,
          parentMessageId: mappedId,
        };
        events.push(startEvent);

        if (args !== undefined) {
          const argsEvent: ToolCallArgsEvent = {
            type: EventType.TOOL_CALL_ARGS,
            toolCallId,
            delta: JSON.stringify(args),
          };
          events.push(argsEvent);
        }

        openToolCalls.add(toolCallId);
        continue;
      }

      if (
        payload &&
        typeof payload === "object" &&
        (payload as any).type === TOOL_RESULT_PART_TYPE &&
        (payload as any).toolCallId
      ) {
        const toolCallId = (payload as any).toolCallId;
        const toolResultEvent: ToolCallResultEvent = {
          type: EventType.TOOL_CALL_RESULT,
          toolCallId,
          content: JSON.stringify((payload as any).payload ?? payload),
          messageId: randomUUID(),
          role: "tool",
        };
        events.push(toolResultEvent);

        if (openToolCalls.has(toolCallId)) {
          const endEvent: ToolCallEndEvent = {
            type: EventType.TOOL_CALL_END,
            toolCallId,
          };
          events.push(endEvent);
          openToolCalls.delete(toolCallId);
        }

        continue;
      }

      const surfaceOperation = extractSurfaceOperation(payload);
      if (surfaceOperation && options.surfaceTracker) {
        const tracker = options.surfaceTracker;
        const { surfaceId, operation } = surfaceOperation;
        const hasSeenSurface = tracker.has(surfaceId);

        if (!hasSeenSurface) {
          tracker.add(surfaceId);
          events.push({
            type: EventType.ACTIVITY_SNAPSHOT,
            messageId: surfaceId,
            activityType: "a2ui-surface",
            content: { operations: [] },
            replace: false,
          } as BaseEvent);
        }

        events.push({
          type: EventType.ACTIVITY_DELTA,
          messageId: surfaceId,
          activityType: "a2ui-surface",
          patch: [
            {
              op: "add",
              path: "/operations/-",
              value: operation,
            },
          ],
        } as BaseEvent);

        continue;
      }

      continue;
    }

    // Ignore other part kinds for now.
  }

  for (const toolCallId of openToolCalls) {
    const endEvent: ToolCallEndEvent = {
      type: EventType.TOOL_CALL_END,
      toolCallId,
    };
    events.push(endEvent);
  }

  return events;
}

export function convertA2AEventToAGUIEvents(
  event: A2AStreamEvent,
  options: ConvertA2AEventOptions,
): BaseEvent[] {
  const events: BaseEvent[] = [];
  const source = options.source ?? "a2a";

  if (isA2AMessage(event)) {
    return convertMessageToEvents(event, options);
  }

  if (isA2AStatusUpdate(event)) {
    const statusMessage = event.status?.message;
    const statusState = event.status?.state;
    const aliasKey = statusState && statusState !== "input-required" ? `${event.taskId}:status` : undefined;

    if (statusMessage && statusMessage.kind === "message") {
      return convertMessageToEvents(statusMessage as A2AMessage, options, aliasKey);
    }
    return events;
  }

  if (isA2ATask(event)) {
    const rawEvent: RawEvent = {
      type: EventType.RAW,
      event,
      source,
    };
    events.push(rawEvent);
    return events;
  }

  const fallbackEvent: RawEvent = {
    type: EventType.RAW,
    event,
    source,
  };
  events.push(fallbackEvent);
  return events;
}

export const sendMessageToA2AAgentTool = {
  name: "send_message_to_a2a_agent",
  description:
    "Sends a task to the agent named `agentName`, including the full conversation context and goal",
  parameters: {
    type: "object",
    properties: {
      agentName: {
        type: "string",
        description: "The name of the A2A agent to send the message to.",
      },
      task: {
        type: "string",
        description:
          "The comprehensive conversation-context summary and goal to be achieved regarding the user inquiry.",
      },
    },
    required: ["task"],
  },
} as const;
