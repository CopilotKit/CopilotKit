import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  getWeatherImpl,
  queryDataImpl,
} from "@copilotkit/showcase-shared-tools";

export const weatherTool = createTool({
  id: "get-weather",
  description: "Get current weather for a location",
  inputSchema: z.object({
    location: z.string().describe("City name"),
  }),
  execute: async ({ context }) =>
    JSON.stringify(getWeatherImpl(context.location)),
});

export const queryDataTool = createTool({
  id: "query-data",
  description: "Query financial database for chart data",
  inputSchema: z.object({
    query: z.string().describe("Natural language query"),
  }),
  execute: async ({ context }) => JSON.stringify(queryDataImpl(context.query)),
});
