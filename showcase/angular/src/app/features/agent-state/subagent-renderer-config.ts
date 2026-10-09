import type { RenderToolCallConfig } from "@copilotkit/angular";
import { z } from "zod";

import { SubAgentActivityCard } from "./agent-state-cards";
import type { SubAgentName } from "./agent-state-model";

/**
 * Build a route-lifetime subagent renderer that also matches runtimes whose
 * assistant messages do not carry an agent identifier.
 */
export function subAgentRendererConfig(
  name: SubAgentName,
): RenderToolCallConfig<{ task: string }> {
  return {
    name,
    args: z.object({ task: z.string() }),
    component: SubAgentActivityCard as unknown as RenderToolCallConfig<{
      task: string;
    }>["component"],
  };
}
