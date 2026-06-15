import { HttpAgent } from "@ag-ui/client";

/**
 * One AG-UI agent per WhatsApp conversation. The backend (runtime.ts) is a
 * CopilotKit BuiltInAgent, which does not require a UUID threadId, so the
 * conversation-derived threadId from the adapter's conversation store is fine.
 */
export function makeAgent(agentUrl: string, headers?: Record<string, string>) {
  return (threadId: string): HttpAgent => {
    const a = new HttpAgent({ url: agentUrl, headers });
    a.threadId = threadId;
    return a;
  };
}
