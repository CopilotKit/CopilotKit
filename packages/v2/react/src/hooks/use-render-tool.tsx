import { useEffect } from "react";
import type { z } from "zod";
import { useCopilotKit } from "../providers/CopilotKitProvider";
import { defineToolCallRenderer } from "../types/defineToolCallRenderer";
import type { ReactToolCallRenderer } from "../types/react-tool-call-renderer";

const EMPTY_DEPS: ReadonlyArray<unknown> = [];

export interface RenderToolInProgressProps<S extends z.ZodTypeAny> {
  name: string;
  parameters: Partial<z.infer<S>>;
  status: "inProgress";
  result: undefined;
}

export interface RenderToolExecutingProps<S extends z.ZodTypeAny> {
  name: string;
  parameters: z.infer<S>;
  status: "executing";
  result: undefined;
}

export interface RenderToolCompleteProps<S extends z.ZodTypeAny> {
  name: string;
  parameters: z.infer<S>;
  status: "complete";
  result: string;
}

export type RenderToolProps<S extends z.ZodTypeAny> =
  | RenderToolInProgressProps<S>
  | RenderToolExecutingProps<S>
  | RenderToolCompleteProps<S>;

type RenderToolConfig<S extends z.ZodTypeAny> = {
  name: string;
  parameters?: S;
  render: (props: RenderToolProps<S>) => React.ReactElement;
  agentId?: string;
};

/**
 * Registers a wildcard (`"*"`) renderer for tool calls.
 *
 * The wildcard renderer is used as a fallback when no exact name-matched
 * renderer is registered for a tool call.
 *
 * @param config - Wildcard renderer configuration.
 * @param deps - Optional dependencies to refresh registration.
 *
 * @example
 * ```tsx
 * useRenderTool(
 *   {
 *     name: "*",
 *     render: ({ name, status }) => (
 *       <div>
 *         {status === "complete" ? "✓" : "⏳"} {name}
 *       </div>
 *     ),
 *   },
 *   [],
 * );
 * ```
 */
export function useRenderTool(
  config: {
    name: "*";
    render: (props: any) => React.ReactElement;
    agentId?: string;
  },
  deps?: ReadonlyArray<unknown>,
): void;

/**
 * Registers a name-scoped renderer for tool calls.
 *
 * The provided `parameters` Zod schema defines the typed shape of `props.parameters`
 * in `render` for `executing` and `complete` states.
 *
 * @typeParam S - Zod schema type describing tool call parameters.
 * @param config - Named renderer configuration.
 * @param deps - Optional dependencies to refresh registration.
 *
 * @example
 * ```tsx
 * useRenderTool(
 *   {
 *     name: "searchDocs",
 *     parameters: z.object({ query: z.string() }),
 *     render: ({ status, parameters, result }) => {
 *       if (status === "inProgress") return <div>Preparing...</div>;
 *       if (status === "executing") return <div>Searching {parameters.query}</div>;
 *       return <div>{result}</div>;
 *     },
 *   },
 *   [],
 * );
 * ```
 */
export function useRenderTool<S extends z.ZodTypeAny>(
  config: {
    name: string;
    parameters: S;
    render: (props: RenderToolProps<S>) => React.ReactElement;
    agentId?: string;
  },
  deps?: ReadonlyArray<unknown>,
): void;

/**
 * Registers a renderer entry in CopilotKit's `renderToolCalls` registry.
 *
 * Key behavior:
 * - deduplicates by `agentId:name` (latest registration wins),
 * - keeps renderer entries on cleanup so historical chat tool calls can still render,
 * - refreshes registration when `deps` change.
 *
 * @typeParam S - Zod schema type describing tool call parameters.
 * @param config - Renderer config for wildcard or named tools.
 * @param deps - Optional dependencies to refresh registration.
 *
 * @example
 * ```tsx
 * useRenderTool(
 *   {
 *     name: "searchDocs",
 *     parameters: z.object({ query: z.string() }),
 *     render: ({ status, parameters, result }) => {
 *       if (status === "executing") return <div>Searching {parameters.query}</div>;
 *       if (status === "complete") return <div>{result}</div>;
 *       return <div>Preparing...</div>;
 *     },
 *   },
 *   [],
 * );
 * ```
 *
 * @example
 * ```tsx
 * useRenderTool(
 *   {
 *     name: "summarize",
 *     parameters: z.object({ text: z.string() }),
 *     agentId: "research-agent",
 *     render: ({ name, status }) => <div>{name}: {status}</div>,
 *   },
 *   [selectedAgentId],
 * );
 * ```
 */
export function useRenderTool<S extends z.ZodTypeAny>(
  config: RenderToolConfig<S>,
  deps?: ReadonlyArray<unknown>,
): void {
  const { copilotkit } = useCopilotKit();
  const extraDeps = deps ?? EMPTY_DEPS;

  useEffect(() => {
    // Build the ReactToolCallRenderer via defineToolCallRenderer
    const renderer =
      config.name === "*" && !config.parameters
        ? defineToolCallRenderer({
            name: "*",
            render: (props) =>
              config.render({ ...props, parameters: props.args }),
            ...(config.agentId ? { agentId: config.agentId } : {}),
          })
        : defineToolCallRenderer({
            name: config.name,
            args: config.parameters!,
            render: (props) =>
              config.render({ ...props, parameters: props.args }),
            ...(config.agentId ? { agentId: config.agentId } : {}),
          });

    // Dedupe by "agentId:name" key, same pattern as useFrontendTool
    const keyOf = (rc: ReactToolCallRenderer) =>
      `${rc.agentId ?? ""}:${rc.name}`;
    const currentRenderToolCalls =
      copilotkit.renderToolCalls as ReactToolCallRenderer[];

    const mergedMap = new Map<string, ReactToolCallRenderer>();
    for (const rc of currentRenderToolCalls) {
      mergedMap.set(keyOf(rc), rc);
    }

    mergedMap.set(keyOf(renderer), renderer);

    copilotkit.setRenderToolCalls(Array.from(mergedMap.values()));

    // No cleanup removal — keeps renderer for chat history, same as useFrontendTool
  }, [config.name, copilotkit, extraDeps.length, ...extraDeps]);
}
