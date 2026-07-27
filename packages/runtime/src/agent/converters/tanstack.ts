import type {
  BaseEvent,
  Interrupt,
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
import { EventType } from "@ag-ui/client";
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
 * A TanStack AI client-side tool, derived from a frontend-provided AG-UI tool.
 *
 * Shaped to match `@tanstack/ai`'s `ClientTool` (`__toolSide: "client"`, no
 * `execute`): the model may CALL it, but TanStack does not run it — it pauses
 * the run and hands the call back to the AG-UI client (the CopilotKit frontend
 * / bot) to execute, mirroring CopilotKit's client-tool round-trip. `chat()`
 * accepts a JSON Schema directly as `inputSchema`, so the AG-UI tool's
 * `parameters` pass through unchanged.
 */
export interface TanStackClientTool {
  __toolSide: "client";
  name: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputSchema: any;
}

/**
 * Result of converting RunAgentInput to TanStack AI format.
 */
export interface TanStackInputResult {
  /** Chat messages (only user/assistant/tool roles; all others excluded) */
  messages: TanStackChatMessage[];
  /** System prompts extracted from system/developer messages, context, and state */
  systemPrompts: string[];
  /**
   * Client-side tools derived from `input.tools` (the frontend-provided tools
   * the CopilotKit client forwards on every run). Pass these into `chat()`
   * alongside any server/provider tools so the model can call the frontend's
   * generative-UI and human-in-the-loop tools; TanStack pauses the run on a
   * client-tool call and the client executes it.
   */
  tools: TanStackClientTool[];
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
 * Recursively normalizes a frontend tool's JSON Schema so OpenAI accepts it as
 * a function-tool schema.
 *
 * Frontend tools are often authored with permissive Zod (`z.any()`,
 * `z.record(...)`, `.passthrough()`), which serialize to open objects —
 * `additionalProperties: {}` (an empty sub-schema) or `additionalProperties:
 * true`. OpenAI rejects both: strict mode requires `additionalProperties:
 * false`, and an empty `{}` sub-schema fails base validation ("schema must
 * have a 'type' key"). The classic (Vercel AI SDK) path sanitized these
 * implicitly via a Zod round-trip; the TanStack path forwards the raw schema,
 * so we close open objects here to match. (Models can't supply free-form extra
 * keys either way — same as the classic path.)
 */
function sanitizeClientToolSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map(sanitizeClientToolSchema);
  }
  if (!schema || typeof schema !== "object") {
    return schema;
  }
  const node: Record<string, unknown> = {
    ...(schema as Record<string, unknown>),
  };

  // Any `additionalProperties` (empty `{}`, `true`, or a sub-schema) becomes
  // `false` — the only form OpenAI accepts for strict function tools.
  if ("additionalProperties" in node) {
    node.additionalProperties = false;
  }

  if (node.properties && typeof node.properties === "object") {
    const props: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(
      node.properties as Record<string, unknown>,
    )) {
      props[key] = sanitizeClientToolSchema(value);
    }
    node.properties = props;
  }

  if ("items" in node) {
    node.items = sanitizeClientToolSchema(node.items);
  }

  for (const combinator of ["anyOf", "allOf", "oneOf"] as const) {
    if (Array.isArray(node[combinator])) {
      node[combinator] = (node[combinator] as unknown[]).map(
        sanitizeClientToolSchema,
      );
    }
  }

  return node;
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

  // Frontend-provided tools become client-side TanStack tools (no executor):
  // the model can call them, TanStack pauses the run, and the AG-UI client
  // executes them and resumes — the CopilotKit client-tool round-trip.
  const tools: TanStackClientTool[] = (input.tools ?? []).map((t) => ({
    __toolSide: "client",
    name: t.name,
    description: t.description,
    inputSchema: sanitizeClientToolSchema(t.parameters),
  }));

  return { messages, systemPrompts, tools };
}

/**
 * Converts a TanStack AI stream into AG-UI `BaseEvent` objects.
 *
 * This is a pure converter — it does NOT emit lifecycle events
 * (RUN_STARTED / RUN_FINISHED / RUN_ERROR). The caller (Agent class)
 * is responsible for those.
 *
 * `pendingInterrupts`, when provided, is filled with one AG-UI Interrupt per
 * CUSTOM "approval-requested" chunk (a tool declared `needsApproval: true`).
 * The caller turns a non-empty array into a RUN_FINISHED `outcome:interrupt`.
 */
export async function* convertTanStackStream(
  stream: AsyncIterable<unknown>,
  abortSignal: AbortSignal,
  pendingInterrupts?: Interrupt[],
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

  // TanStack's chat() engine runs a multi-turn agent loop and emits a
  // RUN_STARTED / RUN_FINISHED pair PER model turn — not once for the whole
  // run. When it executes a tool itself (an MCP server tool or a provider tool
  // like web_search), it does so between turns and streams a TOOL_CALL_RESULT
  // followed by the next turn's text. The overall run lifecycle is owned by the
  // Agent wrapper (it emits exactly one outer RUN_STARTED / RUN_FINISHED), so
  // we drop TanStack's per-turn lifecycle markers and convert every content
  // event across all turns. (A previous version stopped converting at the first
  // RUN_FINISHED — that truncated the run at the first tool turn and silently
  // dropped both the tool result and the model's final answer.)
  //
  // chat() can re-announce a tool call when it re-prompts after executing it,
  // so START / END are de-duplicated by toolCallId to avoid emitting a pair
  // twice (which would violate the ag-ui verify middleware).
  const startedToolCalls = new Set<string>();
  const endedToolCalls = new Set<string>();

  for await (const chunk of stream) {
    if (abortSignal.aborted) break;

    const raw = chunk as Record<string, unknown>;
    const type = raw.type as string;

    // TanStack native human-in-the-loop: a tool declared `needsApproval: true`
    // emits a CUSTOM "approval-requested" chunk. These are built from the
    // finish event and can arrive around lifecycle markers, so handle them
    // before dropping TanStack's per-turn lifecycle events.
    // The tool-call lifecycle was already streamed in the model pass.
    if (type === "CUSTOM" && raw.name === "approval-requested") {
      const value = (raw.value ?? {}) as {
        toolCallId?: string;
        toolName?: string;
      };
      const toolCallId = value.toolCallId;
      if (toolCallId) {
        pendingInterrupts?.push({
          id: toolCallId,
          toolCallId,
          reason: "tool_approval",
          message: value.toolName ? `Approve "${value.toolName}"?` : undefined,
          ...(value.toolName ? { metadata: { toolName: value.toolName } } : {}),
        });
      }
      continue;
    }

    // Per-turn lifecycle markers are owned by the Agent wrapper, not forwarded.
    if (type === "RUN_STARTED" || type === "RUN_FINISHED") {
      continue;
    }

    // Surface engine errors instead of dropping them: throw so the Agent
    // wrapper emits a terminal RUN_ERROR. Without this a failed run (e.g. a
    // provider 4xx) would finish empty with no indication of what went wrong.
    if (type === "RUN_ERROR") {
      throw new Error(
        typeof raw.message === "string" ? raw.message : "TanStack AI run error",
      );
    }

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
      const toolCallId = raw.toolCallId as string;
      if (startedToolCalls.has(toolCallId)) continue;
      startedToolCalls.add(toolCallId);
      yield* closeReasoningIfOpen();
      toolNamesById.set(toolCallId, raw.toolCallName as string);
      const startEvent: ToolCallStartEvent = {
        type: EventType.TOOL_CALL_START,
        parentMessageId: messageId,
        toolCallId,
        toolCallName: raw.toolCallName as string,
      };
      yield startEvent;
    } else if (type === "TOOL_CALL_ARGS") {
      // Drop args re-announced after the call has ended (the re-prompt pass);
      // forwarding them would corrupt the already-closed call's accumulated args.
      if (endedToolCalls.has(raw.toolCallId as string)) continue;
      yield* closeReasoningIfOpen();
      const argsEvent: ToolCallArgsEvent = {
        type: EventType.TOOL_CALL_ARGS,
        toolCallId: raw.toolCallId as string,
        delta: raw.delta as string,
      };
      yield argsEvent;
    } else if (type === "TOOL_CALL_END") {
      const toolCallId = raw.toolCallId as string;
      if (endedToolCalls.has(toolCallId)) continue;
      endedToolCalls.add(toolCallId);
      yield* closeReasoningIfOpen();
      const endEvent: ToolCallEndEvent = {
        type: EventType.TOOL_CALL_END,
        toolCallId,
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
