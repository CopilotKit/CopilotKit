/**
 * LangGraph TypeScript agent for the Declarative Generative UI (A2UI — Dynamic Schema) demo.
 */

import { ChatOpenAI } from "@langchain/openai";
import { createAgent } from "langchain";
import { copilotkitMiddleware } from "@copilotkit/sdk-js/langgraph";

const SYSTEM_PROMPT =
  "You are a demo assistant for Declarative Generative UI (A2UI — Dynamic " +
  "Schema). Whenever a response would benefit from a rich visual — a " +
  "dashboard, status report, KPI summary, card layout, info grid, a " +
  "pie/donut chart of part-of-whole breakdowns, or a bar chart comparing " +
  "values across categories — call `generate_a2ui` to draw it. Keep chat " +
  "replies to one short sentence and let the UI do the talking.";

export const graph = createAgent({
  model: new ChatOpenAI({ model: "gpt-4.1" }),
  tools: [],
  middleware: [copilotkitMiddleware],
  systemPrompt: SYSTEM_PROMPT,
});
