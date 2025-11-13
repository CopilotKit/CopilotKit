import { CreateCopilotRuntimeServerOptions, getCommonConfig } from "../shared";
import telemetry, { getRuntimeInstanceTelemetryInfo } from "../../telemetry-client";
import { copilotRuntimeNodeHttpEndpoint } from "../node-http";

export const config = {
  api: {
    bodyParser: false,
  },
};

// This import is needed to fix the type error
// Fix is currently in TypeScript 5.5 beta, waiting for stable version
// https://github.com/microsoft/TypeScript/issues/42873#issuecomment-2066874644
export type {} from "@whatwg-node/server";

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

  telemetry.capture("oss.runtime.instance_created", getRuntimeInstanceTelemetryInfo(options));

  const logger = commonConfig.logging;
  logger.debug("Creating NextJS Pages Router endpoint");

  return copilotRuntimeNodeHttpEndpoint(options);
}
