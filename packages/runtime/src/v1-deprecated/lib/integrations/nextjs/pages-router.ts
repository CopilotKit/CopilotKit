/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/runtime — config:
 *   No 1:1 v2 replacement is available.
 *   Related v2 docs (Runtime server adapter): https://docs.copilotkit.ai/runtime-server-adapter
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/runtime — copilotRuntimeNextJSPagesRouterEndpoint:
 *   No 1:1 v2 replacement is available.
 *   Related v2 docs (Runtime server adapter): https://docs.copilotkit.ai/runtime-server-adapter
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

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
