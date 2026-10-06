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
  ReasoningEncryptedValueEvent,
} from "@ag-ui/client";
import { contentToText, EventType } from "@ag-ui/client";
import { randomUUID } from "@copilotkit/shared";
import { createStateEventNormalizer } from "../state-delta";
import {
  aggregateRunUsage,
  collectStandardRunFinishedDetails,
  getNonEmptyString,
  getTokenCount,
  isRecord,
} from "./usage";
import type { AgentRunFinishedDetails } from "./usage";

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
  thinking?: Array<{ content: string; signature?: string }>;
  toolCalls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
    metadata?: unknown;
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
  /** Chat messages (reasoning is replayed as assistant thinking) */
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
        } else if (source.type === "file") {
          // AG-UI 1.0 provider file handle: not a URL or inline data.
          console.warn(
            `[CopilotKit] Dropping a ${partType} part that references a provider file handle: it is not a URL or inline data, so it cannot be sent to the model here.`,
          );
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
 * - Keeps user/assistant/tool messages and replays reasoning as assistant thinking
 * - Extracts system/developer messages into `systemPrompts`
 * - Appends context entries and application state to `systemPrompts`
 * - Preserves tool calls on assistant messages and toolCallId on tool messages
 */
export function convertInputToTanStackAI(
  input: RunAgentInput,
): TanStackInputResult {
  // Reasoning gets its own assistant message at the same history position;
  // attaching it to a later assistant could cross a user/tool boundary.
  const chatRoles = new Set(["user", "assistant", "tool", "reasoning"]);
  const messages: TanStackChatMessage[] = input.messages
    .filter((m: Message) => chatRoles.has(m.role))
    .map((m: Message): TanStackChatMessage => {
      if (m.role === "reasoning") {
        const signature = getReasoningSignature(m);
        return {
          role: "assistant",
          content: null,
          thinking: [
            {
              content: m.content ?? "",
              ...(signature !== undefined ? { signature } : {}),
            },
          ],
        };
      }
      const msg: TanStackChatMessage = {
        role: m.role as "user" | "assistant" | "tool",
        content:
          m.role === "user"
            ? convertUserContent(m.content)
            : m.role === "tool"
              ? // A tool result is a string or a list of parts; TanStack takes
                // text here, so the text parts are concatenated.
                contentToText(m.content)
              : typeof m.content === "string"
                ? m.content
                : null,
      };
      if (m.role === "assistant" && "toolCalls" in m && m.toolCalls) {
        const toolCallMetadata = getTanStackMetadata(m)?.toolCallMetadata;
        msg.toolCalls = m.toolCalls.map((tc) => {
          const fallbackMetadata =
            isRecord(toolCallMetadata) &&
            Object.prototype.hasOwnProperty.call(toolCallMetadata, tc.id) &&
            isRecord(toolCallMetadata[tc.id])
              ? toolCallMetadata[tc.id]
              : undefined;
          const metadata =
            tc.metadata !== undefined ? tc.metadata : fallbackMetadata;
          const signature = getReasoningSignature(tc);
          return {
            id: tc.id,
            type: "function" as const,
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments,
            },
            ...(signature !== undefined
              ? {
                  metadata: {
                    ...(isRecord(metadata) ? metadata : {}),
                    thoughtSignature: signature,
                  },
                }
              : metadata !== undefined
                ? { metadata }
                : {}),
          };
        });
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

function getTanStackMetadata(value: {
  metadata?: unknown;
}): Record<string, unknown> | undefined {
  return isRecord(value.metadata) && isRecord(value.metadata.tanstack)
    ? value.metadata.tanstack
    : undefined;
}

/** Provider signatures are opaque: keep their bytes, including whitespace. */
function getReasoningSignature(value: {
  encryptedValue?: unknown;
  metadata?: unknown;
}): string | undefined {
  const signature = value.encryptedValue;
  if (typeof signature === "string" && signature !== "") return signature;
  const fallback = getTanStackMetadata(value)?.signature;
  return typeof fallback === "string" && fallback !== "" ? fallback : undefined;
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
  initialState?: unknown,
  runFinishedDetails?: AgentRunFinishedDetails,
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
  // REASONING_MESSAGE_START can supply a different ID from its enclosing span.
  // Keep START/END paired even when the message adopts an authoritative ID.
  let reasoningSpanId = reasoningMessageId;
  // These survive message closure and TanStack's per-turn RUN_FINISHED markers:
  // a signature can arrive after text/tools or while a newer reasoning is open.
  const reasoningMessages = new Set<string>();
  const reasoningByStep = new Map<string, string>();
  const pendingThinkingSteps = new Set<string>();
  let pendingEncryptedValues: Array<{
    event: ReasoningEncryptedValueEvent;
    sequence: number;
  }> = [];
  let encryptedSequence = 0;
  const deliveredEncryptedSequence = new Map<string, number>();
  const normalizeStateEvent = createStateEventNormalizer(initialState);

  function* closeReasoningIfOpen(): Generator<BaseEvent> {
    pendingThinkingSteps.clear();
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
        messageId: reasoningSpanId,
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

  function encryptedTarget(
    event: ReasoningEncryptedValueEvent,
  ): string | undefined {
    if (event.subtype === "tool-call") {
      return startedToolCalls.has(event.entityId) ? event.entityId : undefined;
    }
    // A real message ID always wins over a step alias.
    if (reasoningMessages.has(event.entityId)) return event.entityId;
    const target = reasoningByStep.get(event.entityId);
    return target && reasoningMessages.has(target) ? target : undefined;
  }

  function* flushEncryptedValues(final = false): Generator<BaseEvent> {
    const unresolved: typeof pendingEncryptedValues = [];
    for (const { event, sequence } of pendingEncryptedValues) {
      const entityId = encryptedTarget(event);
      if (entityId === undefined && !final) {
        unresolved.push({ event, sequence });
        continue;
      }
      const target = entityId ?? event.entityId;
      // encryptedValue is state per message/tool, not a globally ordered log.
      // Unknown entities must not block unrelated materialized targets. When
      // a late alias resolves, discard only updates proven older than a value
      // already delivered to that same entity, so replay cannot regress.
      const entityKey = `${event.subtype}:${target}`;
      if (sequence <= (deliveredEncryptedSequence.get(entityKey) ?? -1))
        continue;
      deliveredEncryptedSequence.set(entityKey, sequence);
      yield { ...event, entityId: target };
    }
    pendingEncryptedValues = unresolved;
  }

  for await (const chunk of stream) {
    if (abortSignal.aborted) break;

    const raw = chunk as Record<string, unknown>;
    const type = raw.type as string;

    if (type === "REASONING_ENCRYPTED_VALUE") {
      pendingEncryptedValues.push({
        event: raw as ReasoningEncryptedValueEvent,
        sequence: encryptedSequence++,
      });
      yield* flushEncryptedValues();
      continue;
    }

    if (type === "STEP_STARTED") {
      const tanstack = getTanStackMetadata(raw);
      const stepType = raw.stepType ?? tanstack?.stepType;
      const stepId =
        getNonEmptyString(raw.stepId) ??
        getNonEmptyString(tanstack?.stepId) ??
        getNonEmptyString(raw.stepName);
      if (stepType === "thinking" && stepId && !reasoningByStep.has(stepId)) {
        if (reasoningMessageOpen) {
          reasoningByStep.set(stepId, reasoningMessageId);
        } else if (
          reasoningRunOpen &&
          !reasoningMessages.has(reasoningMessageId)
        ) {
          // MESSAGE_START supplies the authoritative ID before materialization.
          pendingThinkingSteps.add(stepId);
        }
      }
      yield* flushEncryptedValues();
      continue;
    }

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
    if (type === "RUN_FINISHED") {
      collectTanStackRunFinishedDetails(raw, runFinishedDetails);
      continue;
    }
    if (type === "RUN_STARTED") continue;

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
        ...(raw.metadata !== undefined
          ? { metadata: raw.metadata as ToolCallStartEvent["metadata"] }
          : {}),
      };
      yield startEvent;
      yield* flushEncryptedValues();
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
        for (const event of normalizeStateEvent(stateSnapshotEvent)) {
          yield event;
        }
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
        for (const event of normalizeStateEvent(stateDeltaEvent)) {
          yield event;
        }
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
      reasoningSpanId = (raw.messageId as string) ?? randomUUID();
      reasoningMessageId = reasoningSpanId;
      const startEvt: ReasoningStartEvent = {
        type: EventType.REASONING_START,
        messageId: reasoningSpanId,
      };
      yield startEvt;
    } else if (type === "REASONING_MESSAGE_START") {
      reasoningMessageId =
        getNonEmptyString(raw.messageId) ?? reasoningMessageId;
      reasoningMessageOpen = true;
      reasoningMessages.add(reasoningMessageId);
      for (const stepId of pendingThinkingSteps) {
        reasoningByStep.set(stepId, reasoningMessageId);
      }
      pendingThinkingSteps.clear();
      const evt: ReasoningMessageStartEvent = {
        type: EventType.REASONING_MESSAGE_START,
        messageId: reasoningMessageId,
        role: "reasoning",
      };
      yield evt;
      yield* flushEncryptedValues();
    } else if (type === "REASONING_MESSAGE_CONTENT") {
      const evt: ReasoningMessageContentEvent = {
        type: EventType.REASONING_MESSAGE_CONTENT,
        messageId: reasoningMessageId,
        delta: raw.delta as string,
      };
      yield evt;
    } else if (type === "REASONING_MESSAGE_END") {
      if (!reasoningMessageOpen) continue;
      reasoningMessageOpen = false;
      const evt: ReasoningMessageEndEvent = {
        type: EventType.REASONING_MESSAGE_END,
        messageId: reasoningMessageId,
      };
      yield evt;
    } else if (type === "REASONING_END") {
      if (!reasoningRunOpen && !reasoningMessageOpen) continue;
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
      pendingThinkingSteps.clear();
      const evt: ReasoningEndEvent = {
        type: EventType.REASONING_END,
        messageId: reasoningSpanId,
      };
      yield evt;
    }
  }

  yield* closeReasoningIfOpen();
  // Unknown entities retain their original IDs; never guess the latest message.
  if (!abortSignal.aborted) yield* flushEncryptedValues(true);
}

/** Normalizes legacy and standard TanStack usage into AG-UI token usage. */
function collectTanStackRunFinishedDetails(
  event: Record<string, unknown>,
  details?: AgentRunFinishedDetails,
): void {
  if (!details) return;

  const fallbackIdentity = {
    provider: getNonEmptyString(event.provider),
    model: getNonEmptyString(event.model),
  };
  collectStandardRunFinishedDetails(event, details, fallbackIdentity);

  // TanStack's native finish reason becomes AG-UI terminal metadata.
  if (typeof event.finishReason === "string") {
    details.metadata = {
      ...details.metadata,
      finishReason: event.finishReason,
    };
  }

  const usage = event.usage;

  if (Array.isArray(usage)) {
    return;
  }

  if (!isRecord(usage)) return;

  const promptDetails = isRecord(usage.promptTokensDetails)
    ? usage.promptTokensDetails
    : {};
  const completionDetails = isRecord(usage.completionTokensDetails)
    ? usage.completionTokensDetails
    : {};
  aggregateRunUsage(details, [
    {
      ...fallbackIdentity,
      inputTokens: getTokenCount(usage.promptTokens),
      outputTokens: getTokenCount(usage.completionTokens),
      totalTokens: getTokenCount(usage.totalTokens),
      reasoningTokens: getTokenCount(completionDetails.reasoningTokens),
      cachedInputTokens: getTokenCount(promptDetails.cachedTokens),
    },
  ]);
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
