import { Mastra } from "@mastra/core/mastra";
import { createLogger } from "@mastra/core/logger";

import { mastraAgent } from "./agents";

export const mastra = new Mastra({
  agents: { mastraAgent },
  logger: createLogger({
    name: "Mastra",
    level: "info",
  }),
});
