import type { StandardSchemaV1, InferSchemaOutput } from "@copilotkit/shared";
import { Component as ReactComponent } from "react";
import type { ComponentType, ReactNode } from "react";
import { useFrontendTool } from "./use-frontend-tool";

type InferRenderProps<T> = T extends StandardSchemaV1
  ? InferSchemaOutput<T>
  : any;

/**
 * Where the tool call is. While it is `"inProgress"` the arguments are still
 * streaming, so the props hold partly parsed JSON and any field can be missing.
 */
export type ComponentToolCallStatus = "inProgress" | "executing" | "complete";

/** Props `useComponent` adds next to the tool call arguments. */
export interface ComponentToolCallProps {
  /**
   * The status of the tool call. A tool parameter with the same name takes
   * precedence, so existing components keep their props.
   */
  toolCallStatus?: ComponentToolCallStatus;
}

interface BoundaryProps {
  args: unknown;
  status: unknown;
  children: ReactNode;
}

interface BoundaryState {
  error: unknown;
  args: unknown;
  status: unknown;
}

/**
 * Catches an error thrown while rendering the component, so a component that
 * reads a field that has not streamed yet renders nothing instead of
 * unmounting the chat and the host app. It tries again when new arguments or
 * a new status arrive, so the component appears once the props are complete.
 * React still reports the caught error to the console.
 */
class ComponentRenderBoundary extends ReactComponent<
  BoundaryProps,
  BoundaryState
> {
  state: BoundaryState = {
    error: null,
    args: this.props.args,
    status: this.props.status,
  };

  static getDerivedStateFromError(error: unknown) {
    return { error: error ?? new Error("Component render failed") };
  }

  static getDerivedStateFromProps(
    props: BoundaryProps,
    state: BoundaryState,
  ): Partial<BoundaryState> | null {
    return props.args !== state.args || props.status !== state.status
      ? { error: null, args: props.args, status: props.status }
      : null;
  }

  render() {
    return this.state.error ? null : this.props.children;
  }
}

/**
 * Registers a React component as a frontend tool renderer in chat.
 *
 * This hook is a convenience wrapper around `useFrontendTool` that:
 * - builds a model-facing tool description,
 * - forwards optional schema parameters (any Standard Schema V1 compatible library),
 * - renders your component with tool call parameters,
 * - adds a `toolCallStatus` prop (`"inProgress"`, `"executing"` or `"complete"`),
 * - renders nothing if the component throws, instead of unmounting the app.
 *
 * The component renders while the tool call streams. Until `toolCallStatus`
 * is `"complete"`, the props are partly parsed arguments: any field, nested
 * ones included, can be missing. Check the status or read fields as optional.
 *
 * Use this when you want to display a typed visual component for a tool call
 * without manually wiring a full frontend tool object.
 *
 * When `parameters` is provided, render props are inferred from the schema.
 * When omitted, the render component may accept any props.
 *
 * @typeParam TSchema - Schema describing tool parameters, or `undefined` when no schema is given.
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
 *   render: ({ city, toolCallStatus }) =>
 *     toolCallStatus === "complete" ? <div>{city}</div> : <div>Loading…</div>,
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
  TSchema extends StandardSchemaV1<any, Record<string, unknown>> | undefined =
    undefined,
>(
  config: {
    name: string;
    description?: string;
    parameters?: TSchema;
    render: ComponentType<
      NoInfer<InferRenderProps<TSchema>> & ComponentToolCallProps
    >;
    agentId?: string;
    followUp?: boolean;
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
      render: ({ args, status }) => {
        const Component = config.render;
        // The status goes first so a tool parameter of the same name wins.
        return (
          <ComponentRenderBoundary args={args} status={status}>
            <Component
              toolCallStatus={status as ComponentToolCallStatus}
              {...(args as InferRenderProps<TSchema>)}
            />
          </ComponentRenderBoundary>
        );
      },
      agentId: config.agentId,
      followUp: config.followUp,
    },
    deps,
  );
}
