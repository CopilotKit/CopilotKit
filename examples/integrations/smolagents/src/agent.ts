import { HttpAgent } from "@ag-ui/client";

/** Builds this starter's agent, served by agent/main.py. */
export function createDefaultAgent(): HttpAgent {
  return new HttpAgent({
    url:
      (process.env.AGENT_URL || "http://localhost:8000").replace(/\/$/, "") +
      "/agui",
  });
}
