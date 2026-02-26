import { useEffect } from "react";
import type { z } from "zod";
import { useCopilotKit } from "../providers/CopilotKitProvider";
import { defineToolCallRenderer } from "../types/defineToolCallRenderer";
import type { ReactToolCallRenderer } from "../types/react-tool-call-renderer";
import type {
  AgentId,
  ToolName,
  ToolParameters,
} from "../types/copilotkit-types";

const EMPTY_DEPS: ReadonlyArray<unknown> = [];

// ── Render-prop types ────────────────────────────────────────────────

export interface RenderToolInProgressProps<T = Record<string, unknown>> {
  name: string;
  parameters: Partial<T>;
  status: "inProgress";
  result: undefined;
}

export interface RenderToolExecutingProps<T = Record<string, unknown>> {
  name: string;
  parameters: T;
  status: "executing";
  result: undefined;
}

export interface RenderToolCompleteProps<T = Record<string, unknown>> {
  name: string;
  parameters: T;
  status: "complete";
  result: string;
}

export type RenderToolProps<T = Record<string, unknown>> =
  | RenderToolInProgressProps<T>
  | RenderToolExecutingProps<T>
  | RenderToolCompleteProps<T>;

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Resolves the parameter type for render props:
 * - Wildcard (`"*"`) + agent: union of that agent's tool parameter types
 * - Wildcard (`"*"`) + no agent: union of ALL tool parameter types
 * - Named tool with zod schema: `z.infer<TSchema>`
 * - Named tool without schema: `ToolParameters<TName, A>` (from Register)
 */
type ResolveParams<
  TName extends string,
  TSchema extends z.ZodTypeAny | undefined,
  A extends string | undefined,
> = TName extends "*"
  ? ToolParameters<ToolName<A>, A>
  : TSchema extends z.ZodTypeAny
    ? z.infer<TSchema>
    : ToolParameters<TName, A>;

/**
 * Registers a renderer for tool calls in CopilotKit's `renderToolCalls` registry.
 *
 * Supports both **named** tools and the **wildcard** (`"*"`) fallback.
 * When a Zod `parameters` schema is provided, `props.parameters` in the
 * `render` callback is inferred from the schema. When omitted and Register is
 * augmented, parameters are inferred from the tool's registered type.
 * For the wildcard case, parameters are `Record<string, unknown>`.
 *
 * Key behavior:
 * - deduplicates by `agentId:name` (latest registration wins),
 * - keeps renderer entries on cleanup so historical chat tool calls can still render,
 * - refreshes registration when `deps` change.
 *
 * @typeParam TName - Literal tool name string (or `"*"`), inferred from `name`.
 * @typeParam A - Agent ID, inferred from `agentId`.
 * @typeParam TSchema - Zod schema type, inferred from `parameters`.
 * @param config - Renderer configuration.
 * @param deps - Optional dependencies to refresh registration.
 *
 * @example
 * ```tsx
 * // Wildcard — fallback renderer for any tool call without a specific renderer
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
 *
 * @example
 * ```tsx
 * // Named tool with Zod schema — parameters inferred from schema
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
 *
 * @example
 * ```tsx
 * // Named tool without schema — parameters inferred from Register when augmented
 * useRenderTool(
 *   {
 *     name: "getWeather",
 *     render: ({ status, parameters }) => {
 *       if (status === "inProgress") return <div>Loading weather...</div>;
 *       return <div>Weather for {parameters.city}</div>;
 *     },
 *   },
 *   [],
 * );
 * ```
 *
 * @example
 * ```tsx
 * // Agent-scoped renderer
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
export function useRenderTool<
  TName extends ToolName<A extends string ? A : undefined> | "*" =
    | ToolName
    | "*",
  A extends AgentId | undefined = AgentId | undefined,
  TSchema extends z.ZodTypeAny | undefined = undefined,
>(
  config: {
    name: TName;
    parameters?: TSchema;
    render: (
      props: RenderToolProps<
        NoInfer<ResolveParams<TName, TSchema, A extends string ? A : undefined>>
      >,
    ) => React.ReactElement;
    agentId?: A;
  },
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
