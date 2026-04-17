import {
  BaseEvent,
  EventType,
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
import { randomUUID } from "@copilotkit/shared";

/**
 * Converts an AI SDK `fullStream` into AG-UI `BaseEvent` objects.
 *
 * This is a pure converter — it does NOT emit lifecycle events
 * (RUN_STARTED / RUN_FINISHED / RUN_ERROR). The caller (Agent class)
 * is responsible for those.
 *
 * Terminal stream events (finish, error, abort) cause the generator to
 * return so the caller can handle lifecycle appropriately.
 */
export async function* convertAISDKStream(
  fullStream: AsyncIterable<unknown>,
  abortSignal: AbortSignal,
): AsyncGenerator<BaseEvent> {
  let messageId = randomUUID();
  let reasoningMessageId = randomUUID();
  let isInReasoning = false;

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
          // Use SDK-provided id, or generate a fresh UUID if id is falsy/"0"
          // to prevent consecutive reasoning blocks from sharing a messageId
          const providedId = "id" in p ? p.id : undefined;
          reasoningMessageId =
            providedId && providedId !== "0"
              ? (providedId as string)
              : randomUUID();
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
          // New text message starting - use the SDK-provided id
          // Use randomUUID() if part.id is falsy or "0" to prevent message merging issues
          const providedId = "id" in p ? p.id : undefined;
          messageId =
            providedId && providedId !== "0"
              ? (providedId as string)
              : randomUUID();
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
              yield stateSnapshotEvent;
            }
          } else if (
            toolName === "AGUISendStateDelta" &&
            toolResult &&
            typeof toolResult === "object"
          ) {
            const delta = (toolResult as Record<string, unknown>).delta;
            if (delta !== undefined) {
              const stateDeltaEvent: StateDeltaEvent = {
                type: EventType.STATE_DELTA,
                delta,
              };
              yield stateDeltaEvent;
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

        default:
          // Unknown event types are silently ignored
          break;
      }
    }
  } finally {
    // Always close reasoning on exit (normal or exceptional)
    yield* closeReasoningIfOpen();
  }
}
