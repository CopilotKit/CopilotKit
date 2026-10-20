import { Agent } from "@mastra/core/agent";
import type { RequestContext } from "@mastra/core/request-context";
import { weatherTool } from "@/mastra/tools";
import { LibSQLStore } from "@mastra/libsql";
import { z } from "zod";
import { Memory } from "@mastra/memory";
import { createLanguageModel } from "@/mastra/model";

export const AgentState = z.object({
  proverbs: z.array(z.string()).default([]),
});

/**
 * Append what the page shares (`useAgentContext`) to the agent's instructions.
 *
 * `@ag-ui/mastra` stores a run's AG-UI `context` on the request context under
 * `"ag-ui"` and does not add it to the prompt itself, so without this the
 * model never sees it.
 */
function withPageContext(
  instructions: string,
  requestContext: RequestContext,
): string {
  const agUi = requestContext.get("ag-ui") as
    | { context?: { description: string; value: string }[] }
    | undefined;
  const entries = agUi?.context ?? [];
  if (entries.length === 0) return instructions;
  const shared = entries
    .map(({ description, value }) => `${description}:\n${value}`)
    .join("\n\n");
  return `${instructions}\n\nContext provided by the application:\n\n${shared}`;
}

export const weatherAgent = new Agent({
  id: "weather-agent",
  name: "Weather Agent",
  tools: { weatherTool },
  // COPILOTKIT_AGENT_MODEL (e.g. "anthropic:claude-sonnet-4-5") overrides this;
  // unset, the agent uses gpt-5-mini.
  model: createLanguageModel("openai:gpt-5-mini"),
  instructions: ({ requestContext }) =>
    withPageContext("You are a helpful assistant.", requestContext),
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
