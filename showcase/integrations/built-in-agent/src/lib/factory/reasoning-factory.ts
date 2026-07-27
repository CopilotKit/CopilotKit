import { BuiltInAgent, convertInputToTanStackAI } from "@copilotkit/runtime/v2";
import { EventType } from "@ag-ui/client";
import type { BaseEvent } from "@ag-ui/client";
import { chat } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";
import { baseServerTools } from "./server-tools";
// Custom fetch that injects ALS-bound inbound x-* headers (e.g.
// x-aimock-context) onto every outbound OpenAI call. Required so aimock
// can match fixtures by integration context. See ../header-forwarding.ts
// for the full rationale; mirrors the Mastra precedent.
import { forwardingFetch } from "../header-forwarding";

/**
 * Reasoning model used by all three reasoning demos.
 *
 * GPT-5.2 is a reasoning-capable model exposed through OpenAI's *Responses*
 * API, which streams a natural-language reasoning summary when asked with
 * `reasoning: { effort, summary }`. Swap via the `REASONING_MODEL` env var to
 * another Responses-API reasoning model (e.g. `o3`, `gpt-5-thinking`) if
 * GPT-5.2 isn't accessible in your environment.
 */
const REASONING_MODEL = process.env.REASONING_MODEL ?? "gpt-5.2";

/**
 * Reasoning effort for the summary. Must be `high`: at `low`/`medium`, real
 * OpenAI (verified) frequently completes the turn WITHOUT emitting any
 * reasoning summary part for short prompts, so the `<ReasoningBlock>` never
 * mounts. `high` reliably streams `response.reasoning_summary_text.delta`
 * events for the demo prompts.
 */
const REASONING_EFFORT: "low" | "medium" | "high" =
  (process.env.REASONING_EFFORT as "low" | "medium" | "high") ?? "high";

function randomUUID(): string {
  return crypto.randomUUID();
}

/**
 * Convert a TanStack AI (Responses-API) stream to AG-UI events, mapping the
 * model's reasoning summary into AG-UI `REASONING_MESSAGE_*` events.
 *
 * Why this custom converter instead of `type: "tanstack"`:
 *   - `openaiText` (TanStack's OpenAI *Responses*-API adapter) surfaces the
 *     reasoning summary as `STEP_STARTED` (`stepType: "thinking"`) followed by
 *     a run of `STEP_FINISHED` chunks that each carry a `delta` of summary
 *     text — NOT as upstream `REASONING_*` chunks.
 *   - The runtime's built-in `convertTanStackStream` only maps `REASONING_*`
 *     chunks to AG-UI reasoning events; it has no `STEP_*` handler, so the
 *     whole trace is silently dropped and `<ReasoningBlock>` never mounts.
 *   - Chat-completions streaming (the previous approach) places reasoning on
 *     `choices[0].delta.reasoning_content`, which real OpenAI does NOT emit
 *     (only aimock did) — so that path produced no trace against a real key.
 *
 * This converter translates the thinking STEP chunks into a
 * REASONING_START → REASONING_MESSAGE_START → REASONING_MESSAGE_CONTENT* →
 * REASONING_MESSAGE_END → REASONING_END lifecycle, closes the reasoning block
 * as soon as text or a tool call begins, and forwards text + tool-call events
 * (de-duplicated across TanStack's multi-turn re-announcements, like
 * tanstack-factory's converter).
 */
async function* convertReasoningStream(
  stream: AsyncIterable<unknown>,
  abortSignal: AbortSignal,
): AsyncGenerator<BaseEvent> {
  const messageId = randomUUID();
  let reasoningMessageId = randomUUID();
  let reasoningOpen = false;
  const completedToolCalls = new Set<string>();

  function* openReasoningIfNeeded(): Generator<BaseEvent> {
    if (reasoningOpen) return;
    reasoningOpen = true;
    reasoningMessageId = randomUUID();
    yield { type: EventType.REASONING_START, messageId: reasoningMessageId };
    yield {
      type: EventType.REASONING_MESSAGE_START,
      messageId: reasoningMessageId,
      role: "reasoning",
    };
  }

  function* closeReasoningIfOpen(): Generator<BaseEvent> {
    if (!reasoningOpen) return;
    reasoningOpen = false;
    yield {
      type: EventType.REASONING_MESSAGE_END,
      messageId: reasoningMessageId,
    };
    yield { type: EventType.REASONING_END, messageId: reasoningMessageId };
  }

  for await (const chunk of stream) {
    if (abortSignal.aborted) break;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = chunk as any;
    const type = raw.type as string;

    if (type === "RUN_STARTED" || type === "RUN_FINISHED") continue;

    if (type === "RUN_ERROR") {
      throw new Error(
        typeof raw.message === "string" ? raw.message : "TanStack AI run error",
      );
    }

    // Reasoning summary: STEP_STARTED(stepType:"thinking") begins the trace;
    // subsequent STEP_STARTED/STEP_FINISHED chunks carry summary text on
    // `delta`. Only treat STEPs as reasoning while a thinking step is active.
    if (type === "STEP_STARTED" || type === "STEP_FINISHED") {
      const isThinking = raw.stepType === "thinking" || reasoningOpen;
      if (isThinking) {
        yield* openReasoningIfNeeded();
        const delta = raw.delta;
        if (typeof delta === "string" && delta.length > 0) {
          yield {
            type: EventType.REASONING_MESSAGE_CONTENT,
            messageId: reasoningMessageId,
            delta,
          };
        }
      }
      continue;
    }

    if (type === "TEXT_MESSAGE_CONTENT" && raw.delta != null) {
      yield* closeReasoningIfOpen();
      if ((raw.delta as string).length === 0) continue;
      yield {
        type: EventType.TEXT_MESSAGE_CHUNK,
        role: "assistant",
        messageId,
        delta: raw.delta as string,
      };
    } else if (type === "TOOL_CALL_START") {
      const toolCallId = raw.toolCallId as string;
      if (completedToolCalls.has(toolCallId)) continue;
      yield* closeReasoningIfOpen();
      yield {
        type: EventType.TOOL_CALL_START,
        parentMessageId: messageId,
        toolCallId,
        toolCallName: raw.toolCallName as string,
      };
    } else if (type === "TOOL_CALL_ARGS") {
      const toolCallId = raw.toolCallId as string;
      if (completedToolCalls.has(toolCallId)) continue;
      yield {
        type: EventType.TOOL_CALL_ARGS,
        toolCallId,
        delta: raw.delta as string,
      };
    } else if (type === "TOOL_CALL_END") {
      const toolCallId = raw.toolCallId as string;
      if (completedToolCalls.has(toolCallId)) continue;
      completedToolCalls.add(toolCallId);
      yield { type: EventType.TOOL_CALL_END, toolCallId };
    } else if (type === "TOOL_CALL_RESULT") {
      const toolCallId = raw.toolCallId as string;
      const rawPayload = raw.content ?? raw.result;
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
      yield {
        type: EventType.TOOL_CALL_RESULT,
        role: "tool",
        messageId: randomUUID(),
        toolCallId,
        content: serializedContent,
      };
    }
  }

  yield* closeReasoningIfOpen();
}

/**
 * Built-in agent for `reasoning-custom` — visible thinking chain during
 * normal conversation. Uses the shared server tools so the model can
 * interleave tool calls with reasoning naturally.
 */
export function createAgenticChatReasoningAgent() {
  return new BuiltInAgent({
    // `custom` (not `tanstack`) so our converter can map the Responses-API
    // thinking STEPs to REASONING_MESSAGE_* — the built-in tanstack converter
    // drops STEP_* chunks.
    type: "custom",
    factory: ({ input, abortController }) => {
      const { messages, systemPrompts } = convertInputToTanStackAI(input);
      const stream = chat({
        adapter: openaiText(REASONING_MODEL as "gpt-5.2", {
          fetch: forwardingFetch,
        }),
        messages,
        systemPrompts,
        tools: [...baseServerTools],
        modelOptions: {
          reasoning: { effort: REASONING_EFFORT, summary: "auto" },
        },
        abortController,
      });
      return convertReasoningStream(stream, abortController.signal);
    },
  });
}

/**
 * Built-in agent for `reasoning-default` — same backend behaviour as
 * `reasoning-custom`; the demo's value is that the frontend passes NO custom
 * `reasoningMessage` slot, so CopilotKit's built-in
 * `CopilotChatReasoningMessage` renders the chain.
 */
export function createReasoningDefaultRenderAgent() {
  return createAgenticChatReasoningAgent();
}

/**
 * Built-in agent for `tool-rendering-reasoning-chain` — combines visible
 * reasoning with sequential tool calls (get_weather, search_flights,
 * roll_d20, get_stock_price) so the demo can show an interleaved
 * reasoning + tool-call chain.
 */
export function createToolRenderingReasoningChainAgent() {
  return createAgenticChatReasoningAgent();
}
