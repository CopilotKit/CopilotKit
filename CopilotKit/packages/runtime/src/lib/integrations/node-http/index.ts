import { createYoga } from "graphql-yoga";
import { CreateCopilotRuntimeServerOptions, getCommonConfig } from "../shared";

export function copilotRuntimeNodeHttpEndpoint(options: CreateCopilotRuntimeServerOptions) {
  const commonConfig = getCommonConfig(options);
  const logger = commonConfig.logging;
  logger.debug("Creating Node HTTP endpoint");

  const yoga = createYoga({
    ...commonConfig,
    graphqlEndpoint: options.endpoint,
  });

  return yoga;
}
