import { useLayoutEffect } from "react";
import { useCopilotKit } from "../context";
import type { ReactFrontendTool } from "../types/frontend-tool";

const EMPTY_DEPS: ReadonlyArray<unknown> = [];
const EMPTY_TOOLS: ReadonlyArray<ReactFrontendTool<any>> = [];

/**
 * Register a list of frontend tools whose length can change between renders.
 *
 * `useFrontendTool` registers exactly one tool per call, so it cannot be called
 * in a loop over a runtime-length list without breaking the rules of hooks.
 * This hook runs a single effect over the whole array instead, which makes it
 * safe to build the list from state, props, or a server response.
 *
 * Tools are keyed by `name` plus `agentId`, the same as `useFrontendTool`. A
 * tool that disappears from the array is unregistered on the next render, and
 * every tool is unregistered on unmount. Renderers stay registered after
 * unmount so past tool calls still render in the chat history.
 *
 * @param tools - The tools to register. May be empty and may change length.
 * @param deps - Extra dependencies that force re-registration, compared by
 * identity like the second argument of `useEffect`. Use this when a handler
 * closes over a value that is not part of the tool definition. Keep the array
 * a constant length across renders.
 *
 * @example
 * Register one tool per item in application state:
 * ```tsx
 * const [reports, setReports] = useState<Report[]>([]);
 *
 * useFrontendTools(
 *   reports.map((report) => ({
 *     name: `open_${report.id}`,
 *     description: `Open the ${report.title} report`,
 *     handler: async () => navigate(`/reports/${report.id}`),
 *   })),
 *   [navigate],
 * );
 * ```
 *
 * @example
 * Register tools described by the backend:
 * ```tsx
 * const { data } = useQuery(fetchToolDescriptors);
 *
 * useFrontendTools(
 *   (data ?? []).map((descriptor) => ({
 *     name: descriptor.name,
 *     description: descriptor.description,
 *     parameters: z.object({ query: z.string() }),
 *     handler: async ({ query }) => runDescriptor(descriptor.id, query),
 *   })),
 * );
 * ```
 */
export function useFrontendTools(
  tools: ReadonlyArray<ReactFrontendTool<any>> | undefined,
  deps?: ReadonlyArray<unknown>,
) {
  const { copilotkit } = useCopilotKit();
  const toolList = tools ?? EMPTY_TOOLS;
  const extraDeps = deps ?? EMPTY_DEPS;

  // The array is usually built inline, so its identity changes on every render
  // and cannot be a dependency. Derive a value signature from the fields that
  // decide what the agent sees, so the effect re-runs when the set of tools
  // actually changes and not merely when the caller re-renders.
  //
  // `description` is in the signature even though useFrontendTool does not key
  // on it. A singular caller writes a literal description, so it never changes
  // without the component re-mounting. This hook exists to build tools from
  // data, where the description is usually derived from that data, and a
  // description the agent reads must not go stale while the names stay put.
  const signature = JSON.stringify(
    toolList.map((tool) => [
      tool.name,
      tool.description ?? null,
      tool.agentId ?? null,
      tool.available ?? null,
      tool.autopilot ?? null,
      tool.webmcp ?? null,
    ]),
  );

  useLayoutEffect(() => {
    // Collapse duplicate names so the last entry wins, which matches the
    // override behavior of useFrontendTool, and so the cleanup below removes
    // each (name, agentId) pair exactly once.
    const deduped = new Map<string, ReactFrontendTool<any>>();
    for (const tool of toolList) {
      const key = `${tool.agentId ?? ""}:${tool.name}`;
      if (deduped.has(key)) {
        console.warn(
          `Tool '${tool.name}' is listed more than once for agent '${tool.agentId || "global"}' in the same useFrontendTools call. Using the last entry.`,
        );
      }
      deduped.set(key, tool);
    }

    const registered = [...deduped.values()];

    for (const tool of registered) {
      // Always register/override the tool for this name on mount
      if (copilotkit.getTool({ toolName: tool.name, agentId: tool.agentId })) {
        console.warn(
          `Tool '${tool.name}' already exists for agent '${tool.agentId || "global"}'. Overriding with latest registration.`,
        );
        copilotkit.removeTool(tool.name, tool.agentId);
      }
      copilotkit.addTool(tool);

      // Register/override renderer by name and agentId through core.
      // The render function is registered even when tool.parameters is
      // undefined — tools like HITL confirm dialogs have no parameters
      // but still need their UI rendered in the chat.
      if (tool.render) {
        copilotkit.addHookRenderToolCall({
          name: tool.name,
          args: tool.parameters,
          agentId: tool.agentId,
          render: tool.render,
        });
      }
    }

    return () => {
      // Remove exactly what this run registered. Reading the current array here
      // would miss a tool that was dropped from it before the effect re-ran.
      for (const tool of registered) {
        copilotkit.removeTool(tool.name, tool.agentId);
      }
      // we are intentionally not removing the render here so that the tools can still render in the chat history
    };
    // `signature` is the value-based key for `toolList`, so the array itself is
    // deliberately not a dependency. `available` and `webmcp` are folded into
    // the signature for the same reasons they are dependencies of
    // useFrontendTool: toggling either must re-register the tool.
    //
    // `deps` is spread rather than stringified. JSON.stringify maps a function
    // to null, so a stringified `[navigate]` is the constant "[null]", and a
    // changed callback would never re-register. That is exactly the case `deps`
    // exists to cover. Spreading gives the entries React's own identity
    // comparison, the same contract as the second argument of useEffect. Pass a
    // deps array of a constant length, as React requires everywhere else.
  }, [signature, copilotkit, ...extraDeps]);
}
