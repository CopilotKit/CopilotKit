import { YogaInitialContext } from "graphql-yoga";
import { GuardrailsOptions } from "../guardrails";
import { buildSchemaSync } from "type-graphql";
import { CopilotResolver } from "../../graphql/resolvers/copilot.resolver";
import { useDeferStream } from "@graphql-yoga/plugin-defer-stream";
import { CopilotRuntime } from "../copilot-runtime";
import { CopilotServiceAdapter } from "../../service-adapters";

type AnyPrimitive = string | boolean | number | null;
export type CopilotRequestContextProperties = Record<
  string,
  AnyPrimitive | Record<string, AnyPrimitive>
>;

type CopilotKitContext = {
  runtime: CopilotRuntime;
  serviceAdapter: CopilotServiceAdapter;
  properties: CopilotRequestContextProperties;
};

export type GraphQLContext = YogaInitialContext & {
  _copilotkit: CopilotKitContext;
};

export interface CreateCopilotRuntimeServerOptions {
  runtime: CopilotRuntime;
  serviceAdapter: CopilotServiceAdapter;
  guardrails?: GuardrailsOptions;
}

export async function createContext(
  initialContext: YogaInitialContext,
  copilotKitContext: CopilotKitContext,
): Promise<Partial<GraphQLContext>> {
  const ctx: GraphQLContext = {
    ...initialContext,
    _copilotkit: {
      ...copilotKitContext,
    },
  };

  return ctx;
}

export function buildSchema(
  options: {
    emitSchemaFile?: string;
  } = {},
) {
  const schema = buildSchemaSync({
    resolvers: [CopilotResolver],
    emitSchemaFile: options.emitSchemaFile,
  });
  return schema;
}

export function getCommonConfig(options?: CreateCopilotRuntimeServerOptions) {
  return {
    schema: buildSchema(),
    plugins: [useDeferStream()],
    context: (ctx: YogaInitialContext): Promise<Partial<GraphQLContext>> =>
      createContext(ctx, {
        runtime: options.runtime,
        serviceAdapter: options.serviceAdapter,
        properties: {},
      }),
  };
}
