import { YogaServerInstance, createYoga } from "graphql-yoga";
import { GraphQLContext, getCommonConfig } from "../shared";
import { CopilotRuntime } from "../../copilot-runtime";
import { CopilotServiceAdapter } from "../../../service-adapters";

export const config = {
  api: {
    bodyParser: false,
  },
};

export type CopilotRuntimeServerInstance<T> = YogaServerInstance<T, Partial<GraphQLContext>>;

// This import is needed to fix the type error
// Fix is currently in TypeScript 5.5 beta, waiting for stable version
// https://github.com/microsoft/TypeScript/issues/42873#issuecomment-2066874644
export type {} from "@whatwg-node/server";

export function copilotRuntimeNextJSPagesRouterEndpoint({
  runtime,
  endpoint,
  serviceAdapter,
  debug,
}: {
  runtime: CopilotRuntime;
  serviceAdapter: CopilotServiceAdapter;
  endpoint: string;
  debug?: boolean;
}): CopilotRuntimeServerInstance<GraphQLContext> {
  const commonConfig = getCommonConfig({ runtime, serviceAdapter, debug });

  const yoga = createYoga({
    ...commonConfig,
    graphqlEndpoint: endpoint,
  });

  return yoga;
}
