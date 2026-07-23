import { useEffect, useRef } from "react";
import { useFrontendTool } from "@copilotkit/react-core/v2/headless";
import type { StandardSchemaV1 } from "@copilotkit/shared";
import type { RenderToolFunction } from "./RenderToolContext";
import { useRenderToolContext } from "./RenderToolContext";

/**
 * Options for the useRenderTool hook.
 */
export interface UseRenderToolOptions<T extends Record<string, unknown>> {
  /** Unique name for the tool. Must match what the agent calls. */
  name: string;
  /** Human-readable description shown to the agent. */
  description: string;
  /**
   * Schema describing the tool's parameters.
   * Accepts any StandardSchemaV1-compatible schema (Zod, Valibot, ArkType, etc.).
   */
  parameters: StandardSchemaV1<unknown, T>;
  /**
   * Render function that returns a React Native element for the tool call.
   * Called by CopilotChat when it encounters a tool call message for this tool.
   *
   * Returns ReactElement | null (not ReactNode) because React Native's
   * FlatList cannot render strings or portals.
   */
  render: RenderToolFunction<T>;
  /**
   * Optional handler executed when the tool is called.
   * If omitted, the tool is render-only (the render function shows UI
   * but the tool returns no result to the agent).
   */
  handler?: (args: T) => Promise<unknown>;
  /**
   * Optional agent ID to scope this tool to a specific agent.
   */
  agentId?: string;
}

/**
 * Hook that registers a frontend tool AND a render function for it.
 *
 * This bridges `useFrontendTool` (which handles tool registration and
 * handler execution) with a render registry so that CopilotChat can
 * render React Native elements inline when it encounters tool call messages.
 *
 * @example
 * ```tsx
 * useRenderTool({
 *   name: "showWeather",
 *   description: "Display weather information",
 *   parameters: z.object({ city: z.string(), temp: z.number() }),
 *   render: ({ args, status }) => (
 *     <View>
 *       <Text>{args.city}: {args.temp}</Text>
 *       {status === "executing" && <ActivityIndicator />}
 *     </View>
 *   ),
 *   handler: async ({ city }) => {
 *     return { forecast: "sunny" };
 *   },
 * });
 * ```
 */
export function useRenderTool<
  T extends Record<string, unknown> = Record<string, unknown>,
>(options: UseRenderToolOptions<T>, deps?: ReadonlyArray<unknown>): void {
  const { name, description, parameters, render, handler, agentId } = options;
  const { register } = useRenderToolContext();

  // Register the tool with the core system via useFrontendTool
  useFrontendTool<T>(
    {
      name,
      description,
      parameters,
      handler,
      agentId,
    },
    deps,
  );

  // Use a ref so the effect cleanup always has the latest render function
  const renderRef = useRef(render);
  renderRef.current = render;

  // Register the render function in the RenderToolContext
  useEffect(() => {
    // Wrap in a stable function that delegates to the ref
    const stableRender: RenderToolFunction<T> = (props) =>
      renderRef.current(props);

    const unregister = register(name, stableRender as RenderToolFunction);
    return unregister;
  }, [name, register]);
}
