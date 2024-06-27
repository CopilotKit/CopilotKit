import { YogaServerInstance, createYoga } from "graphql-yoga";
import { CreateCopilotRuntimeServerOptions, GraphQLContext, getCommonConfig } from "../shared";

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

export function copilotRuntimeNextJSPagesRouterEndpoint(
  options: CreateCopilotRuntimeServerOptions,
): CopilotRuntimeServerInstance<GraphQLContext> {
  const commonConfig = getCommonConfig(options);
  const logger = commonConfig.logging;
  logger.debug("Creating NextJS Pages Router endpoint");

  const yoga = createYoga({
    ...commonConfig,
    graphqlEndpoint: options.endpoint,
  });

  return yoga;
}
