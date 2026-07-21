import type { CreateCopilotRuntimeServerOptions } from "../shared";
import { getCommonConfig } from "../shared";
import telemetry, {
  getRuntimeInstanceTelemetryInfo,
} from "../../telemetry-client";
import { copilotRuntimeNodeHttpEndpoint } from "../node-http";

export const config = {
  api: {
    bodyParser: false,
  },
};

export function copilotRuntimeNextJSPagesRouterEndpoint(
  options: CreateCopilotRuntimeServerOptions,
) {
  const commonConfig = getCommonConfig(options);

  telemetry.setGlobalProperties({
    runtime: {
      framework: "nextjs-pages-router",
    },
  });

  if (options.properties?._copilotkit) {
    telemetry.setGlobalProperties({
      _copilotkit: options.properties._copilotkit,
    });
  }

  telemetry.capture(
    "oss.runtime.instance_created",
    getRuntimeInstanceTelemetryInfo(options),
  );

  const logger = commonConfig.logging;
  logger.debug("Creating NextJS Pages Router endpoint");

  return copilotRuntimeNodeHttpEndpoint(options);
}
