// The fetch that every built-in-agent LLM call goes through.
//
// `@tanstack/ai-openai`'s `openaiText()` adapter builds its own OpenAI client
// and has no per-request header option, so the factories pass this fetch to
// it. The runtime route runs each request inside `withForwardedHeaders`, so
// this fetch can read the request's `x-*` headers. aimock needs one of them,
// `x-aimock-context`, to match this integration's fixtures.
import { forwardedHeaders } from "@/lib/agents";

/**
 * `fetch` that adds the `x-*` headers of the request being handled, from
 * `forwardedHeaders()`. A header that the call sets itself is kept.
 */
export const forwardingFetch: typeof fetch = (input, init) => {
  const forwarded = Object.entries(forwardedHeaders());
  if (forwarded.length === 0) return fetch(input, init);
  const headers = new Headers(init?.headers);
  for (const [name, value] of forwarded) {
    if (!headers.has(name)) headers.set(name, value);
  }
  return fetch(input, { ...init, headers });
};
