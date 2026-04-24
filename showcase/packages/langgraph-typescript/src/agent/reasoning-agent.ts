/**
 * Reasoning agent — minimal ReAct agent showcase.
 *
 * Shared by agentic-chat-reasoning (custom amber ReasoningBlock) and
 * reasoning-default-render (CopilotKit's built-in reasoning slot).
 *
 * TypeScript port of reasoning_agent.py. The Python version uses
 * `deepagents.create_deep_agent`; here we use `createReactAgent` from
 * `@langchain/langgraph/prebuilt` which provides the same tool-loop shape.
 */

import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";

const SYSTEM_PROMPT =
  "You are a helpful assistant. For each user question, first think " +
  "step-by-step about the approach, then give a concise answer.";

const model = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0 });

export const graph = createReactAgent({
  llm: model,
  tools: [],
  prompt: SYSTEM_PROMPT,
});
