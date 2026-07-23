import { Mastra } from "@mastra/core/mastra";
import { LibSQLStore } from "@mastra/libsql";
import {
  weatherAgent,
  headlessCompleteAgent,
  sharedStateReadWriteAgent,
  sharedStateStreamingAgent,
  genUiAgent,
  reasoningAgent,
  reasoningChainAgent,
  toolRenderingAgent,
  subagentsSupervisorAgent,
  interruptAgent,
  a2uiRecoveryAgent,
  multimodalAgent,
  mcpAppsAgent,
  byocHashbrownAgent,
  browserUseAgent,
  backgroundAgentsAgent,
  observationalMemoryAgent,
} from "./agents";
import { ConsoleLogger, LogLevel } from "@mastra/core/logger";

const LOG_LEVEL = (process.env.LOG_LEVEL as LogLevel) || "info";

export const mastra = new Mastra({
  agents: {
    weatherAgent,
    headlessCompleteAgent,
    sharedStateReadWriteAgent,
    sharedStateStreamingAgent,
    genUiAgent,
    reasoningAgent,
    reasoningChainAgent,
    toolRenderingAgent,
    subagentsSupervisorAgent,
    interruptAgent,
    a2uiRecoveryAgent,
    multimodalAgent,
    mcpAppsAgent,
    byocHashbrownAgent,
    browserUseAgent,
    backgroundAgentsAgent,
    observationalMemoryAgent,
  },
  storage: new LibSQLStore({
    id: "mastra-storage",
    url: ":memory:",
  }),
  // Enables Mastra's BackgroundTaskManager so tools flagged
  // `background: { enabled: true }` (e.g. `run_deep_research`, used by the
  // Background Agents demo) are dispatched to run in the background instead
  // of inline in the agentic loop. Without this the manager is off and the
  // tool would run synchronously, never emitting a `background-task-started`
  // lifecycle chunk.
  backgroundTasks: {
    enabled: true,
  },
  logger: new ConsoleLogger({
    level: LOG_LEVEL,
  }),
});
