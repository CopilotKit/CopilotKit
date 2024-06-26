import { YogaServerInstance, createYoga } from "graphql-yoga";
import { CreateCopilotRuntimeServerOptions, GraphQLContext, getCommonConfig } from "../shared";

export const config = {
  api: {
    bodyParser: false,
  },
};

export type CopilotRuntimeServerInstance<T> = YogaServerInstance<T, Partial<GraphQLContext>>;

// Theis import is needed to fix the type error
// Fix is currently in TypeScript 5.5 beta, waiting for stable version
// https://github.com/microsoft/TypeScript/issues/42873#issuecomment-2066874644
export type {} from "@whatwg-node/server";

export function copilotRuntimeNextJSPagesRouterEndpoint(
  {
    runtime,
    endpoint,
    baseUrl,
    serviceAdapter,
    cloud,
  }: CreateCopilotRuntimeServerOptions
): CopilotRuntimeServerInstance<GraphQLContext> {
  const commonConfig = getCommonConfig({ runtime, endpoint, baseUrl, serviceAdapter, cloud });

  const yoga = createYoga({
    ...commonConfig,
    graphqlEndpoint: endpoint,
  });

  return yoga;
}
