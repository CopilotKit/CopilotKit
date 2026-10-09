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

/**
 * Pick the named extra agent from ordinary chat text.
 * Slack mentions look like `<@U123> search: foo`. No slash command needed.
 */
export function parseNamedAgentPrompt(text: string): {
  agentId: "search" | undefined;
  prompt: string;
} {
  const stripped = text
    .replace(/^(<@[^>]+>\s*)+/g, "")
    .replace(/^@\S+\s+/g, "")
    .trim();
  const match = stripped.match(/^search(?:\s*[:-]\s*|\s+)(.+)$/i);
  if (match) return { agentId: "search", prompt: match[1]!.trim() };
  return { agentId: undefined, prompt: stripped };
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
