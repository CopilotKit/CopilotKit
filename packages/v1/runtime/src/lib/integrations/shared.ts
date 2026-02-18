import { YogaInitialContext } from "graphql-yoga";
import { buildSchemaSync } from "type-graphql";
import { CopilotResolver } from "../../graphql/resolvers/copilot.resolver";
import { CopilotRuntime } from "../runtime/copilot-runtime";
import { CopilotServiceAdapter } from "../../service-adapters";
import { CopilotCloudOptions } from "../cloud";
import { LogLevel, createLogger } from "../../lib/logger";
import telemetry from "../telemetry-client";
import { StateResolver } from "../../graphql/resolvers/state.resolver";

/**
 * CORS configuration for CopilotKit endpoints.
 */
export interface CopilotEndpointCorsConfig {
  /**
   * Allowed origin(s). Can be a string, array of strings, or a function that returns the origin.
   */
  origin:
    | string
    | string[]
    | ((origin: string, c: any) => string | undefined | null);
  /**
   * Whether to include credentials (cookies, authorization headers) in CORS requests.
   * When true, origin cannot be "*" - must be an explicit origin.
   */
  credentials?: boolean;
}

const logger = createLogger();

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
  serviceAdapter?: CopilotServiceAdapter;
  endpoint: string;
  baseUrl?: string;
  cloud?: CopilotCloudOptions;
  properties?: CopilotRequestContextProperties;
  logLevel?: LogLevel;
  /**
   * Optional CORS configuration. When not provided, defaults to allowing all origins without credentials.
   * To support HTTP-only cookies, provide cors config with credentials: true and explicit origin.
   */
  cors?: CopilotEndpointCorsConfig;
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
};

export function getCommonConfig(
  options: CreateCopilotRuntimeServerOptions,
): CommonConfig {
  const logLevel =
    (process.env.LOG_LEVEL as LogLevel) ||
    (options.logLevel as LogLevel) ||
    "error";
  const logger = createLogger({
    level: logLevel,
    component: "getCommonConfig",
  });

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
    logging: createLogger({ component: "CopilotKit Runtime", level: logLevel }),
  };
}
