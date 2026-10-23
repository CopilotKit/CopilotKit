import type {
  BaseEvent,
  Interrupt,
  ReasoningEndEvent,
  ReasoningMessageContentEvent,
  ReasoningMessageEndEvent,
  ReasoningMessageStartEvent,
  ReasoningStartEvent,
  TextMessageChunkEvent,
  ToolCallArgsEvent,
  ToolCallEndEvent,
  ToolCallStartEvent,
  ToolCallResultEvent,
  StateSnapshotEvent,
  StateDeltaEvent,
} from "@ag-ui/client";
import { EventType } from "@ag-ui/client";
import { randomUUID } from "@copilotkit/shared";
import { createStateEventNormalizer } from "../state-delta";
import { aggregateRunUsage, getTokenCount, tokenCountKeys } from "./usage";
import type { AgentRunFinishedDetails, AgentRunUsage } from "./usage";

/**
 * Reads aggregate usage from an AI SDK finish part without inventing values
 * when a provider omits a token count.
 */
export function getAISDKRunFinishedDetails(
  part: Record<string, unknown>,
  identity: { provider?: string; model?: string } = {},
): AgentRunFinishedDetails {
  const details: AgentRunFinishedDetails = {};

  if (typeof part.finishReason === "string") {
    details.metadata = { finishReason: part.finishReason };
  }

  if (
    part.totalUsage === null ||
    typeof part.totalUsage !== "object" ||
    Array.isArray(part.totalUsage)
  ) {
    return details;
  }

  const totalUsage = part.totalUsage as Record<string, unknown>;
  const counts: AgentRunUsage = {};

  for (const key of tokenCountKeys) {
    const value = getTokenCount(totalUsage[key]);
    if (value !== undefined) {
      counts[key] = value;
    }
  }

  aggregateRunUsage(details, [{ ...identity, ...counts }]);

  return details;
}

export function formatToolError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  if (typeof error === "string") return error;
  if (error === undefined || error === null) return "Unknown tool error";

  try {
    const serialized = JSON.stringify(error);
    return serialized === undefined ? String(error) : serialized;
  } catch {
    return String(error);
  }
}

/**
 * Returns the AG-UI message id for an AI SDK `text-start` / `reasoning-start`
 * part.
 *
 * Several providers number stream parts per response instead of giving them
 * a unique id: @ai-sdk/anthropic and @ai-sdk/google use a block counter
 * ("0", "1", ...) and @ai-sdk/openai-compatible always uses "txt-0" /
 * "reasoning-0". Those ids repeat on every step and every run, so reusing
 * them would append later replies to an earlier message. Only ids that look
 * unique are kept.
 */
export function resolveStreamPartMessageId(providedId: unknown): string {
  if (
    typeof providedId !== "string" ||
    providedId === "" ||
    /^(\d+|(txt|reasoning|msg)-0)$/.test(providedId)
  ) {
    return randomUUID();
  }
  return providedId;
}

/**
 * Converts an AI SDK `fullStream` into AG-UI `BaseEvent` objects.
 *
 * This is a pure converter — it does NOT emit lifecycle events
 * (RUN_STARTED / RUN_FINISHED / RUN_ERROR). The caller (Agent class)
 * is responsible for those.
 *
 * Terminal stream events (finish, error, abort) cause the generator to
 * return so the caller can handle lifecycle appropriately.
 *
 * `pendingInterrupts`, when provided, is filled with one AG-UI Interrupt per
 * AI SDK `tool-approval-request` part (a tool declared `needsApproval: true`).
 * The caller turns a non-empty array into a RUN_FINISHED `outcome:interrupt`.
 */
export async function* convertAISDKStream(
  fullStream: AsyncIterable<unknown>,
  abortSignal: AbortSignal,
  pendingInterrupts?: Interrupt[],
  initialState?: unknown,
  runFinishedDetails?: AgentRunFinishedDetails,
): AsyncGenerator<BaseEvent> {
  let messageId = randomUUID();
  let reasoningMessageId = randomUUID();
  let isInReasoning = false;
  const normalizeStateEvent = createStateEventNormalizer(initialState);

  const toolCallStates = new Map<
    string,
    {
      started: boolean;
      hasArgsDelta: boolean;
      ended: boolean;
      toolName?: string;
    }
  >();

  const ensureToolCallState = (toolCallId: string) => {
    let state = toolCallStates.get(toolCallId);
    if (!state) {
      state = { started: false, hasArgsDelta: false, ended: false };
      toolCallStates.set(toolCallId, state);
    }
    return state;
  };

  /**
   * Auto-close an open reasoning lifecycle.
   * Some AI SDK providers (notably @ai-sdk/anthropic) never emit "reasoning-end",
   * which leaves downstream state machines stuck. This helper emits the
   * missing REASONING_MESSAGE_END + REASONING_END events so the stream
   * can transition to text, tool-call, or finish phases.
   */
  function* closeReasoningIfOpen(): Generator<BaseEvent> {
    if (!isInReasoning) return;
    isInReasoning = false;
    const reasoningMsgEnd: ReasoningMessageEndEvent = {
      type: EventType.REASONING_MESSAGE_END,
      messageId: reasoningMessageId,
    };
    yield reasoningMsgEnd;
    const reasoningEnd: ReasoningEndEvent = {
      type: EventType.REASONING_END,
      messageId: reasoningMessageId,
    };
    yield reasoningEnd;
  }

  try {
    const warnedUnknownPartTypes = new Set<string>();
    for await (const part of fullStream) {
      const p = part as Record<string, unknown>;

      // Close any open reasoning lifecycle on every event except
      // reasoning-delta, which arrives mid-block and must not interrupt it.
      if (p.type !== "reasoning-delta") {
        yield* closeReasoningIfOpen();
      }

      switch (p.type) {
        case "abort": {
          // Terminal — let the caller handle lifecycle
          return;
        }

        case "reasoning-start": {
          reasoningMessageId = resolveStreamPartMessageId(
            "id" in p ? p.id : undefined,
          );
          const reasoningStartEvent: ReasoningStartEvent = {
            type: EventType.REASONING_START,
            messageId: reasoningMessageId,
          };
          yield reasoningStartEvent;
          const reasoningMessageStart: ReasoningMessageStartEvent = {
            type: EventType.REASONING_MESSAGE_START,
            messageId: reasoningMessageId,
            role: "reasoning",
          };
          yield reasoningMessageStart;
          isInReasoning = true;
          break;
        }

        case "reasoning-delta": {
          const delta = (p.text as string) ?? "";
          if (!delta) break; // skip — @ag-ui/core schema requires delta to be non-empty
          const reasoningDeltaEvent: ReasoningMessageContentEvent = {
            type: EventType.REASONING_MESSAGE_CONTENT,
            messageId: reasoningMessageId,
            delta,
          };
          yield reasoningDeltaEvent;
          break;
        }

        case "reasoning-end": {
          // closeReasoningIfOpen() already called before the switch — no-op here
          // if the SDK never emits this event (e.g. @ai-sdk/anthropic).
          break;
        }

        case "tool-input-start": {
          const toolCallId = p.id as string;
          const state = ensureToolCallState(toolCallId);
          state.toolName = p.toolName as string;
          if (!state.started) {
            state.started = true;
            const startEvent: ToolCallStartEvent = {
              type: EventType.TOOL_CALL_START,
              parentMessageId: messageId,
              toolCallId,
              toolCallName: p.toolName as string,
            };
            yield startEvent;
          }
          break;
        }

        case "tool-input-delta": {
          const toolCallId = p.id as string;
          const state = ensureToolCallState(toolCallId);
          state.hasArgsDelta = true;
          const argsEvent: ToolCallArgsEvent = {
            type: EventType.TOOL_CALL_ARGS,
            toolCallId,
            delta: p.delta as string,
          };
          yield argsEvent;
          break;
        }

        case "tool-input-end": {
          // No direct event – the subsequent "tool-call" part marks completion.
          break;
        }

        case "text-start": {
          messageId = resolveStreamPartMessageId("id" in p ? p.id : undefined);
          break;
        }

        case "text-delta": {
          // AI SDK text-delta events use 'text' (not 'delta')
          const textDelta = "text" in p ? (p.text as string) : "";
          const textEvent: TextMessageChunkEvent = {
            type: EventType.TEXT_MESSAGE_CHUNK,
            role: "assistant",
            messageId,
            delta: textDelta,
          };
          yield textEvent;
          break;
        }

        case "tool-call": {
          const toolCallId = p.toolCallId as string;
          const state = ensureToolCallState(toolCallId);
          state.toolName = (p.toolName as string) ?? state.toolName;

          if (!state.started) {
            state.started = true;
            const startEvent: ToolCallStartEvent = {
              type: EventType.TOOL_CALL_START,
              parentMessageId: messageId,
              toolCallId,
              toolCallName: p.toolName as string,
            };
            yield startEvent;
          }

          if (!state.hasArgsDelta && "input" in p && p.input !== undefined) {
            let serializedInput = "";
            if (typeof p.input === "string") {
              serializedInput = p.input;
            } else {
              try {
                serializedInput = JSON.stringify(p.input);
              } catch {
                serializedInput = String(p.input);
              }
            }

            if (serializedInput.length > 0) {
              const argsEvent: ToolCallArgsEvent = {
                type: EventType.TOOL_CALL_ARGS,
                toolCallId,
                delta: serializedInput,
              };
              yield argsEvent;
              state.hasArgsDelta = true;
            }
          }

          if (!state.ended) {
            state.ended = true;
            const endEvent: ToolCallEndEvent = {
              type: EventType.TOOL_CALL_END,
              toolCallId,
            };
            yield endEvent;
          }
          break;
        }

        case "tool-approval-request": {
          // AI SDK native human-in-the-loop: a tool declared `needsApproval`
          // was called. The preceding "tool-call" part already streamed the
          // tool name + args; this part carries the toolCallId to pause on.
          // (Some shapes nest the call under `toolCall` — read both.)
          const nested = (p.toolCall ?? {}) as {
            toolCallId?: string;
            toolName?: string;
            input?: unknown;
          };
          const toolCallId =
            (p.toolCallId as string | undefined) ?? nested.toolCallId;
          if (!toolCallId) {
            throw new Error(
              "AI SDK tool-approval-request is missing toolCallId",
            );
          }
          const state = ensureToolCallState(toolCallId);
          const toolName = state.toolName ?? nested.toolName;

          // Defensive: emit the tool-call lifecycle if the "tool-call" part
          // didn't precede this one, so the assistant tool-call is in history
          // for the resume run (which keys the injected result by toolCallId).
          if (!state.started) {
            state.started = true;
            const startEvent: ToolCallStartEvent = {
              type: EventType.TOOL_CALL_START,
              parentMessageId: messageId,
              toolCallId,
              toolCallName: toolName ?? "",
            };
            yield startEvent;
          }
          if (!state.hasArgsDelta && nested.input !== undefined) {
            let serialized = "";
            try {
              serialized =
                typeof nested.input === "string"
                  ? nested.input
                  : JSON.stringify(nested.input);
            } catch {
              serialized = String(nested.input);
            }
            if (serialized.length > 0) {
              const argsEvent: ToolCallArgsEvent = {
                type: EventType.TOOL_CALL_ARGS,
                toolCallId,
                delta: serialized,
              };
              yield argsEvent;
              state.hasArgsDelta = true;
            }
          }
          if (!state.ended) {
            state.ended = true;
            const endEvent: ToolCallEndEvent = {
              type: EventType.TOOL_CALL_END,
              toolCallId,
            };
            yield endEvent;
          }

          pendingInterrupts?.push({
            id: toolCallId,
            toolCallId,
            reason: "tool_approval",
            message: toolName ? `Approve "${toolName}"?` : undefined,
            ...(toolName ? { metadata: { toolName } } : {}),
          });
          break;
        }

        case "tool-error": {
          const toolCallId = p.toolCallId as string | undefined;
          if (!toolCallId) {
            throw new Error("AI SDK tool-error is missing toolCallId");
          }

          // Interrupt tools do not execute on the server. Their result is
          // supplied by the human on the resume run, so suppress this part.
          if (
            pendingInterrupts?.some(
              (interrupt) => interrupt.toolCallId === toolCallId,
            )
          ) {
            toolCallStates.delete(toolCallId);
            break;
          }

          toolCallStates.delete(toolCallId);
          const resultEvent: ToolCallResultEvent = {
            type: EventType.TOOL_CALL_RESULT,
            role: "tool",
            messageId: randomUUID(),
            toolCallId,
            // A tool exception is a tool result from the model's perspective.
            // Keeping the Error prefix consistent with the core tool runner
            // lets both the client and the next model step see the failure.
            content: `Error: ${formatToolError(p.error)}`,
          };
          yield resultEvent;
          break;
        }

        case "tool-result": {
          // AI SDK tool-result uses "output"; older versions used "result" — check both
          const toolResult =
            "output" in p ? p.output : "result" in p ? p.result : null;
          const toolName = "toolName" in p ? (p.toolName as string) : "";
          toolCallStates.delete(p.toolCallId as string);

          // Check if this is a state update tool
          if (
            toolName === "AGUISendStateSnapshot" &&
            toolResult &&
            typeof toolResult === "object"
          ) {
            const snapshot = (toolResult as Record<string, unknown>).snapshot;
            if (snapshot !== undefined) {
              const stateSnapshotEvent: StateSnapshotEvent = {
                type: EventType.STATE_SNAPSHOT,
                snapshot,
              };
              for (const event of normalizeStateEvent(stateSnapshotEvent)) {
                yield event;
              }
            }
          } else if (
            toolName === "AGUISendStateDelta" &&
            toolResult &&
            typeof toolResult === "object"
          ) {
            const delta = (toolResult as { delta?: StateDeltaEvent["delta"] })
              .delta;
            if (delta !== undefined) {
              const stateDeltaEvent: StateDeltaEvent = {
                type: EventType.STATE_DELTA,
                delta,
              };
              for (const event of normalizeStateEvent(stateDeltaEvent)) {
                yield event;
              }
            }
          }

          // Always emit the tool result event for the LLM
          let serializedResult: string;
          try {
            serializedResult = JSON.stringify(toolResult);
          } catch {
            serializedResult = `[Unserializable tool result from ${toolName || "unknown tool"}]`;
          }
          const resultEvent: ToolCallResultEvent = {
            type: EventType.TOOL_CALL_RESULT,
            role: "tool",
            messageId: randomUUID(),
            toolCallId: p.toolCallId as string,
            content: serializedResult,
          };
          yield resultEvent;
          break;
        }

        case "finish": {
          if (runFinishedDetails) {
            Object.assign(runFinishedDetails, getAISDKRunFinishedDetails(p));
          }
          // Terminal — let the caller handle lifecycle
          return;
        }

        case "error": {
          if (abortSignal.aborted) {
            return;
          }
          // Re-throw so the caller can emit RUN_ERROR
          const err = p.error ?? p.message ?? p.cause;
          if (err instanceof Error) throw err;
          throw new Error(
            typeof err === "string"
              ? err
              : `AI SDK stream error: ${JSON.stringify(p)}`,
          );
        }

        // These AI SDK fullStream parts carry metadata that has no AG-UI event
        // equivalent. They are known and intentionally ignored; listing them
        // keeps the default's warning for genuinely new parts.
        case "start":
        case "start-step":
        case "finish-step":
        case "text-end":
        case "source":
        case "file":
        case "tool-output-denied":
        case "raw":
          break;

        default: {
          // Parts come from the caller's own `ai` install, which can be newer
          // than ours. Warn once per type and keep the run alive.
          const unknownType = String(p.type);
          if (!warnedUnknownPartTypes.has(unknownType)) {
            warnedUnknownPartTypes.add(unknownType);
            console.warn(
              `[convertAISDKStream] Ignoring unhandled AI SDK stream part: ${unknownType}`,
            );
          }
          break;
        }
      }
    }
  } finally {
    // Always close reasoning on exit (normal or exceptional)
    yield* closeReasoningIfOpen();
  }
}
