import { z } from "zod";
import React from "react";
import { useFrontendTool } from "./use-frontend-tool";

export function useFrontendComponent<
  T extends Record<string, unknown> = Record<string, unknown>,
>(
  config: {
    name: string;
    description?: string;
    parameters?: z.ZodType<T>;
    component: React.ComponentType<T>;
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
