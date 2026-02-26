import { z } from "zod";
import type { ComponentType } from "react";
import { useFrontendTool } from "./use-frontend-tool";
import type {
  AgentId,
  ToolName,
  ToolParameters,
} from "../types/copilotkit-types";

/**
 * Resolves render props from the zod schema when provided,
 * otherwise falls back to the Register-derived parameter type for the tool name.
 */
type ResolveRenderProps<
  TSchema extends z.ZodTypeAny | undefined,
  TName extends string,
  A extends string | undefined,
> = TSchema extends z.ZodTypeAny ? z.infer<TSchema> : ToolParameters<TName, A>;

/**
 * Registers a React component as a frontend tool renderer in chat.
 *
 * This hook is a convenience wrapper around `useFrontendTool` that:
 * - builds a model-facing tool description,
 * - forwards optional Zod parameters,
 * - renders your component with tool call parameters.
 *
 * Use this when you want to display a typed visual component for a tool call
 * without manually wiring a full frontend tool object.
 *
 * When `parameters` is provided, render props are inferred from the schema
 * via `z.infer`. When omitted and Register is augmented, render props are
 * inferred from the tool's registered parameter type.
 *
 * @typeParam TName - Literal tool name string, inferred from `name`.
 * @typeParam TSchema - Zod schema describing tool parameters, or `undefined` when no schema is given.
 * @param config - Tool registration config.
 * @param deps - Optional dependencies to refresh registration (same semantics as `useEffect`).
 *
 * @example
 * ```tsx
 * // Without parameters — render props inferred from Register when augmented
 * useComponent({
 *   name: "showGreeting",
 *   render: ({ message }) => <div>{message}</div>,
 * });
 * ```
 *
 * @example
 * ```tsx
 * // With parameters — render props inferred from schema
 * useComponent({
 *   name: "showWeatherCard",
 *   parameters: z.object({ city: z.string() }),
 *   render: ({ city }) => <div>{city}</div>,
 * });
 * ```
 *
 * @example
 * ```tsx
 * useComponent(
 *   {
 *     name: "renderProfile",
 *     parameters: z.object({ userId: z.string() }),
 *     render: ProfileCard,
 *     agentId: "support-agent",
 *   },
 *   [selectedAgentId],
 * );
 * ```
 */
export function useComponent<
  TName extends ToolName<A extends string ? A : undefined> | (string & {}) =
    ToolName,
  A extends AgentId | undefined = AgentId | undefined,
  TSchema extends z.ZodTypeAny | undefined = undefined,
>(
  config: {
    name: TName;
    description?: string;
    parameters?: TSchema;
    render: ComponentType<
      NoInfer<
        ResolveRenderProps<TSchema, TName, A extends string ? A : undefined>
      >
    >;
    agentId?: A;
  },
  deps?: ReadonlyArray<unknown>,
): void {
  const prefix = `Use this tool to display the "${config.name}" component in the chat. This tool renders a visual UI component for the user.`;
  const fullDescription = config.description
    ? `${prefix}\n\n${config.description}`
    : prefix;

  useFrontendTool(
    {
      name: config.name,
      description: fullDescription,
      parameters: config.parameters,
      render: ({ args }: { args: unknown }) => {
        const Component = config.render;
        return (
          <Component
            {...(args as ResolveRenderProps<
              TSchema,
              TName,
              A extends string ? A : undefined
            >)}
          />
        );
      },
      agentId: config.agentId,
    },
    deps,
  );
}
