/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/runtime — copilotRuntimeNestEndpoint:
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
import { createNodeHttpEndpoint } from "../node-http/endpoint";

export function copilotRuntimeNestEndpoint(
  options: CreateCopilotRuntimeServerOptions,
) {
  return createNodeHttpEndpoint(options, "nest");
}
