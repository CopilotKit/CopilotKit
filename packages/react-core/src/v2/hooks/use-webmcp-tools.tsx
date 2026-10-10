import { useLayoutEffect } from "react";
import { WebMCPConsumer } from "@copilotkit/core";
import type { WebMCPToolsOptions } from "@copilotkit/core";
import { useCopilotKit } from "../context";

export type { WebMCPToolsOptions };

/**
 * Import page WebMCP tools from `document.modelContext.getTools()` so a
 * CopilotKit agent can call them.
 *
 * With no filters, every same-origin tool that has a name and a description
 * is imported. Filter order is allow, then deny, then `filter`. Tools this
 * app already published with `useFrontendTool({ webmcp: true })` are skipped.
 * Missing `document.modelContext` is a no-op.
 *
 * @example
 * ```tsx
 * import { useWebmcpTools } from "@copilotkit/react-core/v2";
 *
 * function PageTools() {
 *   useWebmcpTools({
 *     agentId: "support",
 *     allow: ["searchOrders", "getOrder"],
 *     deny: ["deleteOrder"],
 *   });
 *   return null;
 * }
 * ```
 */
export function useWebmcpTools(options: WebMCPToolsOptions = {}) {
  const { copilotkit } = useCopilotKit();
  const allowKey = JSON.stringify(options.allow ?? null);
  const denyKey = JSON.stringify(options.deny ?? null);

  useLayoutEffect(() => {
    const consumer = new WebMCPConsumer(copilotkit);
    consumer.start({
      agentId: options.agentId,
      allow: options.allow,
      deny: options.deny,
      filter: options.filter,
    });
    return () => {
      consumer.stop();
    };
    // allow/deny are serialized so array identity does not re-register.
    // filter is compared by function identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- serialized allow/deny keys
  }, [copilotkit, options.agentId, allowKey, denyKey, options.filter]);
}
