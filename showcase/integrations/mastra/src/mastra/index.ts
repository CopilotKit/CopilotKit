import { Mastra } from "@mastra/core/mastra";
import { LibSQLStore } from "@mastra/libsql";
import {
  weatherAgent,
  headlessCompleteAgent,
  sharedStateReadWriteAgent,
  subagentsSupervisorAgent,
  interruptAgent,
  multimodalAgent,
  mcpAppsAgent,
  byocHashbrownAgent,
} from "./agents";
import { ConsoleLogger, LogLevel } from "@mastra/core/logger";

const LOG_LEVEL = (process.env.LOG_LEVEL as LogLevel) || "info";

export const mastra = new Mastra({
  agents: {
    weatherAgent,
    headlessCompleteAgent,
    sharedStateReadWriteAgent,
    subagentsSupervisorAgent,
    interruptAgent,
    multimodalAgent,
    mcpAppsAgent,
    byocHashbrownAgent,
  },
  storage: new LibSQLStore({
    id: "mastra-storage",
    url: ":memory:",
  }),
  logger: new ConsoleLogger({
    level: LOG_LEVEL,
  }),
});
