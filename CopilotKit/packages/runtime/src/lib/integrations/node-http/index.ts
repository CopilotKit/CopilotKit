import { createYoga } from "graphql-yoga";
import { CreateCopilotRuntimeServerOptions, getCommonConfig } from "../shared";
import telemetry, { getRuntimeInstanceTelemetryInfo } from "../../telemetry-client";

export function copilotRuntimeNodeHttpEndpoint(options: CreateCopilotRuntimeServerOptions) {
  const commonConfig = getCommonConfig(options);

  telemetry.setGlobalProperties({
    runtime: {
      framework: "node-http",
    },
  });

  if (options.properties?._copilotkit) {
    telemetry.setGlobalProperties({
      _copilotkit: options.properties._copilotkit,
    });
  }

  telemetry.capture("oss.runtime.instance_created", getRuntimeInstanceTelemetryInfo(options));

  const logger = commonConfig.logging;
  logger.debug("Creating Node HTTP endpoint");

  const yoga = createYoga({
    ...commonConfig,
    graphqlEndpoint: options.endpoint,
  });

  return yoga;
}
