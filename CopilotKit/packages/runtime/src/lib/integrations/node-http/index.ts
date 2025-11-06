import { CreateCopilotRuntimeServerOptions, getCommonConfig } from "../shared";
import telemetry, { getRuntimeInstanceTelemetryInfo } from "../../telemetry-client";
// @ts-expect-error - createCopilotEndpointSingleRouteExpress is exported. Type issues in imported package.
import { createCopilotEndpointSingleRouteExpress } from "@copilotkitnext/runtime/express";

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

  const serviceAdapter = options.serviceAdapter;
  options.runtime.handleServiceAdapter(serviceAdapter);

  return createCopilotEndpointSingleRouteExpress({
    runtime: options.runtime.instance,
    basePath: options.baseUrl,
  });
}
