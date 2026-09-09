import { LlamaIndexAgent } from "@ag-ui/llamaindex";

/** Builds this starter's agent. See channel-host.mts for why this is shared. */
export function createDefaultAgent(): LlamaIndexAgent {
  return new LlamaIndexAgent({
    url:
      (process.env.AGENT_URL || "http://127.0.0.1:9000").replace(/\/$/, "") +
      "/run",
  });
}
