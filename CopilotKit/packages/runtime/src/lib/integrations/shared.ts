import { YogaInitialContext } from "graphql-yoga";
import { CopilotRuntime } from "../runtime/copilot-runtime";
import { CopilotServiceAdapter } from "../../service-adapters";
import { CopilotCloudOptions } from "../cloud";
import { LogLevel, createLogger } from "../../lib/logger";
import telemetry from "../telemetry-client";

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
  runtime: CopilotRuntime;
  serviceAdapter: CopilotServiceAdapter;
  endpoint: string;
  baseUrl?: string;
  cloud?: CopilotCloudOptions;
  properties?: CopilotRequestContextProperties;
  logLevel?: LogLevel;
}

export type CommonConfig = {
  logging: typeof logger;
};

export function getCommonConfig(options: CreateCopilotRuntimeServerOptions): CommonConfig {
  const logLevel = (process.env.LOG_LEVEL as LogLevel) || (options.logLevel as LogLevel) || "error";

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
    logging: createLogger({ level: logLevel }),
  };
}
