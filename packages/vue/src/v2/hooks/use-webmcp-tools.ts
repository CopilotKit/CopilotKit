import { watch } from "vue";
import { WebMCPConsumer } from "@copilotkit/core";
import type { WebMCPToolsOptions } from "@copilotkit/core";
import { useCopilotKit } from "../providers/useCopilotKit";

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
 * ```ts
 * import { useWebmcpTools } from "@copilotkit/vue/v2";
 *
 * useWebmcpTools({
 *   agentId: "support",
 *   allow: ["searchOrders", "getOrder"],
 *   deny: ["deleteOrder"],
 * });
 * ```
 */
export function useWebmcpTools(options: WebMCPToolsOptions = {}) {
  const { copilotkit } = useCopilotKit();

  watch(
    [
      copilotkit,
      () => options.agentId,
      () => JSON.stringify(options.allow ?? null),
      () => JSON.stringify(options.deny ?? null),
      () => options.filter,
    ],
    (_newValues, _old, onCleanup) => {
      const consumer = new WebMCPConsumer(copilotkit.value);
      consumer.start({
        agentId: options.agentId,
        allow: options.allow,
        deny: options.deny,
        filter: options.filter,
      });
      onCleanup(() => {
        consumer.stop();
      });
    },
    { immediate: true },
  );
}
