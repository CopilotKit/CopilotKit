import { MastraAgent } from "@ag-ui/mastra";
import type { AbstractAgent } from "@ag-ui/client";
import { mastra } from "@/mastra";

/** Run the real Mastra project agent in the Next.js server process. */
export function createLocalAgents(): Record<string, AbstractAgent> {
  // Omitting resourceId lets the bridge isolate working memory by threadId.
  return {
    default: new MastraAgent({
      agentId: "default",
      agent: mastra.getAgent("default"),
    }),
  };
}
