import { YogaServerInstance, createYoga } from "graphql-yoga";
import { CreateCopilotRuntimeServerOptions, GraphQLContext, getCommonConfig } from "../shared";

export const config = {
  api: {
    bodyParser: false,
  },
};

export type CopilotRuntimeServerInstance<T> = YogaServerInstance<T, Partial<GraphQLContext>>;

export function copilotRuntimeNextJSPagesRouterEndpoint<T>(
  options: CreateCopilotRuntimeServerOptions & {
    graphql: {
      endpoint: string;
    };
  },
): CopilotRuntimeServerInstance<T> {
  const graphqlOptions = options.graphql;
  const runtimeOptions = {
    ...options,
    graphql: undefined,
  };

  return createYoga<T, Partial<GraphQLContext>>({
    ...getCommonConfig(runtimeOptions),
    graphqlEndpoint: graphqlOptions.endpoint,
  });
}
