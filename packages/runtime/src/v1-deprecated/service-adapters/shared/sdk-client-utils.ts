/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/runtime — getSdkClientOptions:
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

/**
 * The part of a vendor SDK client these adapters actually use.
 *
 * `@anthropic-ai/sdk` and `groq-sdk` are *optional* peer dependencies, so a
 * consumer who never touches those adapters does not install them. Naming their
 * types in a published signature makes the declaration unresolvable for everyone
 * else -- a TS2307 on a bare `import { CopilotRuntime }` under
 * `skipLibCheck: false` (OSS-899).
 *
 * A real `Anthropic` or `Groq` instance satisfies this, so passing one still
 * type-checks. The adapters read nothing beyond these two fields; everything
 * else goes through `getSdkClientOptions`, which takes an `object`.
 */
export interface SdkClientLike {
  /** Base URL the client was configured with. */
  baseURL: string;
  /** API key the client was configured with. */
  apiKey: string | null;
}

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
