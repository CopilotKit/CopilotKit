import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import type { ModelEntry } from "./config";
import { createCodexModel, isCodexModel } from "./codex";
import { createFakeModel } from "./fake";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** What OpenRouter reports about one call. */
export interface CallMeta {
  /** The host that answered, e.g. "Groq". */
  host?: string;
  /** The cost of the call in USD, as OpenRouter bills it. */
  costUsd?: number;
  /** Where the call was captured (the codex backend). */
  log?: string;
}

/** True for the offline fake, which needs no key. */
export function isFakeModel(model: string) {
  return model.startsWith("fake:");
}

/** True for a model that costs nothing per call: the fake and the codex backend. */
export function isFreeModel(model: string) {
  return isFakeModel(model) || isCodexModel(model);
}

/**
 * Fails before any call when an OpenRouter model is in use and
 * `OPENROUTER_API_KEY` is not set. Fake and codex models need no key.
 */
export function requireKey(models: readonly string[], env = process.env) {
  const real = models.filter((m) => !isFreeModel(m));
  if (real.length > 0 && !env.OPENROUTER_API_KEY) {
    throw new Error(
      `OPENROUTER_API_KEY is not set (needed for: ${[...new Set(real)].join(", ")}). Use --preset offline to run without a key.`,
    );
  }
}

/** Reads `provider` and `usage.cost` from OpenRouter JSON (a response or an SSE chunk). */
function readMeta(json: unknown, meta: CallMeta) {
  if (typeof json !== "object" || json === null) return;
  const record = json as Record<string, unknown>;
  if (typeof record.provider === "string") meta.host = record.provider;
  const usage = record.usage as Record<string, unknown> | undefined;
  if (usage && typeof usage.cost === "number") meta.costUsd = usage.cost;
}

/** Reads every `data:` line of an SSE stream into `meta`. */
async function readStreamMeta(
  stream: ReadableStream<Uint8Array>,
  meta: CallMeta,
) {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const data = line.startsWith("data:") ? line.slice(5).trim() : "";
      if (!data || data === "[DONE]") continue;
      try {
        readMeta(JSON.parse(data), meta);
      } catch {
        // A partial or non-JSON line carries no meta.
      }
    }
  }
}

/**
 * A fetch for OpenRouter that asks for the cost of each call, pins the host
 * when `entry.provider` is set (no fallback to another host, because hosts
 * of an open model differ in quantisation), passes the reasoning effort,
 * and reports the host and cost that came back. `report` runs once the
 * response body has been read.
 */
export function openRouterFetch(
  entry: Pick<ModelEntry, "provider" | "params">,
  report: (meta: CallMeta) => void,
  baseFetch: typeof fetch = fetch,
): typeof fetch {
  return async (input, init) => {
    let body = init?.body;
    if (typeof body === "string") {
      const json = JSON.parse(body) as Record<string, unknown>;
      json.usage = { include: true };
      if (entry.provider) {
        json.provider = { order: [entry.provider], allow_fallbacks: false };
      }
      if (entry.params?.reasoningEffort) {
        json.reasoning = { effort: entry.params.reasoningEffort };
      }
      body = JSON.stringify(json);
    }
    const response = await baseFetch(input, { ...init, body });
    const meta: CallMeta = {};
    const type = response.headers.get("content-type") ?? "";
    if (response.body && type.includes("text/event-stream")) {
      const [forSdk, forMeta] = response.body.tee();
      // A broken stream fails the SDK's branch too, which records the error;
      // this branch only reports what it read.
      void readStreamMeta(forMeta, meta)
        .catch(() => {})
        .then(() => report(meta));
      return new Response(forSdk, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }
    try {
      readMeta(await response.clone().json(), meta);
    } catch {
      // Not JSON: no meta.
    }
    report(meta);
    return response;
  };
}

/**
 * The AI SDK model of an entry: OpenRouter through its OpenAI-compatible
 * Chat Completions API, the local Codex CLI for `codex:<model>`, or the
 * offline fake for `fake:<script>`. `report` gets the host and cost of each
 * call (OpenRouter), or where it was captured (codex).
 */
export function createLanguageModel(
  entry: Pick<ModelEntry, "model" | "provider" | "params">,
  report: (meta: CallMeta) => void = () => {},
  env = process.env,
): LanguageModel {
  if (isFakeModel(entry.model)) return createFakeModel(entry.model);
  if (isCodexModel(entry.model)) return createCodexModel(entry, report);
  requireKey([entry.model], env);
  const openrouter = createOpenAI({
    baseURL: OPENROUTER_BASE_URL,
    apiKey: env.OPENROUTER_API_KEY,
    fetch: openRouterFetch(entry, report),
    headers: { "X-Title": "CopilotKit genui-eval" },
  });
  return openrouter.chat(entry.model);
}
