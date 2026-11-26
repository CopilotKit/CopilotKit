import { HttpAgent } from "@ag-ui/client";

/**
 * Builds this starter's agent: the Cloudflare Worker in agent/, which serves
 * the `Assistant` agent over AG-UI at /agents/assistant and runs each thread
 * in its own Durable Object. See channel-host.mts for why this is shared.
 */
export function createDefaultAgent(): HttpAgent {
  return new HttpAgent({
    // Strip any trailing slash so a user-set AGENT_URL like "http://host:8000/"
    // does not produce a double slash.
    url:
      (process.env.AGENT_URL || "http://localhost:8000").replace(/\/+$/, "") +
      "/agents/assistant",
  });
}
