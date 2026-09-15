/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/runtime — buildSchema:
 *   No 1:1 v2 replacement is available.
 *   Related v2 docs (Runtime server adapter): https://docs.copilotkit.ai/runtime-server-adapter
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/runtime — CommonConfig:
 *   No 1:1 v2 replacement is available.
 *   Related v2 docs (Runtime server adapter): https://docs.copilotkit.ai/runtime-server-adapter
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/runtime — CopilotEndpointCorsConfig:
 *   V2 import and usage:
 *     import type { CopilotEndpointCorsConfig } from "@copilotkit/runtime/v2";
 *     type V2CopilotEndpointCorsConfig = CopilotEndpointCorsConfig;
 *   V2 replacement source: packages/runtime/src/v2/runtime/endpoints/hono.ts
 *   V2 docs: https://docs.copilotkit.ai/runtime-server-adapter
 *
 * @copilotkit/runtime — CopilotRequestContextProperties:
 *   No 1:1 v2 replacement is available.
 *   Related v2 docs (Runtime server adapter): https://docs.copilotkit.ai/runtime-server-adapter
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/runtime — CreateCopilotRuntimeServerOptions:
 *   No 1:1 v2 replacement is available.
 *   Related v2 docs (Runtime server adapter): https://docs.copilotkit.ai/runtime-server-adapter
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/runtime — getCommonConfig:
 *   No 1:1 v2 replacement is available.
 *   Related v2 docs (Runtime server adapter): https://docs.copilotkit.ai/runtime-server-adapter
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/runtime — GraphQLContext:
 *   No 1:1 v2 replacement is available.
 *   Related v2 docs (Runtime server adapter): https://docs.copilotkit.ai/runtime-server-adapter
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

import { buildSchemaSync } from "type-graphql";
import { CopilotResolver } from "../../graphql/resolvers/copilot.resolver";
import type { CopilotRuntime } from "../runtime/copilot-runtime";
import type { CopilotServiceAdapter } from "../../service-adapters";
import type { CopilotCloudOptions } from "../cloud";
import type { LogLevel } from "../../lib/logger";
import { createLogger } from "../../lib/logger";
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

/**
 * The request-scoped fields the v1 middleware hooks read off the GraphQL
 * context.
 *
 * Declared here rather than imported as Yoga's `YogaInitialContext`. Nothing in
 * this package serves GraphQL any more -- every v1 integration entry point
 * delegates to the v2 Hono endpoint -- but that one type reference was enough to
 * pull the whole `graphql-yoga` barrel, and with it `lru-cache@10`, into every
 * consumer's program. `lru-cache@10` declares `implements Map`, which costs five
 * TS2416 errors under `strict` with `skipLibCheck: false` (OSS-899).
 *
 * Structurally identical to `YogaInitialContext`, so a real Yoga context still
 * satisfies it.
 */
export interface GraphQLRequestContext {
  /** GraphQL parameters parsed from the request. */
  params: {
    operationName?: string;
    query?: string;
    variables?: Record<string, any>;
    extensions?: Record<string, any>;
  };
  /** The incoming HTTP request. */
  request: Request;
  /** Defers work past the response, where the host runtime supports it. */
  waitUntil(promise: Promise<unknown> | void): void;
}

export type GraphQLContext = GraphQLRequestContext & {
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
      serviceAdapter: options.serviceAdapter?.constructor?.name ?? "none",
    },
  });

  return {
    logging: createLogger({ component: "CopilotKit Runtime", level: logLevel }),
  };
}
