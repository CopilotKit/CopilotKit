import { YogaInitialContext } from "graphql-yoga";
import { buildSchemaSync } from "type-graphql";
import { CopilotResolver } from "../../graphql/resolvers/copilot.resolver";
import { useDeferStream } from "@graphql-yoga/plugin-defer-stream";
import { CopilotRuntime } from "../runtime/copilot-runtime";
import { CopilotServiceAdapter } from "../../service-adapters";
import { CopilotCloudOptions } from "../cloud";
import { LogLevel, createLogger } from "../../lib/logger";
import { createYoga } from "graphql-yoga";
import telemetry from "../telemetry-client";
import { StateResolver } from "../../graphql/resolvers/state.resolver";
import * as packageJson from "../../../package.json";

const logger = createLogger();

export const addCustomHeaderPlugin = {
  onResponse({ response }) {
    // Set your custom header; adjust the header name and value as needed
    response.headers.set("X-CopilotKit-Runtime-Version", packageJson.version);
  },
};

type AnyPrimitive = string | boolean | number | null;
export type CopilotRequestContextProperties = Record<
  string,
  AnyPrimitive | Record<string, AnyPrimitive>
>;

export type GraphQLContext = YogaInitialContext & {
  _copilotkit: CreateCopilotRuntimeServerOptions;
  properties: CopilotRequestContextProperties;
  logger: typeof logger;
};

export interface CreateCopilotRuntimeServerOptions {
  runtime: CopilotRuntime<any>;
  serviceAdapter: CopilotServiceAdapter;
  endpoint: string;
  baseUrl?: string;
  cloud?: CopilotCloudOptions;
  properties?: CopilotRequestContextProperties;
  logLevel?: LogLevel;
}

export async function createContext(
  initialContext: YogaInitialContext,
  copilotKitContext: CreateCopilotRuntimeServerOptions,
  contextLogger: typeof logger,
  properties: CopilotRequestContextProperties = {},
): Promise<Partial<GraphQLContext>> {
  logger.debug({ copilotKitContext }, "Creating GraphQL context");
  const ctx: GraphQLContext = {
    ...initialContext,
    _copilotkit: {
      ...copilotKitContext,
    },
    properties: { ...properties },
    logger: contextLogger,
  };
  return ctx;
}

export function buildSchema(
  options: {
    emitSchemaFile?: string;
  } = {},
) {
  logger.debug("Building GraphQL schema...");
  const schema = buildSchemaSync({
    resolvers: [CopilotResolver, StateResolver],
    emitSchemaFile: options.emitSchemaFile,
  });
  logger.debug("GraphQL schema built successfully");
  return schema;
}

export type CommonConfig = {
  logging: typeof logger;
  schema: ReturnType<typeof buildSchema>;
  plugins: Parameters<typeof createYoga>[0]["plugins"];
  context: (ctx: YogaInitialContext) => Promise<Partial<GraphQLContext>>;
};

export function getCommonConfig(options: CreateCopilotRuntimeServerOptions): CommonConfig {
  const logLevel = (process.env.LOG_LEVEL as LogLevel) || (options.logLevel as LogLevel) || "error";
  const logger = createLogger({ level: logLevel, component: "getCommonConfig" });

  const contextLogger = createLogger({ level: logLevel });

  if (options.cloud) {
    telemetry.setCloudConfiguration({
      publicApiKey: options.cloud.publicApiKey,
      baseUrl: options.cloud.baseUrl,
    });
  }

  if (options.properties?._copilotkit) {
    telemetry.setGlobalProperties({
      _copilotkit: {
        ...(options.properties._copilotkit as Record<string, any>),
      },
    });
  }

  telemetry.setGlobalProperties({
    runtime: {
      serviceAdapter: options.serviceAdapter.constructor.name,
    },
  });

  return {
    logging: createLogger({ component: "Yoga GraphQL", level: logLevel }),
    schema: buildSchema(),
    plugins: [useDeferStream(), addCustomHeaderPlugin],
    context: (ctx: YogaInitialContext): Promise<Partial<GraphQLContext>> =>
      createContext(ctx, options, contextLogger, options.properties),
  };
}
