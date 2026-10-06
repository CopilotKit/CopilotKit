import { HttpAgent } from "@ag-ui/client";

/**
 * The agent name this starter registers.
 *
 * One name, used in three places that must agree: the runtime route's
 * `agents: { [AGENT_ID]: ... }` map, the `agentId` the page's hooks bind to,
 * and the Channel host. Exported from here so renaming the agent is a
 * one-line change.
 */
export const AGENT_ID = "default";

/** Builds this starter's agent. See channel-host.mts for why this is shared. */
export function createDefaultAgent(): HttpAgent {
  return new HttpAgent({
    url: process.env.AGENT_URL || "http://localhost:8000/",
  });
}
