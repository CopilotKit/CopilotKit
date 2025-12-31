import { CreateCopilotRuntimeServerOptions, getCommonConfig } from "../shared";
import telemetry, { getRuntimeInstanceTelemetryInfo } from "../../telemetry-client";
import { createCopilotEndpointSingleRoute } from "@copilotkitnext/runtime";
import { getRequestListener } from "@hono/node-server";
import type { IncomingMessage, ServerResponse } from "node:http";

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
  if (serviceAdapter) {
    options.runtime.handleServiceAdapter(serviceAdapter);
  }

  const honoApp = createCopilotEndpointSingleRoute({
    runtime: options.runtime.instance,
    basePath: options.baseUrl ?? options.endpoint,
  });

  const handle = getRequestListener(honoApp.fetch);

  return function (
    reqOrRequest: IncomingMessage | Request,
    res?: ServerResponse,
  ): Promise<void> | Promise<Response> | Response {
    if (reqOrRequest instanceof Request) {
      return honoApp.fetch(reqOrRequest as Request);
    }
    if (!res) {
      throw new TypeError("ServerResponse is required for Node HTTP requests");
    }
    return handle(reqOrRequest as IncomingMessage, res);
  };
}
