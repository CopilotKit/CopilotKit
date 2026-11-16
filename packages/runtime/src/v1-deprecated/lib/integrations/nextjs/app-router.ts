/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/runtime — copilotRuntimeNextJSAppRouterEndpoint:
 *   V2 import and usage:
 *     import { createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";
 *     const v2CreateCopilotRuntimeHandler = createCopilotRuntimeHandler;
 *   V2 replacement source: packages/runtime/src/v2/runtime/core/fetch-handler.ts
 *   V2 docs: https://docs.copilotkit.ai/runtime-server-adapter
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

import { createCopilotEndpointSingleRoute } from "../../../../v2/runtime/endpoints/hono-single";
import type { CreateCopilotRuntimeServerOptions } from "../shared";
import { getCommonConfig } from "../shared";
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

  // Compute the v1 payload before `handleServiceAdapter`: it reads
  // `runtime.params` and must not build `runtime.instance` (see
  // v1-endpoint-order.test.ts). The v2 handler below sends the event.
  const instanceCreatedInfo = getRuntimeInstanceTelemetryInfo(options);

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
    __instanceCreatedInfo: instanceCreatedInfo,
  } as any);

  const handleRequest = handle(copilotRoute as any);
  return { handleRequest };
}
