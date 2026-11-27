/**
 * LangGraph TypeScript agent for the Declarative Generative UI (A2UI — Dynamic Schema) demo.
 */

import { getA2UITools } from "@ag-ui/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { createAgent, createMiddleware } from "langchain";
import { copilotkitMiddleware, zodState } from "@copilotkit/sdk-js/langgraph";
import { z } from "zod";
import { makeChatOpenAI } from "./openai-headers";

const SYSTEM_PROMPT =
  "You are the embedded sales analyst for Vantage Threads, the fictional B2B " +
  "apparel company described in your App Context. Answer every business " +
  "question by calling `generate_a2ui` to draw a rich visual surface. Keep " +
  "the chat reply to one short sentence. Ground every number in the sales " +
  "dataset from App Context and follow its dashboard composition rules. Use " +
  "`Metric` for KPIs, `DataTable` for rep performance, `StatusBadge` for " +
  "risk, `InfoRow` for account facts, `PieChart` for part-of-whole " +
  "breakdowns, and `BarChart` for trends or comparisons. Never ask which " +
  "chart to use. For a new surface, call `generate_a2ui` without arguments.";

const modelOptions = {
  modelKwargs: { reasoning_effort: "none" },
  model: "gpt-6-luna",
};
const model = new ChatOpenAI(modelOptions);
const defaultCatalogId = "declarative-gen-ui-catalog";
const generateA2UI = getA2UITools({ model, defaultCatalogId });

const forwardModelHeaders = createMiddleware({
  name: "declarative-a2ui-model-headers",
  wrapModelCall: (request, handler) =>
    handler({
      ...request,
      model: makeChatOpenAI(request.runtime, modelOptions),
    }),
  wrapToolCall: (request, handler) => {
    if (request.toolCall.name !== generateA2UI.name) return handler(request);
    const tool = getA2UITools({
      model: makeChatOpenAI(request.runtime, modelOptions),
      defaultCatalogId,
    });
    return handler({ ...request, tool });
  },
});

export const graph = createAgent({
  model,
  tools: [generateA2UI],
  stateSchema: z.object({
    "ag-ui": zodState(z.record(z.unknown()).optional()),
  }),
  middleware: [forwardModelHeaders, copilotkitMiddleware],
  systemPrompt: SYSTEM_PROMPT,
});
