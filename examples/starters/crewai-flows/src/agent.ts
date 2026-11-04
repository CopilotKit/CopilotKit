import { HttpAgent } from "@ag-ui/client";

/** Builds this starter's agent. See channel-host.mts for why this is shared. */
export function createDefaultAgent(): HttpAgent {
  return new HttpAgent({
    url: (process.env.AGENT_URL || "http://localhost:8000").replace(/\/$/, ""),
  });
}
