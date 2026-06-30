import { BuiltInAgent, convertInputToTanStackAI } from "@copilotkit/runtime/v2";
import { chat } from "@tanstack/ai";
import {
  OpenAIChatCompletionsTextAdapter,
  type OpenAIChatCompletionsProviderOptions,
} from "@tanstack/ai-openai";
import { baseServerTools } from "./server-tools";
// Custom fetch that injects ALS-bound inbound x-* headers (e.g.
// x-aimock-context) onto every outbound OpenAI call. Required so aimock
// can match fixtures by integration context. See ../header-forwarding.ts
// for the full rationale; mirrors the Mastra precedent.
import { forwardingFetch } from "../header-forwarding";

/**
 * Reasoning model used by all three reasoning demos.
 *
 * GPT-5.2 is a reasoning-capable variant; OpenAI's chat completions API
 * accepts the `reasoning_effort` parameter for it. If GPT-5.2 isn't
 * accessible in your environment swap to another reasoning-capable model
 * such as `o3` or `gpt-5-thinking`.
 */
const REASONING_MODEL = process.env.REASONING_MODEL ?? "gpt-5.2";

/**
 * Chat-completions adapter that surfaces the model's reasoning trace.
 *
 * Why a custom subclass instead of `openaiText`:
 *   - `openaiText` uses TanStack's OpenAI *Responses*-API adapter. On the
 *     reasoning path it emits the trace as `STEP_STARTED` / `STEP_FINISHED`
 *     (`stepType: "thinking"`) chunks. The `@copilotkit/runtime` tanstack
 *     converter only maps upstream `REASONING_*` chunks to AG-UI
 *     `REASONING_MESSAGE_*` events — it has no `STEP_*` handler — so the
 *     reasoning is silently dropped and the `<ReasoningBlock>` never mounts.
 *   - The base chat-completions adapter DOES emit the proper
 *     `REASONING_START` / `REASONING_MESSAGE_START` (role `"reasoning"`) /
 *     `REASONING_MESSAGE_CONTENT` lifecycle — but only when
 *     `extractReasoning()` returns text, and its default returns `undefined`
 *     because the vanilla OpenAI chat-completions chunk shape has no
 *     reasoning field.
 *
 * OpenAI's chat-completions streaming places reasoning on
 * `choices[0].delta.reasoning_content` (the same field aimock emits for the
 * reasoning fixtures). Overriding `extractReasoning` to read it makes the
 * adapter emit `REASONING_MESSAGE_*`, which the runtime converter forwards
 * to the frontend as AG-UI reasoning events.
 */
/**
 * Provider options for the chat-completions reasoning path.
 *
 * TanStack's exported `OpenAIChatCompletionsProviderOptions` only models the
 * *Responses*-API reasoning shape (`reasoning: { effort, summary }`) and has
 * no flat `reasoning_effort` field. But `mapOptionsToRequest` spreads
 * `modelOptions` verbatim into the `/v1/chat/completions` body, where OpenAI
 * expects the flat scalar `reasoning_effort` — the nested `reasoning` object
 * is a Responses-API construct that chat-completions rejects/ignores. We
 * widen the provider-options type with the correct chat-completions field so
 * the body carries `reasoning_effort` and the literal type-checks.
 */
type ReasoningProviderOptions = OpenAIChatCompletionsProviderOptions & {
  reasoning_effort?: "minimal" | "low" | "medium" | "high";
};

class ReasoningChatCompletionsAdapter extends OpenAIChatCompletionsTextAdapter<
  "gpt-5.2",
  ReasoningProviderOptions
> {
  protected override extractReasoning(
    chunk: unknown,
  ): { text: string } | undefined {
    const delta = (
      chunk as {
        choices?: Array<{
          delta?: { reasoning_content?: string; reasoning?: string };
        }>;
      }
    )?.choices?.[0]?.delta;
    const text = delta?.reasoning_content ?? delta?.reasoning;
    return text ? { text } : undefined;
  }
}

function createReasoningAdapter() {
  const apiKey = process.env.OPENAI_API_KEY ?? "";
  // REASONING_MODEL is read from env (string); the adapter's generic is
  // pinned to a concrete reasoning-capable chat model for typing.
  return new ReasoningChatCompletionsAdapter(
    { apiKey, fetch: forwardingFetch },
    REASONING_MODEL as "gpt-5.2",
  );
}

/**
 * Built-in agent for `reasoning-custom` — visible thinking chain
 * during normal conversation. Uses the shared server tools so the model
 * can interleave tool calls with reasoning naturally.
 */
export function createAgenticChatReasoningAgent() {
  return new BuiltInAgent({
    type: "tanstack",
    factory: ({ input, abortController }) => {
      const { messages, systemPrompts } = convertInputToTanStackAI(input);
      return chat({
        adapter: createReasoningAdapter(),
        messages,
        systemPrompts,
        tools: [...baseServerTools],
        modelOptions: {
          reasoning_effort: "low",
        },
        abortController,
      });
    },
  });
}

/**
 * Built-in agent for `reasoning-default` — same backend behaviour
 * as `reasoning-custom`; the demo's value is that the frontend
 * passes NO custom `reasoningMessage` slot, so CopilotKit's built-in
 * `CopilotChatReasoningMessage` renders the chain. Kept as its own
 * factory for clarity even though the body is identical today.
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
