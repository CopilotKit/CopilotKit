import { createYoga } from "graphql-yoga";
import { CreateCopilotRuntimeServerOptions, getCommonConfig } from "../shared";

export function copilotRuntimeNodeHttpEndpoint({
  runtime,
  endpoint,
  baseUrl,
  serviceAdapter,
  cloud,
}: CreateCopilotRuntimeServerOptions) {
  const commonConfig = getCommonConfig({ runtime, endpoint, baseUrl, serviceAdapter, cloud });

  const yoga = createYoga({
    ...commonConfig,
    graphqlEndpoint: endpoint,
  });

  return yoga;
}
