import { z } from "zod";
import type { ComponentType } from "react";
import { useFrontendTool } from "./use-frontend-tool";

/**
 * Registers a React component as a frontend tool renderer in chat.
 *
 * This hook is a convenience wrapper around `useFrontendTool` that:
 * - builds a model-facing tool description,
 * - forwards optional Zod parameters,
 * - renders your component with tool call args.
 *
 * Use this when you want to display a typed visual component for a tool call
 * without manually wiring a full frontend tool object.
 *
 * @typeParam T - Shape of tool args expected by the component.
 * @param config - Tool registration config.
 * @param deps - Optional dependencies to refresh registration (same semantics as `useEffect`).
 *
 * @example
 * ```tsx
 * useComponent({
 *   name: "showWeatherCard",
 *   parameters: z.object({ city: z.string() }),
 *   component: ({ city }: { city: string }) => <div>{city}</div>,
 * });
 * ```
 *
 * @example
 * ```tsx
 * useComponent(
 *   {
 *     name: "renderProfile",
 *     parameters: z.object({ userId: z.string() }),
 *     component: ProfileCard,
 *     agentId: "support-agent",
 *   },
 *   [selectedAgentId],
 * );
 * ```
 */
export function useComponent<
  T extends Record<string, unknown> = Record<string, unknown>,
>(
  config: {
    name: string;
    description?: string;
    parameters?: z.ZodType<T>;
    component: ComponentType<T>;
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
      render: ({ args }) => {
        const Component = config.component;
        return <Component {...(args as T)} />;
      },
      agentId: config.agentId,
    },
    deps,
  );
}
