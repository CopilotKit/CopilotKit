import React from "react";
import type { ComponentType } from "react";
import type { StandardSchemaV1 } from "@copilotkit/shared";
import { useRenderTool } from "./useRenderTool";

/**
 * Register a component the agent can choose to display — the controlled generative-UI primitive,
 * for React Native.
 *
 * `@copilotkit/react-core` has a `useComponent` of the same shape, but it registers into react-core's
 * own render registry, which this package's renderers do not read. On React Native that meant a
 * component registered with it rendered nowhere: not in `CopilotChat`, and not on a custom surface.
 * This version registers into THIS package's registry, so one registration renders in the chat and
 * anywhere you call `useRenderToolCall()`.
 *
 * Like react-core's, it is render-only: there is no handler, because displaying the component IS the
 * effect. Props are the tool arguments, spread directly, so a component can be used as-is.
 *
 * Arguments stream, so props may be INCOMPLETE on early renders (see `RenderToolProps.args`). Write
 * components that tolerate missing fields — that is what lets UI build as the agent writes it.
 *
 * @example
 * ```tsx
 * useComponent({
 *   name: "showWeatherCard",
 *   description: "Show the weather for a city.",
 *   parameters: z.object({ city: z.string() }),
 *   render: ({ city }) => <Text>{city}</Text>,
 * });
 * ```
 */
export function useComponent<
  TSchema extends StandardSchemaV1<unknown, Record<string, unknown>>,
>(
  config: {
    /** Tool name the agent calls. */
    name: string;
    /** What this component shows, and when the agent should choose it. */
    description?: string;
    /** Schema for the component's props. */
    parameters: TSchema;
    /** The component to render. Receives the tool arguments as props. */
    render: ComponentType<any>;
    /** Scope to a single agent. */
    agentId?: string;
  },
  deps?: ReadonlyArray<unknown>,
): void {
  const prefix = `Use this tool to display the "${config.name}" component to the user. This tool renders a visual UI component.`;
  const description = config.description
    ? `${prefix}\n\n${config.description}`
    : prefix;

  const Component = config.render;

  useRenderTool(
    {
      name: config.name,
      description,
      parameters: config.parameters,
      // Props are the arguments, spread — the component needs no knowledge of CopilotKit.
      render: ({ args }) => (
        <Component {...(args as Record<string, unknown>)} />
      ),
      agentId: config.agentId,
    },
    deps,
  );
}
