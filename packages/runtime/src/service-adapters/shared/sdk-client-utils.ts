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
