/**
 * The OpenAI provider every agent in this Worker uses, with per-request header
 * forwarding.
 *
 * The showcase drives the model through aimock in tests: `OPENAI_BASE_URL`
 * points at it, and aimock picks fixtures by the `x-aimock-context` header (the
 * integration's slug, attached to every call). A probe also sends headers that
 * must reach the model call: `x-aimock-strict` (a fixture miss fails instead of
 * proxying to a real provider), `x-test-id` (aimock's per-run sequence
 * counters, and the CVDIAG join key), `x-aimock-context` and `x-diag-*`. The
 * Next.js route forwards them onto its POST to this Worker; here they arrive on
 * the run's HTTP request (`run.request`), and `forwardingFetch` copies the ones
 * that are present onto every outbound model request. Nothing is added when
 * the inbound request carries none of them, so ordinary demo traffic is
 * unchanged.
 */
import { createOpenAI } from "@ai-sdk/openai";

/** Bindings the agents read (wrangler.jsonc `vars`, overridden by the container env). */
export interface ModelEnv {
  OPENAI_BASE_URL?: string;
  OPENAI_API_KEY?: string;
  MODEL_ID?: string;
  OPENAI_REASONING_MODEL?: string;
  AIMOCK_CONTEXT?: string;
}

export const DEFAULT_MODEL = "gpt-6-luna";
const DEFAULT_CONTEXT = "cloudflare-agents";

/** True for the inbound headers the model call must carry. */
export function isForwardedHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower === "x-aimock-strict" ||
    lower === "x-test-id" ||
    lower === "x-aimock-context" ||
    lower.startsWith("x-diag-")
  );
}

/** The forwardable headers present on `request` (none for a WebSocket run). */
export function forwardedHeaders(request: Request | undefined): Headers {
  const out = new Headers();
  request?.headers.forEach((value, name) => {
    if (isForwardedHeader(name)) out.set(name, value);
  });
  return out;
}

/**
 * A `fetch` that adds `headers` to each request, without replacing a header
 * the provider set itself.
 */
export function forwardingFetch(
  headers: Headers,
  baseFetch: typeof fetch = fetch,
): typeof fetch {
  return (input, init) => {
    if ([...headers.keys()].length === 0) return baseFetch(input, init);
    const merged = new Headers(init?.headers);
    headers.forEach((value, name) => {
      if (!merged.has(name)) merged.set(name, value);
    });
    return baseFetch(input, { ...init, headers: merged });
  };
}

/**
 * The OpenAI provider for one run: `OPENAI_BASE_URL` (aimock in tests), the
 * integration's `x-aimock-context`, and the run's forwarded headers.
 */
export function openaiFor(env: ModelEnv, request: Request | undefined) {
  return createOpenAI({
    baseURL: env.OPENAI_BASE_URL || undefined,
    // aimock accepts any key; a real deployment sets OPENAI_API_KEY.
    apiKey: env.OPENAI_API_KEY || "sk-unset",
    headers: { "x-aimock-context": env.AIMOCK_CONTEXT || DEFAULT_CONTEXT },
    fetch: forwardingFetch(forwardedHeaders(request)),
  });
}

/** The chat model id (`MODEL_ID`, gpt-6-luna by default). */
export function chatModelId(env: ModelEnv): string {
  return env.MODEL_ID || DEFAULT_MODEL;
}

/** The reasoning model id (`OPENAI_REASONING_MODEL`, gpt-6-luna by default). */
export function reasoningModelId(env: ModelEnv): string {
  return env.OPENAI_REASONING_MODEL || DEFAULT_MODEL;
}

/**
 * Provider options for the chat agents. gpt-6-luna reasons by default; the
 * chat demos run it with reasoning off, as the other OpenAI-backed showcase
 * integrations do.
 */
export function chatProviderOptions(modelId: string) {
  return modelId === DEFAULT_MODEL
    ? { openai: { reasoningEffort: "none" as const } }
    : undefined;
}
