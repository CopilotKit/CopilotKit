// 1.x code on the 2.0 runtime: it imports from the deprecated `/v2`
// subpaths, by the 1.x names, from ESM.
import {
  BuiltInAgent,
  CopilotRuntime,
  createCopilotRuntimeHandler,
  defineTool,
} from "@copilotkit/runtime/v2";
import type {
  AgentsConfig,
  CopilotCorsConfig,
  CopilotRuntimeFetchHandler,
  CopilotRuntimeOptions,
} from "@copilotkit/runtime/v2";
import {
  createCopilotNodeHandler,
  createCopilotNodeListener,
  createNodeFetchHandler,
} from "@copilotkit/runtime/v2/node";
import type { NodeCopilotListener } from "@copilotkit/runtime/v2/node";
import type { CopilotKitRuntime } from "@copilotkit/runtime";
import type {
  BuiltInAgent as AgentEntryBuiltInAgent,
  defineTool as agentEntryDefineTool,
} from "@copilotkit/runtime/agent";

/** `Omit` over each member of a union, as @ag-ui/mastra 2.0.2 declares it. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/**
 * What `registerCopilotKit` of @ag-ui/mastra 2.0.2 does with the five names
 * that it imports from `@copilotkit/runtime/v2`.
 */
export function register({
  path,
  agents,
  cors,
  ...runtimeOptions
}: {
  path: string;
  cors?: boolean | CopilotCorsConfig;
} & DistributiveOmit<CopilotRuntimeOptions, "agents"> & {
    agents: AgentsConfig;
  }): CopilotRuntimeFetchHandler {
  return createCopilotRuntimeHandler({
    runtime: new CopilotRuntime({ ...runtimeOptions, agents }),
    basePath: path,
    cors,
    mode: "single-route",
  });
}

/** A runtime built with the 1.x name is the 2.0 runtime of the root. */
export const runtime: CopilotKitRuntime = new CopilotRuntime({ agents: {} });

export const listener: NodeCopilotListener = createCopilotNodeListener({
  runtime,
  basePath: "/api/copilotkit",
});
export const handlers = [
  createCopilotNodeHandler(createCopilotRuntimeHandler({ runtime })),
  createNodeFetchHandler(createCopilotRuntimeHandler({ runtime })),
];

// `/v2` exports the Built-in Agent of `@copilotkit/runtime/agent`.
export const sameAgent: typeof AgentEntryBuiltInAgent = BuiltInAgent;
export const sameDefineTool: typeof agentEntryDefineTool = defineTool;
