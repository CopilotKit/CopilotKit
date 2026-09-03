import { useLayoutEffect } from "react";
import { WebMCPConsumer } from "@copilotkit/core";
import type { WebMCPToolsOptions } from "@copilotkit/core";
import { useCopilotKit } from "../context";

export type { WebMCPToolsOptions };

function nameWatchKey(name: WebMCPToolsOptions["name"]) {
  if (name instanceof RegExp) {
    return `/${name.source}/${name.flags}`;
  }
  return name ?? "";
}

/**
 * Import page WebMCP tools from `document.modelContext.getTools()` so a
 * CopilotKit agent can call them.
 *
 * With no filters, every same-origin tool is imported. Filter order is allow,
 * then deny, then `name`. Tools this app already published with
 * `useFrontendTool({ webmcp: true })` are skipped. Missing
 * `document.modelContext` is a no-op.
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
  const nameKey = nameWatchKey(options.name);

  useLayoutEffect(() => {
    const consumer = new WebMCPConsumer(copilotkit);
    consumer.start({
      agentId: options.agentId,
      allow: options.allow,
      deny: options.deny,
      name: options.name,
    });
    return () => {
      consumer.stop();
    };
    // allow/deny/name are represented by allowKey/denyKey/nameKey so object
    // identity does not re-register on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- serialized filter keys
  }, [copilotkit, options.agentId, allowKey, denyKey, nameKey]);
}
