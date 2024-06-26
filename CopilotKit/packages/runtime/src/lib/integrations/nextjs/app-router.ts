import { createYoga } from "graphql-yoga";
import { CreateCopilotRuntimeServerOptions, getCommonConfig } from "../shared";

export function copilotRuntimeNextJSAppRouterEndpoint({
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
    fetchAPI: { Response: globalThis.Response },
  });

  return {
    handleRequest: yoga,
    GET: yoga,
    POST: yoga,
    OPTIONS: yoga,
  };
}
