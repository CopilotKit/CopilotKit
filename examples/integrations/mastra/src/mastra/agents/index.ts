import { openai } from "@ai-sdk/openai";
import { Agent } from "@mastra/core/agent";
import { weatherTool } from "@/mastra/tools";
import { LibSQLStore } from "@mastra/libsql";
import { z } from "zod";
import { Memory } from "@mastra/memory";

export const AgentState = z.object({
  proverbs: z.array(z.string()).default([]),
});

export const weatherAgent = new Agent({
  id: "weather-agent",
  name: "Weather Agent",
  tools: { weatherTool },
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
        // Resource scope, not thread scope. The CopilotKit bridge writes the
        // UI's shared state into working memory before it streams a turn, and
        // that write only upserts in the resource store. Thread-scoped working
        // memory lives in thread metadata instead, which requires the thread
        // row to exist already -- on the first turn of a conversation it does
        // not, so the run fails with "Thread <id> not found" and the chat never
        // answers. State stays per conversation here, because the bridge
        // derives the resource id from the thread id.
        scope: "resource",
      },
    },
  }),
});
