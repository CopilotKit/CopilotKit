/**
 * Mastra instance for the Agentic Chat cell.
 *
 * Registers exactly one agent (`agentic_chat`) configured for the
 * frontend's `useRenderTool` (weather) + `useFrontendTool`
 * (change_background) + `useAgentContext` (user name) patterns.
 */

import { Mastra } from "@mastra/core/mastra";
import { Agent } from "@mastra/core/agent";
import { LibSQLStore } from "@mastra/libsql";
import { ConsoleLogger, LogLevel } from "@mastra/core/logger";
import { Memory } from "@mastra/memory";
import { createTool } from "@mastra/core/tools";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

import { getWeatherImpl } from "./shared-tools/get-weather";

const weatherTool = createTool({
  id: "get_weather",
  description: "Get current weather for a location",
  inputSchema: z.object({
    location: z.string().describe("City name"),
  }),
  execute: async ({ context }) =>
    JSON.stringify(getWeatherImpl(context.location)),
});

export const agenticChatAgent = new Agent({
  id: "agentic_chat",
  name: "Agentic Chat Agent",
  model: openai("gpt-4o"),
  instructions: "You are a helpful assistant.",
  tools: { weatherTool },
  memory: new Memory({
    storage: new LibSQLStore({
      id: "agentic-chat-memory",
      url: "file::memory:",
    }),
  }),
});

const LOG_LEVEL = (process.env.LOG_LEVEL as LogLevel) || "info";

export const mastra = new Mastra({
  agents: {
    agentic_chat: agenticChatAgent,
  },
  storage: new LibSQLStore({
    id: "mastra-storage",
    url: ":memory:",
  }),
  logger: new ConsoleLogger({
    level: LOG_LEVEL,
  }),
});
