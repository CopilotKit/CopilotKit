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
import { CopilotKitError, CopilotKitErrorCode } from "@copilotkit/shared";
import * as semver from "semver";

// Version threshold for REST API (>= 1.50.0 uses REST, < 1.50.0 uses GraphQL)
const REST_API_VERSION_THRESHOLD = "1.50.0";

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
  serviceAdapter?: CopilotServiceAdapter;
  endpoint: string;
  baseUrl?: string;
  cloud?: CopilotCloudOptions;
  properties?: CopilotRequestContextProperties;
  logLevel?: LogLevel;
  runtimeVersion?: string;
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

export type GraphQLConfig = {
  logging: typeof logger;
  schema: ReturnType<typeof buildSchema>;
  plugins: Parameters<typeof createYoga>[0]["plugins"];
  context: (ctx: YogaInitialContext) => Promise<Partial<GraphQLContext>>;
  maskedErrors: {
    maskError: (error: any, message: string, isDev?: boolean) => any;
  };
};

export type RESTAPIConfig = {
  logging: typeof logger;
  maskedErrors: {
    maskError: (error: any, message: string, isDev?: boolean) => any;
  };
};

export type CommonConfig = GraphQLConfig | RESTAPIConfig;

/**
 * Checks if the runtime version should use REST API (>= 1.50.0) or GraphQL (< 1.50.0)
 */
export function isRESTAPIVersion(version?: string): boolean {
  if (!version) return false;
  const cleanVersion = semver.valid(semver.coerce(version));
  if (!cleanVersion) return false;
  return semver.gte(cleanVersion, REST_API_VERSION_THRESHOLD);
}

/**
 * Creates common error handling configuration
 */
function createMaskedErrorsConfig() {
  // User error codes that should not be logged as server errors
  const userErrorCodes = [
    CopilotKitErrorCode.AGENT_NOT_FOUND,
    CopilotKitErrorCode.API_NOT_FOUND,
    CopilotKitErrorCode.REMOTE_ENDPOINT_NOT_FOUND,
    CopilotKitErrorCode.CONFIGURATION_ERROR,
    CopilotKitErrorCode.MISSING_PUBLIC_API_KEY_ERROR,
  ];

  return {
    maskError: (error: any, message: string, isDev?: boolean) => {
      // Check if this is a user configuration error (could be wrapped in GraphQLError)
      const originalError = error.originalError || error;
      const extensions = error.extensions;
      const errorCode = extensions?.code;

      // Suppress logging for user errors based on error code
      if (errorCode && userErrorCodes.includes(errorCode)) {
        // Log user configuration errors at debug level instead
        console.debug("User configuration error:", error.message);
        return error;
      }

      // Check if the original error is a user error
      if (originalError instanceof CopilotKitError && userErrorCodes.includes(originalError.code)) {
        // Log user configuration errors at debug level instead
        console.debug("User configuration error:", error.message);
        return error;
      }

      // For application errors, log normally and mask if needed
      console.error("Application error:", error);
      return error;
    },
  };
}

/**
 * Sets up common telemetry configuration
 */
function setupTelemetry(options: CreateCopilotRuntimeServerOptions) {
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

  if (options.serviceAdapter) {
    telemetry.setGlobalProperties({
      runtime: {
        serviceAdapter: options.serviceAdapter.constructor.name,
      },
    });
  }
}

/**
 * Returns REST API configuration for runtime versions >= 1.50.0
 */
export function getRESTAPIConfig(options: CreateCopilotRuntimeServerOptions): RESTAPIConfig {
  const logLevel = (process.env.LOG_LEVEL as LogLevel) || (options.logLevel as LogLevel) || "error";

  setupTelemetry(options);

  return {
    logging: createLogger({ component: "CopilotKit REST", level: logLevel }),
    maskedErrors: createMaskedErrorsConfig(),
  };
}

/**
 * Returns GraphQL configuration for runtime versions < 1.50.0
 */
export function getGraphQLConfig(options: CreateCopilotRuntimeServerOptions): GraphQLConfig {
  const logLevel = (process.env.LOG_LEVEL as LogLevel) || (options.logLevel as LogLevel) || "error";
  const contextLogger = createLogger({ level: logLevel });

  setupTelemetry(options);

  return {
    logging: createLogger({ component: "Yoga GraphQL", level: logLevel }),
    schema: buildSchema(),
    plugins: [useDeferStream(), addCustomHeaderPlugin],
    context: (ctx: YogaInitialContext): Promise<Partial<GraphQLContext>> =>
      createContext(ctx, options, contextLogger, options.properties),
    maskedErrors: createMaskedErrorsConfig(),
  };
}

/**
 * Returns appropriate configuration based on runtime version.
 * - For versions >= 1.50.0: Returns REST API config
 * - For versions < 1.50.0: Returns GraphQL config
 */
export function getCommonConfig(options: CreateCopilotRuntimeServerOptions): CommonConfig {
  if (isRESTAPIVersion(options.runtimeVersion)) {
    return getRESTAPIConfig(options);
  }
  return getGraphQLConfig(options);
}
