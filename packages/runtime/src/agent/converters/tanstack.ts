import type {
  AudioPart,
  BaseEvent,
  DocumentPart,
  ImagePart,
  Interrupt,
  RunAgentInput,
  Message,
  PartSource,
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
  VideoPart,
} from "@ag-ui/client";
import { contentToText, EventType } from "@ag-ui/client";
import { randomUUID } from "@copilotkit/shared";
import { formatContextSection, formatStateSection } from "../prompt";
import { createStateEventNormalizer } from "../state-delta";
import {
  aggregateRunUsage,
  collectStandardRunFinishedDetails,
  getNonEmptyString,
  getTokenCount,
  isRecord,
} from "./usage";
import type { AgentRunFinishedDetails } from "./usage";

type MediaPart = ImagePart | AudioPart | VideoPart | DocumentPart;

/**
 * A TanStack AI content part. In `@tanstack/ai` 1.x the media parts are the
 * AG-UI media parts (same `source` shapes, including provider file handles).
 * Only the text part differs: TanStack names the text field `content`.
 */
export type TanStackContentPart =
  | { type: "text"; content: string }
  | { type: MediaPart["type"]; source: PartSource };

/**
 * Message format expected by TanStack AI's `chat()`.
 *
 * Content is typed as `any[]` for the multimodal case so messages are directly
 * passable to any adapter without casts: different adapters constrain which
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
 * `execute`): the model may CALL it, but TanStack does not run it. It pauses
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
 * Result of converting RunAgentInput to TanStack AI format. Spread it into
 * `chat()` and add an `adapter`.
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
  /** The AG-UI thread id. `chat()` in `@tanstack/ai` 1.x requires it. */
  threadId: string;
  /** The AG-UI run id, so TanStack's run events carry the same id. */
  runId: string;
}

type ChatRoleMessage = Extract<
  Message,
  { role: "user" | "assistant" | "tool" }
>;

function isChatRoleMessage(message: Message): message is ChatRoleMessage {
  return (
    message.role === "user" ||
    message.role === "assistant" ||
    message.role === "tool"
  );
}

/**
 * Reads an AG-UI part source. Data, URL, and provider file-handle sources pass
 * through: `@tanstack/ai` 1.x takes the same three shapes. An adapter that
 * cannot read file handles fails the run with TanStack's own error.
 */
function convertPartSource(source: unknown): PartSource | undefined {
  if (!isRecord(source) || typeof source.value !== "string") return undefined;
  const mimeType = getNonEmptyString(source.mimeType);
  switch (source.type) {
    case "data":
      return mimeType
        ? { type: "data", value: source.value, mimeType }
        : undefined;
    case "url":
      return {
        type: "url",
        value: source.value,
        ...(mimeType && { mimeType }),
      };
    case "file": {
      const provider = getNonEmptyString(source.provider);
      return {
        type: "file",
        value: source.value,
        ...(provider && { provider }),
        ...(mimeType && { mimeType }),
      };
    }
    default:
      return undefined;
  }
}

/** Legacy BinaryInputContent (`{ type: "binary", mimeType, data | url }`). */
function convertLegacyBinaryPart(
  part: Record<string, unknown>,
): TanStackContentPart | undefined {
  const mimeType =
    getNonEmptyString(part.mimeType) ?? "application/octet-stream";
  const type = mimeType.startsWith("image/") ? "image" : "document";
  if (typeof part.data === "string" && part.data) {
    return { type, source: { type: "data", value: part.data, mimeType } };
  }
  if (typeof part.url === "string" && part.url) {
    return { type, source: { type: "url", value: part.url, mimeType } };
  }
  return undefined;
}

function convertUserPart(part: unknown): TanStackContentPart | undefined {
  if (!isRecord(part)) return undefined;
  switch (part.type) {
    case "text":
      return typeof part.text === "string"
        ? { type: "text", content: part.text }
        : undefined;
    case "image":
    case "audio":
    case "video":
    case "document": {
      const source = convertPartSource(part.source);
      return source ? { type: part.type, source } : undefined;
    }
    case "binary":
      return convertLegacyBinaryPart(part);
    default:
      return undefined;
  }
}

/** Which client-sent instruction messages {@link convertInputToTanStackAI} forwards. */
export interface TanStackInputOptions {
  /** Send system messages from the client to the model. Default: false. */
  forwardSystemMessages?: boolean;
  /** Send developer messages from the client to the model. Default: false. */
  forwardDeveloperMessages?: boolean;
}

/**
 * Converts AG-UI user message content to TanStack AI format.
 * Handles plain strings, multimodal parts (image/audio/video/document),
 * and legacy BinaryInputContent for backward compatibility.
 */
function convertUserContent(content: unknown) {
  if (!content) return null;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  if (content.length === 0) return "";

  const parts = content
    .map(convertUserPart)
    .filter((part): part is TanStackContentPart => part !== undefined);
  return parts.length > 0 ? parts : "";
}

function convertChatMessage(message: ChatRoleMessage) {
  switch (message.role) {
    case "user":
      return {
        role: message.role,
        content: convertUserContent(message.content),
      } satisfies TanStackChatMessage;
    case "tool":
      // A tool result is a string or a list of parts; TanStack takes text
      // here, so the text parts are concatenated.
      return {
        role: message.role,
        content: contentToText(message.content),
        toolCallId: message.toolCallId,
      } satisfies TanStackChatMessage;
    case "assistant": {
      const toolCalls = message.toolCalls?.map((call) => ({
        id: call.id,
        type: call.type,
        function: {
          name: call.function.name,
          arguments: call.function.arguments,
        },
      }));
      return {
        role: message.role,
        content: typeof message.content === "string" ? message.content : null,
        ...(toolCalls && { toolCalls }),
      } satisfies TanStackChatMessage;
    }
  }
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
// Recursive, so TypeScript needs the return type written out.
function sanitizeClientToolSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map(sanitizeClientToolSchema);
  }
  if (!isRecord(schema)) {
    return schema;
  }
  const node = { ...schema };

  // Any `additionalProperties` (empty `{}`, `true`, or a sub-schema) becomes
  // `false`: the only form OpenAI accepts for strict function tools.
  if ("additionalProperties" in node) {
    node.additionalProperties = false;
  }

  if (isRecord(node.properties)) {
    const entries = Object.entries(node.properties);
    node.properties = Object.fromEntries(
      entries.map(([key, value]) => [key, sanitizeClientToolSchema(value)]),
    );
  }

  if ("items" in node) {
    node.items = sanitizeClientToolSchema(node.items);
  }

  for (const combinator of ["anyOf", "allOf", "oneOf"] as const) {
    const branches = node[combinator];
    if (Array.isArray(branches)) {
      node[combinator] = branches.map(sanitizeClientToolSchema);
    }
  }

  return node;
}

/**
 * Converts a RunAgentInput into the format expected by TanStack AI's `chat()`.
 *
 * - Keeps only user/assistant/tool messages (activity, reasoning, and other roles are also excluded)
 * - Extracts system/developer messages into `systemPrompts`
 * - Appends the context and application state sections (the same text as
 *   `buildAgentSystemPrompt`) to `systemPrompts`
 * - Preserves tool calls on assistant messages and toolCallId on tool messages
 * - Carries `threadId` and `runId`, which `chat()` needs
 *
 * @param input - The AG-UI run input.
 * @param options - System and developer messages from the client reach the
 *   model only when you opt in, because a client could otherwise set the
 *   agent's instructions.
 *
 * @example
 * ```ts
 * const stream = chat({ ...convertInputToTanStackAI(input), adapter });
 * ```
 */
export function convertInputToTanStackAI(
  input: RunAgentInput,
  options: TanStackInputOptions = {},
) {
  const messages: TanStackChatMessage[] = input.messages
    .filter(isChatRoleMessage)
    .map(convertChatMessage);

  const systemPrompts: string[] = [];
  for (const m of input.messages) {
    const forwarded =
      (m.role === "system" && options.forwardSystemMessages) ||
      (m.role === "developer" && options.forwardDeveloperMessages);
    if (forwarded && m.content) {
      systemPrompts.push(
        typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      );
    }
  }

  // The wire input can omit `context`, even though the type requires it.
  const contextSection = formatContextSection(input.context ?? []);
  if (contextSection) systemPrompts.push(contextSection);
  const stateSection = formatStateSection(input.state);
  if (stateSection) systemPrompts.push(stateSection);

  // Frontend-provided tools become client-side TanStack tools (no executor):
  // the model can call them, TanStack pauses the run, and the AG-UI client
  // executes them and resumes: the CopilotKit client-tool round-trip.
  const tools: TanStackClientTool[] = (input.tools ?? []).map((t) => ({
    __toolSide: "client",
    name: t.name,
    description: t.description,
    inputSchema: sanitizeClientToolSchema(t.parameters),
  }));

  return {
    messages,
    systemPrompts,
    tools,
    threadId: input.threadId,
    runId: input.runId,
  } satisfies TanStackInputResult;
}

/**
 * The CopilotKit interrupt for a tool that needs approval. Its id is the tool
 * call id, so the resume entry becomes that call's tool result.
 */
function createToolApprovalInterrupt(
  toolCallId: string,
  toolName: string | undefined,
) {
  return {
    id: toolCallId,
    toolCallId,
    reason: "tool_approval",
    message: toolName ? `Approve "${toolName}"?` : undefined,
    ...(toolName ? { metadata: { toolName } } : {}),
  } satisfies Interrupt;
}

/**
 * Reads the approval interrupts from a `@tanstack/ai` 1.x `RUN_FINISHED`
 * `outcome`. TanStack also pauses on a client tool call
 * (`metadata.kind: "client_tool"`); that is not an interrupt here, because the
 * CopilotKit client runs frontend tools from the streamed tool call.
 */
function readApprovalInterrupts(outcome: unknown) {
  if (!isRecord(outcome) || outcome.type !== "interrupt") return [];

  const approvals: Interrupt[] = [];
  const interrupts: unknown[] = Array.isArray(outcome.interrupts)
    ? outcome.interrupts
    : [];
  for (const interrupt of interrupts) {
    if (!isRecord(interrupt) || !isRecord(interrupt.metadata)) continue;
    const toolCallId = getNonEmptyString(interrupt.toolCallId);
    if (interrupt.metadata.kind !== "approval" || !toolCallId) continue;
    approvals.push(
      createToolApprovalInterrupt(
        toolCallId,
        getNonEmptyString(interrupt.metadata.toolName),
      ),
    );
  }
  return approvals;
}

/**
 * Converts a TanStack AI stream into AG-UI `BaseEvent` objects.
 *
 * This is a pure converter: it does NOT emit lifecycle events
 * (RUN_STARTED / RUN_FINISHED / RUN_ERROR). The caller (Agent class)
 * is responsible for those.
 *
 * `pendingInterrupts`, when provided, is filled with one AG-UI Interrupt per
 * tool call that waits for approval (a tool declared `needsApproval: true`).
 * `@tanstack/ai` 1.x reports these in the `RUN_FINISHED` `outcome`. The
 * caller turns a non-empty array into a RUN_FINISHED `outcome:interrupt`.
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
  const normalizeStateEvent = createStateEventNormalizer(initialState);

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

    // Per-turn lifecycle markers are owned by the Agent wrapper, not forwarded.
    // In `@tanstack/ai` 1.x the turn that waits for approval ends with
    // `outcome: { type: "interrupt" }`.
    if (type === "RUN_FINISHED") {
      pendingInterrupts?.push(...readApprovalInterrupts(raw.outcome));
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

/**
 * Reads the model identity and finish reason of a TanStack `RUN_FINISHED`.
 * `@tanstack/ai` 1.x puts them in `metadata.tanstack`
 * (`{ model, finishReason, source: { provider, model } }`); top-level fields
 * win when present.
 */
function readTanStackRunIdentity(event: Record<string, unknown>) {
  const tanstack =
    isRecord(event.metadata) && isRecord(event.metadata.tanstack)
      ? event.metadata.tanstack
      : {};
  const source = isRecord(tanstack.source) ? tanstack.source : {};
  const finishReason = [event.finishReason, tanstack.finishReason].find(
    (value): value is string => typeof value === "string",
  );
  return {
    provider:
      getNonEmptyString(event.provider) ?? getNonEmptyString(source.provider),
    model:
      getNonEmptyString(event.model) ??
      getNonEmptyString(tanstack.model) ??
      getNonEmptyString(source.model),
    finishReason,
  };
}

/** Normalizes legacy and standard TanStack usage into AG-UI token usage. */
function collectTanStackRunFinishedDetails(
  event: Record<string, unknown>,
  details?: AgentRunFinishedDetails,
) {
  if (!details) return;

  const { finishReason, ...fallbackIdentity } = readTanStackRunIdentity(event);
  collectStandardRunFinishedDetails(event, details, fallbackIdentity);

  // TanStack's native finish reason becomes AG-UI terminal metadata.
  if (finishReason !== undefined) {
    details.metadata = { ...details.metadata, finishReason };
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
