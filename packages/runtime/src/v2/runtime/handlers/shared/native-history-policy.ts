import type { AbstractAgent } from "@ag-ui/client";
import type { MCPAppsMiddleware } from "@ag-ui/mcp-apps-middleware";

// Only request clones admitted by the trusted native-history branch are marked.
// HTTP input, forwarded props, and the shared agent registration cannot opt in.
const nativeHistoryRequests = new WeakMap<AbstractAgent, true>();

export function enableNativeHistoryForRequest(agent: AbstractAgent): void {
  nativeHistoryRequests.set(agent, true);
}

type MCPAppsOptions = NonNullable<
  ConstructorParameters<typeof MCPAppsMiddleware>[0]
>;
type ContinuationInput = "full-history" | "tool-results";

/** Requires MCPAppsMiddleware with continuationInput support; older versions ignore this policy. */
export function mcpAppsOptionsForRequest(
  agent: AbstractAgent,
  options: MCPAppsOptions,
): MCPAppsOptions & { readonly continuationInput: ContinuationInput } {
  return {
    ...options,
    // Middleware setup precedes Intelligence admission. The middleware retains
    // this config object, so read the clone's policy when continuation begins.
    get continuationInput(): ContinuationInput {
      return nativeHistoryRequests.has(agent) ? "tool-results" : "full-history";
    },
  };
}
