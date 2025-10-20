import { createCopilotEndpoint } from "@copilotkitnext/runtime";
import { CreateCopilotRuntimeServerOptions, getCommonConfig } from "../shared";
import telemetry, { getRuntimeInstanceTelemetryInfo } from "../../telemetry-client";

export function copilotRuntimeNodeHttpEndpoint(
  options: CreateCopilotRuntimeServerOptions,
): ReturnType<typeof createCopilotEndpoint> {
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
  // TODO: fix telemetry capture
  // telemetry.capture("oss.runtime.instance_created", getRuntimeInstanceTelemetryInfo(options));

  const logger = commonConfig.logging;
  logger.debug("Creating Node HTTP endpoint");

  const serviceAdapter = options.serviceAdapter;
  options.runtime.handleServiceAdapter(serviceAdapter);

  return createCopilotEndpoint({
    runtime: options.runtime.runtime,
    basePath: options.baseUrl,
  });
}
