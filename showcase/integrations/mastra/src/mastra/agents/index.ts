import { openai } from "@ai-sdk/openai";
import { Agent } from "@mastra/core/agent";
import {
  weatherTool,
  stockPriceTool,
  queryDataTool,
  manageSalesTodosTool,
  getSalesTodosTool,
  scheduleMeetingTool,
  searchFlightsTool,
  generateA2uiTool,
} from "@/mastra/tools";
import { LibSQLStore } from "@mastra/libsql";
import { z } from "zod";
import { Memory } from "@mastra/memory";

export const AgentState = z.object({
  proverbs: z.array(z.string()).default([]),
});

export const weatherAgent = new Agent({
  id: "weather-agent",
  name: "Weather Agent",
  tools: {
    weatherTool,
    queryDataTool,
    manageSalesTodosTool,
    getSalesTodosTool,
    scheduleMeetingTool,
    searchFlightsTool,
    generateA2uiTool,
  },
  model: openai("gpt-4o"),
  instructions: "You are a helpful assistant.",
  memory: new Memory({
    storage: new LibSQLStore({
      id: "weather-agent-memory",
      url: "file::memory:",
    }),
    options: {
      workingMemory: {
        enabled: true,
        schema: AgentState,
      },
    },
  }),
});

// Dedicated agent for the headless-complete demo. Exercises the full
// generative-UI stack when the chat UI is composed manually: two backend
// tools (weather + stock price) wired through `useRenderTool`, plus a
// frontend-registered `highlight_note` tool the agent can invoke via the
// same tool-call channel. The system prompt nudges the model toward the
// right surface per user question and falls back to plain text otherwise.
//
// Note: `highlight_note` is intentionally NOT declared here — it's a
// frontend-only tool registered via `useComponent` in the demo's
// `tool-renderers.tsx`. The agent picks it up through CopilotKit's
// frontend-tool forwarding when `copilotkit.runAgent` is called.
export const headlessCompleteAgent = new Agent({
  id: "headless-complete-agent",
  name: "Headless Complete Agent",
  tools: {
    weatherTool,
    stockPriceTool,
  },
  model: openai("gpt-4o-mini"),
  instructions: `You are a helpful, concise assistant wired into a headless chat surface that demonstrates CopilotKit's full rendering stack. Pick the right surface for each user question and fall back to plain text when none of the tools fit.

Routing rules:
  - If the user asks about weather for a place, call \`get_weather\` with the location.
  - If the user asks about a stock or ticker (AAPL, TSLA, MSFT, ...), call \`get_stock_price\` with the ticker.
  - If the user asks you to highlight, flag, or mark a short note or phrase, call the frontend \`highlight_note\` tool with the text and a color (yellow, pink, green, or blue). Do NOT ask the user for the color — pick a sensible one if they didn't say.
  - Otherwise, reply in plain text.

After a tool returns, write one short sentence summarizing the result. Never fabricate data a tool could provide.`,
  memory: new Memory({
    storage: new LibSQLStore({
      id: "headless-complete-agent-memory",
      url: "file::memory:",
    }),
    options: {
      workingMemory: {
        enabled: true,
        schema: AgentState,
      },
    },
  }),
});
