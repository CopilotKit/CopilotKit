// The Mastra instance that holds every agent of the mastra demos. It is built
// on the first call to `getMastra()`, not when this module loads, because its
// agents open LibSQL stores (see `workingMemoryDbUrl` in ./agents).
import { Mastra } from "@mastra/core/mastra";
import { ConsoleLogger, LogLevel } from "@mastra/core/logger";
import { LibSQLStore } from "@mastra/libsql";
import {
  createA2uiRecoveryAgent,
  createBackgroundAgentsAgent,
  createBeautifulChatAgent,
  createBrowserUseAgent,
  createByocHashbrownAgent,
  createGenUiAgent,
  createHeadlessCompleteAgent,
  createInterruptAgent,
  createMcpAppsAgent,
  createMultimodalAgent,
  createObservationalMemoryAgent,
  createOpenGenUiAdvancedAgent,
  createOpenGenUiAgent,
  createReasoningAgent,
  createReasoningChainAgent,
  createSharedStateReadWriteAgent,
  createSharedStateStreamingAgent,
  createSubagentsSupervisorAgent,
  createToolRenderingAgent,
  createWeatherAgent,
} from "./agents";

// Every agent, by the key that `mastra.getAgent(key)` takes.
function createAgents() {
  return {
    weatherAgent: createWeatherAgent(),
    beautifulChatAgent: createBeautifulChatAgent(),
    headlessCompleteAgent: createHeadlessCompleteAgent(),
    sharedStateReadWriteAgent: createSharedStateReadWriteAgent(),
    sharedStateStreamingAgent: createSharedStateStreamingAgent(),
    genUiAgent: createGenUiAgent(),
    reasoningAgent: createReasoningAgent(),
    reasoningChainAgent: createReasoningChainAgent(),
    toolRenderingAgent: createToolRenderingAgent(),
    subagentsSupervisorAgent: createSubagentsSupervisorAgent(),
    interruptAgent: createInterruptAgent(),
    a2uiRecoveryAgent: createA2uiRecoveryAgent(),
    multimodalAgent: createMultimodalAgent(),
    mcpAppsAgent: createMcpAppsAgent(),
    byocHashbrownAgent: createByocHashbrownAgent(),
    browserUseAgent: createBrowserUseAgent(),
    backgroundAgentsAgent: createBackgroundAgentsAgent(),
    observationalMemoryAgent: createObservationalMemoryAgent(),
    openGenUiAgent: createOpenGenUiAgent(),
    openGenUiAdvancedAgent: createOpenGenUiAdvancedAgent(),
  };
}

/** The key of a Mastra agent, for `mastra.getAgent(key)`. */
export type MastraAgentKey = keyof ReturnType<typeof createAgents>;

// The level from LOG_LEVEL, or "info" when it is unset or not a level.
function logLevel() {
  const level = process.env.LOG_LEVEL;
  return (
    Object.values(LogLevel).find((known) => known === level) ?? LogLevel.INFO
  );
}

function createMastra() {
  return new Mastra({
    agents: createAgents(),
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
      level: logLevel(),
    }),
  });
}

let mastra: ReturnType<typeof createMastra> | undefined;

/**
 * The Mastra instance with every agent of the mastra demos. The first call
 * builds it, and later calls return the same instance, so all demos share its
 * storage and background task manager.
 */
export function getMastra() {
  mastra ??= createMastra();
  return mastra;
}
