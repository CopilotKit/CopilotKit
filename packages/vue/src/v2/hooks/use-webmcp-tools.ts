import { watch } from "vue";
import { WebMCPConsumer } from "@copilotkit/core";
import type { WebMCPToolsOptions } from "@copilotkit/core";
import { useCopilotKit } from "../providers/useCopilotKit";

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
      () => nameWatchKey(options.name),
    ],
    (_newValues, _old, onCleanup) => {
      const consumer = new WebMCPConsumer(copilotkit.value);
      consumer.start({
        agentId: options.agentId,
        allow: options.allow,
        deny: options.deny,
        name: options.name,
      });
      onCleanup(() => {
        consumer.stop();
      });
    },
    { immediate: true },
  );
}
