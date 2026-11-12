import type { FrontendTool } from "../types";
import type { CopilotKitCore } from "./core";

// oxlint-disable-next-line typescript/no-explicit-any -- tools of any argument shape; a handler's `args` type is contravariant
type AnyFrontendTool = FrontendTool<any>;

/** @internal The renderer that {@link ɵregisterFrontendTools} adds for a tool. */
export interface ɵFrontendToolRenderer<TRender> {
  name: string;
  args: AnyFrontendTool["parameters"];
  agentId: string | undefined;
  render: TRender;
}

function toolKey(tool: { name: string; agentId?: string }) {
  return `${tool.agentId ?? ""}:${tool.name}`;
}

/**
 * @internal Register frontend tools from a hook (`useFrontendTool`,
 * `useFrontendTools`) and their renderers.
 *
 * - Tools with the same `name` and `agentId` in `tools` collapse to the last
 *   one, with a warning.
 * - A tool that hides an already registered tool (a provider tool or another
 *   hook) logs a warning. Core runs the newest registration until it is
 *   removed, and then the hidden tool runs again.
 * - A tool with a `render` gets a renderer through `addRenderer`, also when
 *   it has no `parameters` (for example a confirm dialog). The returned
 *   function does not remove renderers, so past calls still render in the
 *   chat history.
 *
 * @param core - The core to register the tools with.
 * @param tools - The tools, in order.
 * @param addRenderer - Adds a hook renderer in the framework's registry.
 * @returns A function that removes exactly the tools this call registered.
 *
 * @example
 * const unregister = ɵregisterFrontendTools(core, [tool], (renderer) =>
 *   core.addHookRenderToolCall(renderer),
 * );
 * // on unmount
 * unregister();
 */
export function ɵregisterFrontendTools<
  TTool extends AnyFrontendTool & { render?: unknown },
>(
  core: Pick<CopilotKitCore, "getTool" | "addTool">,
  tools: readonly TTool[],
  addRenderer: (
    renderer: ɵFrontendToolRenderer<NonNullable<TTool["render"]>>,
  ) => void,
): () => void {
  const deduped = new Map<string, TTool>();
  for (const tool of tools) {
    const key = toolKey(tool);
    if (deduped.has(key)) {
      console.warn(
        `Tool '${tool.name}' is listed more than once for agent '${tool.agentId || "global"}' in the same useFrontendTools call. Using the last entry.`,
      );
    }
    deduped.set(key, tool);
  }

  const unregisters: Array<() => void> = [];
  for (const tool of deduped.values()) {
    if (core.getTool({ toolName: tool.name, agentId: tool.agentId })) {
      console.warn(
        `Tool '${tool.name}' already exists for agent '${tool.agentId || "global"}'. Overriding with latest registration.`,
      );
    }
    unregisters.push(core.addTool(tool));

    if (tool.render) {
      addRenderer({
        name: tool.name,
        args: tool.parameters,
        agentId: tool.agentId,
        render: tool.render,
      });
    }
  }

  return () => {
    for (const unregister of unregisters) unregister();
  };
}
