import { useEffect } from "react";
import type { StandardSchemaV1, InferSchemaOutput } from "@copilotkit/shared";
import { useCopilotKit } from "../providers/CopilotKitProvider";
import { defineToolCallRenderer } from "../types/defineToolCallRenderer";

const EMPTY_DEPS: ReadonlyArray<unknown> = [];

export interface RenderToolInProgressProps<S extends StandardSchemaV1> {
  name: string;
  toolCallId: string;
  parameters: Partial<InferSchemaOutput<S>>;
  status: "inProgress";
  result: undefined;
}

export interface RenderToolExecutingProps<S extends StandardSchemaV1> {
  name: string;
  toolCallId: string;
  parameters: InferSchemaOutput<S>;
  status: "executing";
  result: undefined;
}

export interface RenderToolCompleteProps<S extends StandardSchemaV1> {
  name: string;
  toolCallId: string;
  parameters: InferSchemaOutput<S>;
  status: "complete";
  result: string;
}

export type RenderToolProps<S extends StandardSchemaV1> =
  | RenderToolInProgressProps<S>
  | RenderToolExecutingProps<S>
  | RenderToolCompleteProps<S>;

type RenderToolConfig<S extends StandardSchemaV1> = {
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
 * The provided `parameters` schema defines the typed shape of `props.parameters`
 * in `render` for `executing` and `complete` states. Accepts any Standard Schema V1
 * compatible library (Zod, Valibot, ArkType, etc.).
 *
 * @typeParam S - Schema type describing tool call parameters.
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
export function useRenderTool<S extends StandardSchemaV1>(
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
 * @typeParam S - Schema type describing tool call parameters.
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
export function useRenderTool<S extends StandardSchemaV1>(
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

    copilotkit.addHookRenderToolCall(renderer);

    // No cleanup removal — keeps renderer for chat history, same as useFrontendTool
  }, [config.name, copilotkit, extraDeps.length, ...extraDeps]);
}
