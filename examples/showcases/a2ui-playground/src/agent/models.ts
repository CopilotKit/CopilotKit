/**
 * The models the playground can run on. All three speak the OpenAI chat
 * completions API: Gemini through Google's OpenAI-compatible endpoint, Gemma
 * through Google's endpoint or any local OpenAI-compatible server (Ollama by
 * default), GPT through OpenAI. Each has a router model (picks the tool) and a
 * composer model (writes the surface).
 *
 *   GEMINI_API_KEY            Gemini (default model)
 *   GEMMA_BASE_URL            Gemma server, default http://localhost:11434/v1 (Ollama);
 *                             required when hosted (Railway, Vercel), where there is no local server.
 *                             Google's endpoint serves Gemma too:
 *                               GEMMA_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
 *                               GEMMA_API_KEY=<a Gemini key>  GEMMA_MODEL=gemma-4-26b-a4b-it
 *   OPENAI_API_KEY            GPT
 */
import OpenAI from "openai";
import { MODEL_OPTIONS, modelLabel, type ModelId } from "@/lib/model-options";

export type { ModelId };

export type ModelSpec = {
  id: ModelId;
  label: string;
  router: string;
  composer: string;
  /** Extra request fields the provider understands. */
  extra: Record<string, unknown>;
  /** Whether the provider accepts `parallel_tool_calls`. */
  parallelToolCalls: boolean;
  /** The request field that caps the reply at `tokens`: OpenAI's reasoning models take only `max_completion_tokens`. */
  maxTokens: (tokens: number) => Record<string, number>;
  client: () => OpenAI;
  /** Why the model cannot run here, when it cannot. Shown to visitors (picker, evals), so it names no values. */
  missing: () => string | undefined;
  /** What to set to make it run. Server log only. */
  setup: string;
  /** Where the model runs, for the picker. */
  note: () => string;
};

const env = (k: string) => process.env[k];

const GOOGLE_HOST = "generativelanguage.googleapis.com";
const gemmaBase = () => env("GEMMA_BASE_URL");
const gemmaOnGoogle = () => !!gemmaBase()?.includes(GOOGLE_HOST);
const gemmaKey = () =>
  env("GEMMA_API_KEY") ??
  (gemmaOnGoogle()
    ? (env("GEMINI_API_KEY") ?? env("GOOGLE_API_KEY"))
    : undefined);
const isLocal = (url: string) =>
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(url);
const gemmaModel = () =>
  env("GEMMA_MODEL") ?? (gemmaOnGoogle() ? "gemma-4-26b-a4b-it" : "gemma4:e4b");

export const MODELS: Record<ModelId, ModelSpec> = {
  gemini: {
    id: "gemini",
    label: modelLabel("gemini"),
    router:
      env("A2UI_GEMINI_ROUTER_MODEL") ??
      env("A2UI_GEMINI_MODEL") ??
      "gemini-flash-latest",
    composer: env("A2UI_GEMINI_MODEL") ?? "gemini-flash-latest",
    // Thinking off: Express compiles reliably without it, and it is the fast path.
    extra: { reasoning_effort: "none" },
    parallelToolCalls: false,
    maxTokens: (tokens) => ({ max_tokens: tokens }),
    client: () =>
      new OpenAI({
        apiKey: env("GEMINI_API_KEY") ?? env("GOOGLE_API_KEY"),
        baseURL:
          env("GEMINI_BASE_URL") ?? `https://${GOOGLE_HOST}/v1beta/openai/`,
      }),
    missing: () =>
      env("GEMINI_API_KEY") || env("GOOGLE_API_KEY") || env("GEMINI_BASE_URL")
        ? undefined
        : "There is no Gemini key on this server.",
    setup: "Set GEMINI_API_KEY.",
    note: () => "Google, default",
  },
  gemma: {
    id: "gemma",
    label: modelLabel("gemma"),
    router: gemmaModel(),
    composer: gemmaModel(),
    extra: {},
    parallelToolCalls: false,
    maxTokens: (tokens) => ({ max_tokens: tokens }),
    client: () =>
      new OpenAI({
        apiKey: gemmaKey() ?? "ollama",
        baseURL: gemmaBase() ?? "http://localhost:11434/v1",
      }),
    // A hosted server (Railway, Vercel) has no local Ollama to fall back to.
    missing: () => {
      if (!gemmaBase())
        return env("RAILWAY_PROJECT_ID") || env("VERCEL")
          ? "Gemma runs on your own machine. Clone the playground and use Ollama to try it."
          : undefined;
      return gemmaOnGoogle() && !gemmaKey()
        ? "There is no Gemma key on this server."
        : undefined;
    },
    setup:
      "Set GEMMA_BASE_URL (Google's OpenAI endpoint with GEMMA_API_KEY, or an Ollama server), or run `ollama pull gemma4:e4b` locally.",
    note: () => {
      const base = gemmaBase();
      if (!base || isLocal(base)) return "local, via Ollama";
      return gemmaOnGoogle() ? "Google AI" : "self-hosted";
    },
  },
  gpt: {
    id: "gpt",
    label: modelLabel("gpt"),
    router: env("A2UI_ROUTER_MODEL") ?? "gpt-5.5",
    composer: env("A2UI_COMPOSER_MODEL") ?? "gpt-5.4-mini",
    extra: { reasoning_effort: "none" },
    parallelToolCalls: true,
    maxTokens: (tokens) => ({ max_completion_tokens: tokens }),
    client: () => new OpenAI(),
    missing: () =>
      env("OPENAI_API_KEY")
        ? undefined
        : "There is no OpenAI key on this server.",
    setup: "Set OPENAI_API_KEY.",
    note: () => "OpenAI",
  },
};

// DISABLED_MODELS=gpt (comma-separated ids) turns a model off on this server without removing its key,
// for example while its provider account has no credit. The picker shows it as unavailable.
const turnedOff = (id: ModelId) =>
  (env("DISABLED_MODELS") ?? "")
    .split(",")
    .map((s) => s.trim())
    .includes(id);
for (const spec of Object.values(MODELS)) {
  const missing = spec.missing;
  spec.missing = () =>
    turnedOff(spec.id) ? "It's turned off on this server for now." : missing();
}

export const DEFAULT_MODEL: ModelId = "gemini";

export const modelOf = (value: unknown): ModelSpec =>
  MODELS[
    (typeof value === "string" && value in MODELS
      ? value
      : DEFAULT_MODEL) as ModelId
  ];

/** What `GET /api/models` tells the browser: per model, whether it can run here and a short note. No env values. */
export type ModelAvailability = {
  id: ModelId;
  available: boolean;
  note: string;
  reason?: string;
};

export function modelAvailability(): ModelAvailability[] {
  return MODEL_OPTIONS.map(({ id }) => {
    const spec = MODELS[id];
    const reason = spec.missing();
    return reason
      ? { id, available: false, note: spec.note(), reason }
      : { id, available: true, note: spec.note() };
  });
}
