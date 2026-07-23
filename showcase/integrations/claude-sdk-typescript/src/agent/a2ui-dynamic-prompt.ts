import type Anthropic from "@anthropic-ai/sdk";

export const A2UI_DYNAMIC_SYSTEM_PROMPT = [
  "You are a demo assistant for Declarative Generative UI (A2UI - Dynamic Schema).",
  "Whenever a response would benefit from a rich visual, call generate_a2ui.",
  "Use it for dashboards, KPI summaries, status reports, pie charts, bar charts,",
  "card layouts, info grids, and anything more structured than plain text.",
  "generate_a2ui takes one context string summarizing the user request.",
  "Keep chat replies to one short sentence and let the UI do the talking.",
].join(" ");

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
