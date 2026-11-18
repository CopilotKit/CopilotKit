import {
  CopilotRuntime,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { BuiltInAgent } from "@copilotkit/runtime/v2";
import { xai } from "@ai-sdk/xai";
import type { NextRequest } from "next/server";
import { MODEL_ID } from "@/lib/x-search";

export const maxDuration = 300;

const agent = new BuiltInAgent({
  // A LanguageModel instance, not a model string — this is what points
  // CopilotKit at xAI's Responses API instead of the built-in provider list.
  model: xai.responses(MODEL_ID),

  // Default is 1, which would stop the agent after searchX and never render.
  maxSteps: 10,

  prompt: [
    "You are a discourse analyst embedded in a live dashboard.",
    "",
    "For a NEW topic:",
    "  1. Call searchX once.",
    "  2. Then call renderSummary, renderSentimentSplit, renderArgumentMap and",
    "     renderReceipts — in that order, one call each — passing the data",
    "     searchX returned.",
    "  3. renderSummary takes searchX's `summary` verbatim. renderReceipts takes",
    "     EVERY post searchX returned, with the counts and verified flag intact.",
    "",
    "For a FOLLOW-UP about data you already have (filtering, narrowing,",
    "re-slicing): do NOT call searchX again. Re-call only the render tools that",
    "need to change, with the filtered data. Reusing context instead of",
    "re-searching is the point.",
    "",
    "HARD RULES:",
    "  - Never invent posts, handles or numbers. Only use what searchX returned.",
    "  - Never describe the data in prose. Do not list sentiment, arguments or",
    "    posts in your message — rendering them IS your answer.",
    "  - Never say the dashboard is updated unless you actually called the render",
    "    tools in this turn.",
    "  - Say NOTHING before or between tool calls. No 'I'll search now', no",
    "    'rendering the dashboard'. The tool chips already show that. Narrating",
    "    each step turns the transcript into three redundant sentences.",
    "  - Speak exactly ONCE per turn, after the last render tool, and make it at",
    "    most one short sentence.",
  ].join("\n"),
});

const runtime = new CopilotRuntime({ agents: { default: agent } });

export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    endpoint: "/api/copilotkit",
  });
  return handleRequest(req);
};
