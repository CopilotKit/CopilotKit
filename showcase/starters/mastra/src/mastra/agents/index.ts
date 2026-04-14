import { openai } from "@ai-sdk/openai";
import { Agent } from "@mastra/core/agent";
import {
  weatherTool,
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
