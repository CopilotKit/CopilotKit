/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/runtime — copilotRuntimeNextJSAppRouterEndpoint:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 * V1 source file: packages/runtime/src/lib/integrations/nextjs/app-router.ts
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

import { createCopilotEndpointSingleRoute } from "../../../v2/runtime";
import { CreateCopilotRuntimeServerOptions, getCommonConfig } from "../shared";
import telemetry, {
  getRuntimeInstanceTelemetryInfo,
} from "../../telemetry-client";
import { handle } from "hono/vercel";

export function copilotRuntimeNextJSAppRouterEndpoint(
  options: CreateCopilotRuntimeServerOptions,
) {
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

  telemetry.capture(
    "oss.runtime.instance_created",
    getRuntimeInstanceTelemetryInfo(options),
  );

  const logger = commonConfig.logging;
  logger.debug("Creating NextJS App Router endpoint");

  const serviceAdapter = options.serviceAdapter;
  if (serviceAdapter) {
    options.runtime.handleServiceAdapter(serviceAdapter);
  }

  // Note: cors option requires @copilotkit/runtime with credentials support
  const copilotRoute = createCopilotEndpointSingleRoute({
    runtime: options.runtime.instance,
    basePath: options.baseUrl ?? options.endpoint,
    ...(options.cors && { cors: options.cors }),
  } as any);

  const handleRequest = handle(copilotRoute as any);
  return { handleRequest };
}
