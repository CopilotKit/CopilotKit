import { createYoga } from "graphql-yoga";
import { CreateCopilotRuntimeServerOptions, getCommonConfig } from "../shared";

export function copilotRuntimeNodeHttpEndpoint(
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

  const yoga = createYoga({
    ...getCommonConfig(runtimeOptions),
    graphqlEndpoint: graphqlOptions.endpoint,
  });

  return yoga;
}
