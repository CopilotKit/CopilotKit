import { createCopilotEndpointSingleRoute } from "@copilotkitnext/runtime";
import { CreateCopilotRuntimeServerOptions, getCommonConfig } from "../shared";
import telemetry, { getRuntimeInstanceTelemetryInfo } from "../../telemetry-client";
import { handle } from "hono/vercel";

export function copilotRuntimeNextJSAppRouterEndpoint(options: CreateCopilotRuntimeServerOptions) {
  const commonConfig = getCommonConfig(options);

  telemetry.setGlobalProperties({
    runtime: {
      framework: "nextjs-app-router",
    },
  });

  if (options.properties?._copilotkit) {
    telemetry.setGlobalProperties({
      _copilotkit: options.properties._copilotkit,
    });
  }

  telemetry.capture("oss.runtime.instance_created", getRuntimeInstanceTelemetryInfo(options));

  const logger = commonConfig.logging;
  logger.debug("Creating NextJS App Router endpoint");

  const serviceAdapter = options.serviceAdapter;
  options.runtime.handleServiceAdapter(serviceAdapter);

  const copilotRoute = createCopilotEndpointSingleRoute({
    runtime: options.runtime.instance,
    basePath: options.baseUrl,
  });
  return { handleRequest: handle(copilotRoute) };
}
