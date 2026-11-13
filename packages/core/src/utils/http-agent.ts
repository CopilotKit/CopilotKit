import { HttpAgent } from "@ag-ui/client";

/**
 * Whether an agent is an `HttpAgent`, including one built from another copy of
 * `@ag-ui/client` (an app that pins its own 0.x version next to CopilotKit's
 * 1.0, for example). `instanceof` is false across package copies, which made
 * CopilotKit silently skip headers and abort wiring for those agents. The
 * fallback checks the public fields CopilotKit uses, which every published
 * `HttpAgent` has.
 */
export function ɵisHttpAgent(agent: unknown): agent is HttpAgent {
  if (agent instanceof HttpAgent) return true;
  if (typeof agent !== "object" || agent === null) return false;
  const candidate = agent as Record<string, unknown>;
  return (
    typeof candidate.url === "string" &&
    typeof candidate.headers === "object" &&
    candidate.headers !== null &&
    candidate.abortController instanceof AbortController &&
    typeof candidate.runAgent === "function"
  );
}
