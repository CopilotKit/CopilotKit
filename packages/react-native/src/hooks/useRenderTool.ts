import { useFrontendTool } from "@copilotkit/react-core/v2/headless";
import type { StandardSchemaV1 } from "@copilotkit/shared";
import type { RenderToolFunction } from "./render-tool-types";

/**
 * Options for the useRenderTool hook.
 */
export interface UseRenderToolOptions<T extends Record<string, unknown>> {
  /** Unique name for the tool. Must match what the agent calls. */
  name: string;
  /** Human-readable description shown to the agent. */
  description: string;
  /** Schema describing the tool's parameters (any StandardSchemaV1 library). */
  parameters: StandardSchemaV1<unknown, T>;
  /**
   * Render function returning a React Native element for the tool call.
   * Rendered by `CopilotChat` inline, and by `useRenderToolCall()` anywhere else.
   *
   * Arguments STREAM: on `status: "inProgress"` the props are partial, because
   * the model has not finished writing the JSON. Write renderers that tolerate
   * missing fields — that is what makes UI build progressively.
   */
  render: RenderToolFunction<T>;
  /** Optional handler. Omit for render-only (display IS the effect). */
  handler?: (args: T) => Promise<unknown>;
  /** Scope this tool to a single agent. */
  agentId?: string;
}

/**
 * Registers a frontend tool AND its renderer.
 *
 * Registration goes through react-core's `useFrontendTool`, which writes the
 * renderer into `CopilotKitCoreReact.renderToolCalls` — the canonical registry
 * that RN's provider already instantiates. There is deliberately NO React
 * Native-local registry: this package previously kept its own Map, which meant
 * `useComponent` (registering into core's) rendered nowhere on RN, and renderers
 * were dropped from chat history on unmount.
 */
export function useRenderTool<
  T extends Record<string, unknown> = Record<string, unknown>,
>(options: UseRenderToolOptions<T>, deps?: ReadonlyArray<unknown>): void {
  const { name, description, parameters, render, handler, agentId } = options;

  useFrontendTool<T>(
    {
      name,
      description,
      parameters,
      handler,
      agentId,
      // No cast needed: ReactFrontendTool.render is ReactToolCallRenderer<T>["render"],
      // and RenderToolFunction is derived from exactly that props type, returning
      // ReactElement | null (assignable to ComponentType's ReactNode).
      render,
    },
    deps,
  );
}

export type { RenderToolProps, RenderToolFunction } from "./render-tool-types";
