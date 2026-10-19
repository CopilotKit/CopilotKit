import { openai } from "@ai-sdk/openai";
import { Agent } from "@mastra/core/agent";
import { LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import { AgentStateSchema } from "@/lib/state";
import { systemPrompt } from "./systemPrompt";

export const projectAgent = new Agent({
  id: "project-manager",
  name: "Project Manager",
  model: openai("gpt-5-mini"),
  instructions: systemPrompt,
  memory: new Memory({
    storage: new LibSQLStore({ id: "project-memory", url: ":memory:" }),
    options: {
      workingMemory: {
        enabled: true,
        schema: AgentStateSchema,
        // The AG-UI bridge writes initial state to resource-scoped memory.
        scope: "resource",
      },
    },
  }),
});
