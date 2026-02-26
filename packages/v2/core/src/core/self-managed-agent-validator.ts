import {
  AbstractAgent,
  FilterToolCallsMiddleware,
  Middleware,
} from "@ag-ui/client";

/**
 * Middlewares that are not allowed on client-side self-managed agents.
 * These are security-relevant or server-only middlewares.
 */
const DISALLOWED_MIDDLEWARES: Array<{
  ctor: new (...args: any[]) => Middleware;
  name: string;
  reason: string;
}> = [
  {
    ctor: FilterToolCallsMiddleware,
    name: "FilterToolCallsMiddleware",
    reason: "tool call filtering on the client is not secure",
  },
];

/**
 * Validates that a self-managed agent does not use any disallowed AG-UI middlewares.
 * Throws if a disallowed middleware is found.
 */
export function validateSelfManagedAgentMiddlewares(
  agentId: string,
  agent: AbstractAgent,
): void {
  // Access private middlewares array — necessary for validation
  const middlewares: Middleware[] = (agent as any).middlewares ?? [];

  for (const mw of middlewares) {
    for (const disallowed of DISALLOWED_MIDDLEWARES) {
      if (mw instanceof disallowed.ctor) {
        throw new Error(
          `${disallowed.name} cannot be used with selfManagedAgents (agent: "${agentId}") — ` +
            `${disallowed.reason}. Use a server-side CopilotRuntime instead.`,
        );
      }
    }
  }
}
