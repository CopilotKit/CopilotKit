/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/sdk-js — getForwardedHeaders:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/sdk-js — withForwardedHeaders:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 * V1 source file: packages/sdk-js/src/header-propagation.ts
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

import { AsyncLocalStorage } from "node:async_hooks";

type HeaderMap = Record<string, string>;

const headerStorage = new AsyncLocalStorage<HeaderMap>();

/**
 * Filter incoming headers to only x-* prefixed headers.
 * Matches the CopilotKit runtime's extractForwardableHeaders() behavior.
 */
function filterForwardableHeaders(headers: HeaderMap): HeaderMap {
  const filtered: HeaderMap = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (lower.startsWith("x-")) {
      filtered[lower] = value;
    }
  }
  return filtered;
}

/**
 * Run a callback with forwarded headers available via getForwardedHeaders().
 * Call this at the AG-UI request entry point.
 */
export function withForwardedHeaders<T>(headers: HeaderMap, fn: () => T): T {
  return headerStorage.run(filterForwardableHeaders(headers), fn);
}

/**
 * Get x-* prefixed headers that should be forwarded to outgoing LLM calls.
 * Returns empty object when called outside a withForwardedHeaders() scope
 * (demo traffic).
 */
export function getForwardedHeaders(): HeaderMap {
  return headerStorage.getStore() ?? {};
}
