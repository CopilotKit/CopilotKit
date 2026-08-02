import { MastraAgent } from "@ag-ui/mastra";
import type { AbstractAgent } from "@ag-ui/client";
import { mastra } from "@/mastra";

/**
 * Every local Mastra agent, keyed by name — what the web route mounts.
 *
 * Unlike the HTTP-backed starters there is no agent server here: the agents run
 * in this process.
 */
export function createLocalAgents(): Record<string, AbstractAgent> {
  // @ts-expect-error - ignore for now, typing error
  return MastraAgent.getLocalAgents({ mastra }) as Record<
    string,
    AbstractAgent
  >;
}

/**
 * The single agent the managed Channel drives.
 *
 * A Channel is one conversation surface, so it takes one agent. The first local
 * agent is the deliberate choice, and an empty registry is a configuration error
 * worth failing loudly on rather than starting a Channel that answers nothing.
 */
export function createDefaultAgent(): AbstractAgent {
  const agents = createLocalAgents();
  const first = Object.values(agents)[0];
  if (!first) {
    throw new Error(
      "No local Mastra agents found — check src/mastra registers at least one.",
    );
  }
  return first;
}
