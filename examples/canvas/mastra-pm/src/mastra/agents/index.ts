import { openai } from "@ai-sdk/openai";
import { Agent } from "@mastra/core/agent";
import { weatherTool } from "@/mastra/tools";
import { LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import { AgentStateSchema } from "@/lib/state";
import { systemPrompt } from "./systemPrompt";

export const weatherAgent = new Agent({
  name: "Weather Agent",
  tools: { weatherTool },
  model: openai("gpt-4o"),
  instructions: systemPrompt,
  memory: new Memory({
    storage: new LibSQLStore({ url: "file::memory:" }),
    options: {
      workingMemory: {
        enabled: true,
        schema: AgentStateSchema,
      },
    },
  }),
});
