import type Anthropic from "@anthropic-ai/sdk";

export const A2UI_DYNAMIC_SYSTEM_PROMPT = [
  "You are a demo assistant for Declarative Generative UI (A2UI - Dynamic Schema).",
  "Whenever a response would benefit from a rich visual, call generate_a2ui.",
  "Use it for dashboards, KPI summaries, status reports, pie charts, bar charts,",
  "card layouts, info grids, and anything more structured than plain text.",
  "generate_a2ui takes no arguments and handles the rendering automatically.",
  "Keep chat replies to one short sentence and let the UI do the talking.",
].join(" ");

export const GENERATE_A2UI_TOOL_SCHEMA: Anthropic.Tool = {
  name: "generate_a2ui",
  description:
    "Generate a dynamic A2UI dashboard surface from the current conversation. Takes no arguments. The CopilotKit runtime middleware (a2ui.injectA2UITool: true) intercepts the call and drives render_a2ui.",
  input_schema: {
    type: "object",
    properties: {},
  },
};
