import "reflect-metadata";

import { createYoga, YogaInitialContext } from "graphql-yoga";
import { createServer } from "node:http";
import { buildSchema } from "type-graphql";
import { GeneratedResponseResolver } from "../graphql/resolvers/generated-response.resolver";
import { useDeferStream } from "@graphql-yoga/plugin-defer-stream";

export type GraphQLContext = YogaInitialContext & {
  runtimeServerOptions: CreateCopilotRuntimeServerOptions;
};

export interface GuardrailsOptions {
  baseUrl: string;
}

export interface CreateCopilotRuntimeServerOptions {
  authorize?: (ctx: YogaInitialContext) => Promise<void>;
  guardrails?: GuardrailsOptions;
}

export async function createContext(
  initialContext: YogaInitialContext,
  serverOptions: CreateCopilotRuntimeServerOptions
): Promise<Partial<GraphQLContext>> {
  console.debug(`[DEBUG] incoming request`);

  const ctx: GraphQLContext = {
    ...initialContext,
    runtimeServerOptions: serverOptions,
  };

  if (serverOptions?.authorize) {
    console.debug(`[DEBUG] authorize function provided, authorizing`);
    await serverOptions.authorize(ctx);
  }

  return ctx;
}

async function createGraphQLServer(
  options?: CreateCopilotRuntimeServerOptions
) {
  const schema = await buildSchema({
    resolvers: [GeneratedResponseResolver],
    emitSchemaFile: "./__snapshots__/schema/schema.graphql",
  });

  const yoga = createYoga({
    schema,
    plugins: [useDeferStream()],
    context: (ctx) => createContext(ctx, options),
  });
  const server = createServer(yoga);
  return server;
}

async function main() {
  const server = await createGraphQLServer();

  const port = process.env.PORT ?? 4001;

  server.listen(port, () => {
    console.log(`🪁 Copilot Runtime server is running on port ${port}`);
  });
}

main();
