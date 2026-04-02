import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { LibSQLStore } from "@mastra/libsql";
import { weatherTool } from "../tools/weather-tool";
import { queryDataTool } from "../tools/query-data";
import { generateFormTool } from "../tools/form";

export const defaultAgent = new Agent({
  id: "default",
  name: "Default Agent",
  instructions: `
      You are a helpful assistant that can help with a variety of tasks.

      You have access to several tools:
      - get_weather: Fetch current weather data for any location.
      - query_data: Query financial data from a database. Always call this before showing charts or graphs.
      - generate_form: Generate an event registration form using declarative UI.

      Keep responses concise but informative.
  `,
  model: "openai/gpt-4.1-mini",
  tools: {
    get_weather: weatherTool,
    query_data: queryDataTool,
    generate_form: generateFormTool,
  },
  memory: new Memory({
    storage: new LibSQLStore({
      id: "default-agent-memory",
      url: "file:../mastra.db",
    }),
  }),
});
