/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/runtime — copilotRuntimeNestEndpoint:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

import { CreateCopilotRuntimeServerOptions } from "../shared";
import { copilotRuntimeNodeHttpEndpoint } from "../node-http";
import telemetry, {
  getRuntimeInstanceTelemetryInfo,
} from "../../telemetry-client";

export function copilotRuntimeNestEndpoint(
  options: CreateCopilotRuntimeServerOptions,
) {
  telemetry.setGlobalProperties({
    runtime: {
      framework: "nest",
    },
  });

  telemetry.capture(
    "oss.runtime.instance_created",
    getRuntimeInstanceTelemetryInfo(options),
  );
  return copilotRuntimeNodeHttpEndpoint(options);
}
