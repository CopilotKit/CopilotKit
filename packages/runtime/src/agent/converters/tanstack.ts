import {
  BaseEvent,
  EventType,
  RunAgentInput,
  Message,
  TextMessageChunkEvent,
  ToolCallArgsEvent,
  ToolCallEndEvent,
  ToolCallStartEvent,
  ToolCallResultEvent,
  StateSnapshotEvent,
  StateDeltaEvent,
  ReasoningStartEvent,
  ReasoningMessageStartEvent,
  ReasoningMessageContentEvent,
  ReasoningMessageEndEvent,
  ReasoningEndEvent,
} from "@ag-ui/client";
import { randomUUID } from "@copilotkit/shared";

type ContentPartSource =
  | { type: "data"; value: string; mimeType: string }
  | { type: "url"; value: string; mimeType?: string };

/**
 * A TanStack AI content part (text, image, audio, video, or document).
 */
export type TanStackContentPart =
  | { type: "text"; content: string }
  | { type: "image"; source: ContentPartSource }
  | { type: "audio"; source: ContentPartSource }
  | { type: "video"; source: ContentPartSource }
  | { type: "document"; source: ContentPartSource };

/**
 * Message format expected by TanStack AI's `chat()`.
 *
 * Content is typed as `any[]` for the multimodal case so messages are directly
 * passable to any adapter without casts — different adapters constrain which
 * modalities they accept (e.g. OpenAI only allows text + image).
 * Use `TanStackContentPart` to inspect individual parts if needed.
 */
export interface TanStackChatMessage {
  role: "user" | "assistant" | "tool";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content: string | null | any[];
  name?: string;
  toolCalls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  toolCallId?: string;
}

/**
 * Result of converting RunAgentInput to TanStack AI format.
 */
export interface TanStackInputResult {
  /** Chat messages (only user/assistant/tool roles; all others excluded) */
  messages: TanStackChatMessage[];
  /** System prompts extracted from system/developer messages, context, and state */
  systemPrompts: string[];
}

/**
 * Converts AG-UI user message content to TanStack AI format.
 * Handles plain strings, multimodal parts (image/audio/video/document),
 * and legacy BinaryInputContent for backward compatibility.
 */
function convertUserContent(
  content: unknown,
): string | null | TanStackContentPart[] {
  if (!content) return null;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  if (content.length === 0) return "";

  const parts: TanStackContentPart[] = [];

  for (const part of content) {
    if (!part || typeof part !== "object" || !("type" in part)) continue;

    switch ((part as { type: string }).type) {
      case "text": {
        const text = (part as { text?: string }).text;
        if (text != null) parts.push({ type: "text", content: text });
        break;
      }

      case "image":
      case "audio":
      case "video":
      case "document": {
        const source = (part as { source?: any }).source;
        if (!source) break;
        const partType = (part as { type: string }).type as
          | "image"
          | "audio"
          | "video"
          | "document";
        if (source.type === "data") {
          parts.push({
            type: partType,
            source: {
              type: "data",
              value: source.value,
              mimeType: source.mimeType,
            },
          });
        } else if (source.type === "url") {
          parts.push({
            type: partType,
            source: {
              type: "url",
              value: source.value,
              ...(source.mimeType ? { mimeType: source.mimeType } : {}),
            },
          });
        }
        break;
      }

      // Legacy BinaryInputContent backward compatibility
      case "binary": {
        const legacy = part as {
          mimeType?: string;
          data?: string;
          url?: string;
        };
        const mimeType = legacy.mimeType ?? "application/octet-stream";
        const isImage = mimeType.startsWith("image/");

        if (legacy.data) {
          const partType = isImage ? "image" : "document";
          parts.push({
            type: partType,
            source: { type: "data", value: legacy.data, mimeType },
          });
        } else if (legacy.url) {
          const partType = isImage ? "image" : "document";
          parts.push({
            type: partType,
            source: { type: "url", value: legacy.url, mimeType },
          });
        }
        break;
      }
    }
  }

  return parts.length > 0 ? parts : "";
}

/**
 * Converts a RunAgentInput into the format expected by TanStack AI's `chat()`.
 *
 * - Keeps only user/assistant/tool messages (activity, reasoning, and other roles are also excluded)
 * - Extracts system/developer messages into `systemPrompts`
 * - Appends context entries and application state to `systemPrompts`
 * - Preserves tool calls on assistant messages and toolCallId on tool messages
 */
export function convertInputToTanStackAI(
  input: RunAgentInput,
): TanStackInputResult {
  // Allowlist: only pass user/assistant/tool messages to TanStack.
  // Other roles (system, developer, activity, reasoning) are either
  // extracted into systemPrompts or not applicable.
  const chatRoles = new Set(["user", "assistant", "tool"]);
  const messages: TanStackChatMessage[] = input.messages
    .filter((m: Message) => chatRoles.has(m.role))
    .map((m: Message): TanStackChatMessage => {
      const msg: TanStackChatMessage = {
        role: m.role as "user" | "assistant" | "tool",
        content:
          m.role === "user"
            ? convertUserContent(m.content)
            : typeof m.content === "string"
              ? m.content
              : null,
      };
      if (m.role === "assistant" && "toolCalls" in m && m.toolCalls) {
        msg.toolCalls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        }));
      }
      if (m.role === "tool" && "toolCallId" in m) {
        msg.toolCallId = (m as Record<string, unknown>).toolCallId as string;
      }
      return msg;
    });

  const systemPrompts: string[] = [];
  for (const m of input.messages) {
    if ((m.role === "system" || m.role === "developer") && m.content) {
      systemPrompts.push(
        typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      );
    }
  }

  if (input.context?.length) {
    for (const ctx of input.context) {
      systemPrompts.push(`${ctx.description}:\n${ctx.value}`);
    }
  }

  if (
    input.state !== undefined &&
    input.state !== null &&
    typeof input.state === "object" &&
    Object.keys(input.state).length > 0
  ) {
    systemPrompts.push(
      `Application State:\n\`\`\`json\n${JSON.stringify(input.state, null, 2)}\n\`\`\``,
    );
  }

  return { messages, systemPrompts };
}

/**
 * Converts a TanStack AI stream into AG-UI `BaseEvent` objects.
 *
 * This is a pure converter — it does NOT emit lifecycle events
 * (RUN_STARTED / RUN_FINISHED / RUN_ERROR). The caller (Agent class)
 * is responsible for those.
 */
export async function* convertTanStackStream(
  stream: AsyncIterable<unknown>,
  abortSignal: AbortSignal,
): AsyncGenerator<BaseEvent> {
  const messageId = randomUUID();
  const toolNamesById = new Map<string, string>();
  // Track the reasoning lifecycle at two granularities so closeReasoningIfOpen
  // emits exactly the events still owed. A single boolean conflates the run
  // (REASONING_START → REASONING_END) with the message
  // (REASONING_MESSAGE_START → REASONING_MESSAGE_END) and produces a duplicate
  // REASONING_MESSAGE_END when upstream emits MSG_END but not END before
  // text/tools resume.
  let reasoningRunOpen = false;
  let reasoningMessageOpen = false;
  let reasoningMessageId = randomUUID();

  function* closeReasoningIfOpen(): Generator<BaseEvent> {
    if (reasoningMessageOpen) {
      reasoningMessageOpen = false;
      const msgEnd: ReasoningMessageEndEvent = {
        type: EventType.REASONING_MESSAGE_END,
        messageId: reasoningMessageId,
      };
      yield msgEnd;
    }
    if (reasoningRunOpen) {
      reasoningRunOpen = false;
      const end: ReasoningEndEvent = {
        type: EventType.REASONING_END,
        messageId: reasoningMessageId,
      };
      yield end;
    }
  }

  // TanStack's chat() engine runs a multi-turn agent loop: after the model
  // returns tool calls, the engine tries to execute them and re-prompt. This
  // produces a second round of TOOL_CALL_START / TOOL_CALL_END events that
  // duplicate the ones from the first streaming pass. The CopilotKit runtime
  // handles tool execution externally (via the frontend SDK), so we must stop
  // converting events once the TanStack adapter signals the first turn is
  // complete with RUN_FINISHED.
  let runFinished = false;

  for await (const chunk of stream) {
    if (abortSignal.aborted) break;

    const raw = chunk as Record<string, unknown>;
    const type = raw.type as string;

    // Stop converting after the first RUN_FINISHED — any subsequent events
    // come from TanStack's internal tool-execution loop and would produce
    // duplicate TOOL_CALL_END events that violate the ag-ui verify middleware.
    if (type === "RUN_FINISHED") {
      runFinished = true;
      continue;
    }
    if (runFinished) continue;

    if (type === "TEXT_MESSAGE_CONTENT" && raw.delta != null) {
      yield* closeReasoningIfOpen();
      const textEvent: TextMessageChunkEvent = {
        type: EventType.TEXT_MESSAGE_CHUNK,
        role: "assistant",
        messageId,
        delta: raw.delta as string,
      };
      yield textEvent;
    } else if (type === "TOOL_CALL_START") {
      yield* closeReasoningIfOpen();
      toolNamesById.set(raw.toolCallId as string, raw.toolCallName as string);
      const startEvent: ToolCallStartEvent = {
        type: EventType.TOOL_CALL_START,
        parentMessageId: messageId,
        toolCallId: raw.toolCallId as string,
        toolCallName: raw.toolCallName as string,
      };
      yield startEvent;
    } else if (type === "TOOL_CALL_ARGS") {
      yield* closeReasoningIfOpen();
      const argsEvent: ToolCallArgsEvent = {
        type: EventType.TOOL_CALL_ARGS,
        toolCallId: raw.toolCallId as string,
        delta: raw.delta as string,
      };
      yield argsEvent;
    } else if (type === "TOOL_CALL_END") {
      yield* closeReasoningIfOpen();
      const endEvent: ToolCallEndEvent = {
        type: EventType.TOOL_CALL_END,
        toolCallId: raw.toolCallId as string,
      };
      yield endEvent;
    } else if (type === "TOOL_CALL_RESULT") {
      yield* closeReasoningIfOpen();
      const toolCallId = raw.toolCallId as string;
      const toolName = toolNamesById.get(toolCallId);
      // Accept the payload from either `content` (canonical TanStack shape)
      // or `result` (alternate shape used by some adapters / tests). Both
      // state-tool detection and the final TOOL_CALL_RESULT serialization
      // must read the same field, otherwise STATE_SNAPSHOT/STATE_DELTA can
      // be silently dropped when upstream uses `result`.
      const rawPayload = raw.content ?? raw.result;

      const parsedContent =
        typeof rawPayload === "string" ? safeParse(rawPayload) : rawPayload;

      if (
        toolName === "AGUISendStateSnapshot" &&
        parsedContent &&
        typeof parsedContent === "object" &&
        "snapshot" in parsedContent
      ) {
        const stateSnapshotEvent: StateSnapshotEvent = {
          type: EventType.STATE_SNAPSHOT,
          snapshot: (parsedContent as Record<string, unknown>).snapshot,
        };
        yield stateSnapshotEvent;
      }

      if (
        toolName === "AGUISendStateDelta" &&
        parsedContent &&
        typeof parsedContent === "object" &&
        "delta" in parsedContent
      ) {
        const stateDeltaEvent: StateDeltaEvent = {
          type: EventType.STATE_DELTA,
          delta: (parsedContent as Record<string, unknown>).delta as never,
        };
        yield stateDeltaEvent;
      }

      let serializedContent: string;
      if (typeof rawPayload === "string") {
        serializedContent = rawPayload;
      } else {
        try {
          serializedContent = JSON.stringify(rawPayload ?? null);
        } catch {
          serializedContent = "[Unserializable tool result]";
        }
      }

      const resultEvent: ToolCallResultEvent = {
        type: EventType.TOOL_CALL_RESULT,
        role: "tool",
        messageId: randomUUID(),
        toolCallId,
        content: serializedContent,
      };
      yield resultEvent;
      toolNamesById.delete(toolCallId);
    } else if (type === "REASONING_START") {
      // If a prior reasoning run is still open (no REASONING_END before this
      // new START), close it cleanly first so MSG_END / END pair correctly.
      yield* closeReasoningIfOpen();
      reasoningRunOpen = true;
      reasoningMessageId = (raw.messageId as string) ?? randomUUID();
      const startEvt: ReasoningStartEvent = {
        type: EventType.REASONING_START,
        messageId: reasoningMessageId,
      };
      yield startEvt;
    } else if (type === "REASONING_MESSAGE_START") {
      reasoningMessageOpen = true;
      const evt: ReasoningMessageStartEvent = {
        type: EventType.REASONING_MESSAGE_START,
        messageId: reasoningMessageId,
        role: "reasoning",
      };
      yield evt;
    } else if (type === "REASONING_MESSAGE_CONTENT") {
      const evt: ReasoningMessageContentEvent = {
        type: EventType.REASONING_MESSAGE_CONTENT,
        messageId: reasoningMessageId,
        delta: raw.delta as string,
      };
      yield evt;
    } else if (type === "REASONING_MESSAGE_END") {
      reasoningMessageOpen = false;
      const evt: ReasoningMessageEndEvent = {
        type: EventType.REASONING_MESSAGE_END,
        messageId: reasoningMessageId,
      };
      yield evt;
    } else if (type === "REASONING_END") {
      // If upstream sends REASONING_END while a message is still open, emit
      // the missing REASONING_MESSAGE_END FIRST so the closing pair stays in
      // order (MSG_END before END). Otherwise the next non-reasoning chunk
      // would trigger closeReasoningIfOpen and emit MSG_END after END.
      if (reasoningMessageOpen) {
        reasoningMessageOpen = false;
        const msgEnd: ReasoningMessageEndEvent = {
          type: EventType.REASONING_MESSAGE_END,
          messageId: reasoningMessageId,
        };
        yield msgEnd;
      }
      reasoningRunOpen = false;
      const evt: ReasoningEndEvent = {
        type: EventType.REASONING_END,
        messageId: reasoningMessageId,
      };
      yield evt;
    }
  }

  yield* closeReasoningIfOpen();
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
