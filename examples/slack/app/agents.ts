import { HttpAgent } from "@copilotkit/channels";

/**
 * Point a named extra agent at the sibling AG-UI run URL.
 * `AGENT_URL` is the default agent's run path
 * (`.../agent/triage/run`). The extra agent is `.../agent/<id>/run`.
 */
export function siblingAgentRunUrl(agentUrl: string, agentId: string): string {
  const trimmed = agentUrl.replace(/\/$/, "");
  const match = trimmed.match(/^(.*)\/agent\/[^/]+\/run$/);
  if (match) return `${match[1]}/agent/${agentId}/run`;
  return `${trimmed}/agent/${agentId}/run`;
}

/** One isolated HttpAgent per Channel run. `threadId` is the checkpoint id. */
export function httpAgentFactory(
  url: string,
  headers?: Record<string, string>,
): (threadId: string) => HttpAgent {
  return (threadId) => {
    const agent = new HttpAgent({ url, headers });
    agent.threadId = threadId;
    return agent;
  };
}
