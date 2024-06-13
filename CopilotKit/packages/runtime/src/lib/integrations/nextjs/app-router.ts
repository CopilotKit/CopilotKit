import { createYoga } from "graphql-yoga";
import { CreateCopilotRuntimeServerOptions, getCommonConfig } from "../shared";

export function copilotRuntimeNextJSAppRouterEndpoint(
  options: CreateCopilotRuntimeServerOptions & {
    graphql: {
      endpoint: string;
    };
  },
) {
  const graphqlOptions = options.graphql;
  const runtimeOptions = {
    ...options,
    graphql: undefined,
  };

  const { handleRequest } = createYoga({
    ...getCommonConfig(runtimeOptions),
    graphqlEndpoint: graphqlOptions.endpoint,
    fetchAPI: { Response: globalThis.Response },
  });

  return {
    GET: handleRequest,
    POST: handleRequest,
    OPTIONS: handleRequest,
  };
}
