import { Mastra } from "@mastra/core/mastra";
import { PinoLogger } from "@mastra/loggers";
import { LibSQLStore } from "@mastra/libsql";

import { defaultAgent } from "./agents";

export const mastra = new Mastra({
  server: {
    port: process.env.PORT ? parseInt(process.env.PORT) : 4111,
    host: "0.0.0.0",
  },
  agents: {
    default: defaultAgent,
  },
  storage: new LibSQLStore({
    id: "mastra-storage",
    url: ":memory:",
  }),
  logger: new PinoLogger({
    name: "Mastra",
    level: "info",
  }),
});
