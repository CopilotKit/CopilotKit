import { z } from "zod";
import type { ComponentType } from "react";
import { useFrontendTool } from "./use-frontend-tool";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type InferRenderProps<T> = T extends z.ZodTypeAny ? z.infer<T> : any;

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
 * via `z.infer`. When omitted, the render component may accept any props.
 *
 * @typeParam TSchema - Zod schema describing tool parameters, or `undefined` when no schema is given.
 * @param config - Tool registration config.
 * @param deps - Optional dependencies to refresh registration (same semantics as `useEffect`).
 *
 * @example
 * ```tsx
 * // Without parameters — render accepts any props
 * useComponent({
 *   name: "showGreeting",
 *   render: ({ message }: { message: string }) => <div>{message}</div>,
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
  TSchema extends z.ZodTypeAny | undefined = undefined,
>(
  config: {
    name: string;
    description?: string;
    parameters?: TSchema;
    render: ComponentType<NoInfer<InferRenderProps<TSchema>>>;
    agentId?: string;
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
        return <Component {...(args as InferRenderProps<TSchema>)} />;
      },
      agentId: config.agentId,
    },
    deps,
  );
}
