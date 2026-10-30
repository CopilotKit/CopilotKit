import { useLayoutEffect } from "react";
import { useCopilotKit } from "../context";
import type { ReactFrontendTool } from "../types/frontend-tool";
import { useDepsVersion } from "./tool-registration";

/**
 * Register a frontend tool while the component is mounted. The agent can
 * call it, and its `render` component draws the call in the chat.
 *
 * A tool with the same name and agentId as a tool that is already registered
 * (for example one from the provider's `tools`) overrides it while this
 * component is mounted. When the component unmounts, the overridden tool is
 * active again. The renderer stays registered after unmount, so past tool
 * calls still render in the chat history.
 *
 * @param tool - The tool to register.
 * @param deps - Extra values that re-register the tool when they change. Use
 *   it when the handler closes over a value that is not part of the tool.
 *
 * @example
 * ```tsx
 * useFrontendTool({
 *   name: "showWeather",
 *   description: "Show the weather for a city",
 *   parameters: z.object({ city: z.string() }),
 *   handler: async ({ city }) => `Sunny in ${city}`,
 * });
 * ```
 */
export function useFrontendTool<
  T extends Record<string, unknown> = Record<string, unknown>,
>(tool: ReactFrontendTool<T>, deps?: ReadonlyArray<unknown>) {
  const { copilotkit } = useCopilotKit();
  // Plain data in `deps` compares by value, everything else by identity; see
  // useDepsVersion. Only the resulting number enters the effect's dependency
  // list, so `deps` is never serialized and may hold a circular value such as
  // the agent from useAgent.
  const depsVersion = useDepsVersion(deps);

  useLayoutEffect(() => {
    const name = tool.name;

    // This registration hides any tool with the same name and agentId (a
    // provider tool or another hook) until this effect cleans up. Unregistering
    // brings the hidden tool back.
    if (copilotkit.getTool({ toolName: name, agentId: tool.agentId })) {
      console.warn(
        `Tool '${name}' already exists for agent '${tool.agentId || "global"}'. Overriding with latest registration.`,
      );
    }
    const unregister = copilotkit.addTool(tool);

    // Register/override renderer by name and agentId through core.
    // The render function is registered even when tool.parameters is
    // undefined — tools like HITL confirm dialogs have no parameters
    // but still need their UI rendered in the chat.
    if (tool.render) {
      copilotkit.addHookRenderToolCall({
        name,
        args: tool.parameters,
        agentId: tool.agentId,
        render: tool.render,
      });
    }

    return () => {
      unregister();
      // we are intentionally not removing the render here so that the tools can still render in the chat history
    };
    // Depend on stable keys by default and allow callers to opt into
    // additional dependencies for dynamic tool configuration.
    // tool.available is included so toggling availability re-registers the tool.
    // tool.webmcp is compared by value (it is commonly an object literal), so
    // a changed WebMCP config re-registers without churning on identity.
  }, [
    tool.name,
    tool.available,
    copilotkit,
    depsVersion,
    JSON.stringify(tool.webmcp ?? null),
  ]);
}
