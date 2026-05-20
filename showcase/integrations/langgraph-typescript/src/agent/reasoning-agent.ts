/**
 * Reasoning agent — minimal ReAct agent showcase.
 *
 * Shared by agentic-chat-reasoning (custom amber ReasoningBlock) and
 * reasoning-default-render (CopilotKit's built-in reasoning slot).
 *
 * TypeScript port of reasoning_agent.py. The Python version relies on
 * `deepagents.create_deep_agent` to surface a reasoning chain via an
 * internal planner tool; TS has no drop-in equivalent.
 *
 * To make the AG-UI `ReasoningMessage` slot light up in the TS variant
 * we route through a reasoning-capable OpenAI model via the Responses
 * API. `@langchain/openai` surfaces the model's thinking tokens as a
 * distinct content block that the CopilotKit runtime translates to a
 * `role: "reasoning"` AG-UI event — which both reasoning demos render.
 *
 * Falls back to gpt-4o-mini (no reasoning stream) if `OPENAI_REASONING_MODEL`
 * is unset, so local dev without a reasoning-tier key still works (reasoning
 * slot just stays empty in that case).
 */

import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";

const SYSTEM_PROMPT =
  "You are a helpful assistant. For each user question, first think " +
  "step-by-step about the approach, then give a concise answer.";

const REASONING_MODEL = process.env.OPENAI_REASONING_MODEL ?? "gpt-5-mini";

const model = new ChatOpenAI({
  model: REASONING_MODEL,
  useResponsesApi: true,
  reasoning: { effort: "low", summary: "auto" },
});

export const graph = createReactAgent({
  llm: model,
  tools: [],
  prompt: SYSTEM_PROMPT,
});
