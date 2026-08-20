/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/runtime — getSdkClientOptions:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 * V1 source file: packages/runtime/src/service-adapters/shared/sdk-client-utils.ts
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

/**
 * SDK clients (OpenAI, Anthropic, Groq) store constructor options like
 * `defaultHeaders` and `fetch` in a private/protected `_options` field
 * with no public accessor. This extracts them with a narrow type assertion.
 */
export function getSdkClientOptions(client: object): {
  defaultHeaders?: Record<string, string>;
  fetch?: typeof globalThis.fetch;
} {
  const rec = client as Record<string, unknown>;
  const options = rec._options;
  if (options != null && typeof options === "object") {
    return options as {
      defaultHeaders?: Record<string, string>;
      fetch?: typeof globalThis.fetch;
    };
  }
  return {};
}
