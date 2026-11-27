import type Anthropic from "@anthropic-ai/sdk";

export const A2UI_DYNAMIC_SYSTEM_PROMPT =
  "You are the embedded sales analyst for Vantage Threads, the fictional B2B " +
  "apparel company described in your App Context. Answer every business " +
  "question by calling `generate_a2ui` to draw a rich visual surface. Keep " +
  "the chat reply to one short sentence. Ground every number in the sales " +
  "dataset from App Context and follow its dashboard composition rules. Use " +
  "`Metric` for KPIs, `DataTable` for rep performance, `StatusBadge` for " +
  "risk, `InfoRow` for account facts, `PieChart` for part-of-whole " +
  "breakdowns, and `BarChart` for trends or comparisons. Never ask which " +
  "chart to use. Pass a `context` string summarizing what to render.";

export const GENERATE_A2UI_TOOL_SCHEMA: Anthropic.Tool = {
  name: "generate_a2ui",
  description:
    "Generate dynamic A2UI components based on the conversation. A secondary Claude call designs the UI schema and data using the registered catalog.",
  input_schema: {
    type: "object",
    properties: {
      context: {
        type: "string",
        description:
          "Conversation context summary the secondary Claude call should design UI from.",
      },
    },
    required: ["context"],
  },
};
