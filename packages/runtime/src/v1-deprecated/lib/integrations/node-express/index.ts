/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/runtime — copilotRuntimeNodeExpressEndpoint:
 *   V2 import and usage:
 *     import { createCopilotExpressHandler } from "@copilotkit/runtime/v2/express";
 *     const v2CreateCopilotExpressHandler = createCopilotExpressHandler;
 *   V2 replacement source: packages/runtime/src/v2/runtime/endpoints/express.ts
 *   V2 docs: https://docs.copilotkit.ai/runtime-server-adapter
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

import type { CreateCopilotRuntimeServerOptions } from "../shared";
import { copilotRuntimeNodeHttpEndpoint } from "../node-http";
import telemetry, {
  getRuntimeInstanceTelemetryInfo,
} from "../../telemetry-client";

export function copilotRuntimeNodeExpressEndpoint(
  options: CreateCopilotRuntimeServerOptions,
) {
  telemetry.setGlobalProperties({
    runtime: {
      framework: "node-express",
    },
  });

  options.runtime.telemetry.capture(
    "oss.runtime.instance_created",
    getRuntimeInstanceTelemetryInfo(options),
  );
  return copilotRuntimeNodeHttpEndpoint(options);
}
