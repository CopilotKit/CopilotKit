/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/runtime — copilotRuntimeNodeHttpEndpoint:
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

import type { CreateCopilotRuntimeServerOptions } from "../shared";
import { createNodeHttpEndpoint } from "./endpoint";

export function copilotRuntimeNodeHttpEndpoint(
  options: CreateCopilotRuntimeServerOptions,
) {
  return createNodeHttpEndpoint(options, "node-http");
}
