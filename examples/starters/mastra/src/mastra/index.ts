import { Mastra } from "@mastra/core/mastra";
import { LibSQLStore } from "@mastra/libsql";
import { weatherAgent } from "./agents";
import type { LogLevel } from "@mastra/core/logger";
import { ConsoleLogger } from "@mastra/core/logger";

const LOG_LEVEL = (process.env.LOG_LEVEL as LogLevel) || "info";

export const mastra = new Mastra({
  agents: {
    default: weatherAgent,
  },
  // `mastra dev` serves Studio and an unauthenticated tool-execute API on this
  // port. With no `host` set, Mastra hands `hostname: undefined` to the Node
  // listener, which binds every interface, while the startup banner still
  // prints "localhost" — so a fresh clone is reachable from the local network
  // and says otherwise. Pin it to loopback.
  //
  // The banner interpolates this same value, so overriding MASTRA_HOST (to
  // reach the dev server from another device, for example) keeps the printed
  // address and the bound address in agreement.
  server: {
    host: process.env.MASTRA_HOST ?? "127.0.0.1",
  },
  storage: new LibSQLStore({
    id: "mastra-storage",
    url: ":memory:",
  }),
  logger: new ConsoleLogger({
    level: LOG_LEVEL,
  }),
});
