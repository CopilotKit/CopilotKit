import { YogaInitialContext } from "graphql-yoga";
import { GuardrailsOptions } from "../guardrails";
import { buildSchemaSync } from "type-graphql";
import { GeneratedResponseResolver } from "../../graphql/resolvers/generated-response.resolver";
import { useDeferStream } from "@graphql-yoga/plugin-defer-stream";

export type GraphQLContext = YogaInitialContext & {
  runtimeServerOptions: CreateCopilotRuntimeServerOptions;
};

export interface CreateCopilotRuntimeServerOptions {
  authorize?: (ctx: YogaInitialContext) => Promise<void>;
  guardrails?: GuardrailsOptions;
}

export async function createContext(
  initialContext: YogaInitialContext,
  serverOptions: CreateCopilotRuntimeServerOptions = {},
): Promise<Partial<GraphQLContext>> {
  const ctx: GraphQLContext = {
    ...initialContext,
    runtimeServerOptions: serverOptions,
  };

  if (serverOptions?.authorize) {
    await serverOptions.authorize(ctx);
  }

  return ctx;
}

export function getCommonConfig(runtimeOptions?: CreateCopilotRuntimeServerOptions) {
  const schema = buildSchemaSync({
    resolvers: [GeneratedResponseResolver],
  });

  return {
    schema,
    plugins: [useDeferStream()],
    context: (ctx: YogaInitialContext): Promise<Partial<GraphQLContext>> => createContext(ctx, runtimeOptions),
  };
}