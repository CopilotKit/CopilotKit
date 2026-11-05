import { classifyModelHost, processEnv } from "@copilotkit/shared";
import type { AnyTextAdapter } from "@tanstack/ai";
import type * as TanStackAnthropic from "@tanstack/ai-anthropic";
import type * as TanStackGemini from "@tanstack/ai-gemini";
import type * as TanStackOpenAI from "@tanstack/ai-openai";
import type * as TanStackOpenAICompatible from "@tanstack/ai-openai/compatible";
import type * as TanStackVertex from "@tanstack/ai-vertex";
import { isRecord } from "./converters/usage";
import { loadOptionalPeer } from "./optional-peers";

/**
 * Model identifiers for BuiltInAgent. The named entries are editor
 * suggestions, not an allowlist: any provider model id is sent through
 * unchanged.
 */
export type BuiltInAgentModel =
  // OpenAI models
  | "openai/gpt-5.5"
  | "openai/gpt-5.4"
  | "openai/gpt-5.4-mini"
  | "openai/gpt-5"
  | "openai/gpt-5-mini"
  | "openai/gpt-4.1"
  | "openai/gpt-4.1-mini"
  | "openai/gpt-4.1-nano"
  | "openai/gpt-4o"
  | "openai/gpt-4o-mini"
  // OpenAI reasoning series
  | "openai/o3"
  | "openai/o3-mini"
  | "openai/o4-mini"
  // Anthropic (Claude) models
  | "anthropic/claude-sonnet-4-6"
  | "anthropic/claude-sonnet-4-5"
  | "anthropic/claude-opus-4-8"
  | "anthropic/claude-haiku-4-5"
  // Google (Gemini) models
  | "google/gemini-3.8-flash"
  | "google/gemini-3.5-flash"
  | "google/gemini-3.5-flash-lite"
  // MiniMax models
  | "minimax/MiniMax-M3"
  | "minimax/MiniMax-M2.7"
  // Any other model string
  | (string & {});

/**
 * What `BuiltInAgent` accepts as `model`: a model string such as
 * `"openai/gpt-5"`, or a TanStack AI text adapter such as `openaiText("gpt-5")`.
 */
export type ModelSpecifier = string | AnyTextAdapter;

/**
 * Split a model string into provider and model id. The provider is the text
 * before the FIRST ":" or "/"; everything after it is the model id, unchanged.
 * So "openai:meta-llama/llama-3.3-70b" keeps the slash in its model id, and
 * "openai/ft:gpt-4o-mini:org::id" keeps its colons. Empty strings mean the
 * part is missing.
 */
function parseModelSpec(spec: string) {
  const trimmed = spec.trim();
  const separator = trimmed.search(/[:/]/);
  if (separator === -1) {
    return { provider: trimmed.toLowerCase(), model: "" };
  }
  return {
    provider: trimmed.slice(0, separator).toLowerCase(),
    model: trimmed.slice(separator + 1).trim(),
  };
}

/**
 * Whether an `OPENAI_BASE_URL` should get Chat Completions instead of the
 * Responses API. OpenAI's own hosts (including `*.api.openai.com`, such as the
 * EU data-residency host) and Azure serve `/responses`, so they keep it, as
 * does an unset value. Any other host gets `/chat/completions`, which is what
 * most OpenAI-compatible servers implement. The host rule is
 * `classifyModelHost`, the same one telemetry uses.
 *
 * A value `new URL` throws on keeps the Responses route; the request will
 * fail on that base URL either way. A schemeless value such as
 * `localhost:11434/v1` does not throw (it parses with scheme `localhost:` and
 * an empty host), so it classifies as `other` and gets Chat Completions.
 */
function usesChatCompletions(baseURL: string | undefined) {
  const trimmed = baseURL?.trim();
  if (!trimmed) return false;
  try {
    new URL(trimmed);
  } catch {
    return false;
  }
  const host = classifyModelHost(trimmed, "openai");
  return host !== "openai" && host !== "azure";
}

/** Whether the Chat Completions notice below was already logged. */
let loggedChatCompletionsRoute = false;

/**
 * Which OpenAI API an `openai/...` model string targets.
 *
 * `COPILOTKIT_OPENAI_API` (`responses` or `chat`) wins when set, so a proxy in
 * front of OpenAI can keep the Responses API, and an OpenAI host can use Chat
 * Completions. Unset or blank, `usesChatCompletions` decides from
 * `OPENAI_BASE_URL`.
 *
 * When that rule picks Chat Completions, this logs once per process. Through a
 * proxy, Chat Completions drops Responses-only features (such as reasoning
 * summaries) without an error, and the notice names the way back.
 */
function openAIApiFor(baseURL: string | undefined) {
  const raw = processEnv().COPILOTKIT_OPENAI_API;
  const override = raw?.trim().toLowerCase();
  if (override === "responses" || override === "chat") return override;
  if (override) {
    throw new Error(
      `Invalid COPILOTKIT_OPENAI_API "${raw}". Use "responses" or "chat", or leave it unset.`,
    );
  }
  if (!usesChatCompletions(baseURL)) return "responses";
  if (!loggedChatCompletionsRoute) {
    loggedChatCompletionsRoute = true;
    console.info(
      '[CopilotKit] OPENAI_BASE_URL is not an OpenAI or Azure host, so "openai/..." models use the Chat Completions API. To use the Responses API instead, set COPILOTKIT_OPENAI_API=responses.',
    );
  }
  return "chat";
}

/**
 * The API key for a model string: the `apiKey` the caller passed, else the
 * first env var in `envVars` that is set. Throws when none is set, so the
 * error names the env var instead of failing later inside the adapter.
 */
function apiKeyFor(
  spec: string,
  apiKey: string | undefined,
  envVars: readonly [string, ...string[]],
) {
  const env = processEnv();
  const key = apiKey || envVars.map((name) => env[name]).find(Boolean);
  if (!key) {
    throw new Error(
      `Missing API key for "${spec.trim()}". Pass apiKey, or set ${envVars[0]}.`,
    );
  }
  return key;
}

/**
 * Whether a value is an AI SDK `LanguageModel` object (for example
 * `openai("gpt-5")` from `@ai-sdk/openai`). It checks the shape only, so it
 * loads no AI SDK package.
 *
 * @param value - The value passed as `model`.
 * @returns `true` when the value has `specificationVersion` and a
 *   `doStream` or `doGenerate` method.
 *
 * @example
 * ```ts
 * if (isAISDKLanguageModel(config.model)) throw new Error("...");
 * ```
 */
export function isAISDKLanguageModel(value: unknown) {
  if (!isRecord(value)) return false;
  const hasModelMethod =
    typeof value.doStream === "function" ||
    typeof value.doGenerate === "function";
  return "specificationVersion" in value && hasModelMethod;
}

/**
 * Turn a `model` value into a TanStack AI text adapter.
 *
 * A model string is `"<provider>/<model id>"` (or `"<provider>:<model id>"`).
 * The model id goes to the provider unchanged. Each provider loads its
 * adapter package on first use, so only the packages you use must be
 * installed:
 *
 * - `openai`: `@tanstack/ai-openai`. Key from `apiKey` or `OPENAI_API_KEY`.
 *   `OPENAI_BASE_URL` sets the endpoint. OpenAI and Azure hosts use the
 *   Responses API, other hosts use Chat Completions, and
 *   `COPILOTKIT_OPENAI_API` (`responses` or `chat`) overrides that choice.
 * - `anthropic`: `@tanstack/ai-anthropic`. Key from `apiKey` or
 *   `ANTHROPIC_API_KEY`. `ANTHROPIC_BASE_URL` sets the endpoint.
 * - `google`, `gemini`, `google-gemini`: `@tanstack/ai-gemini`. Key from
 *   `apiKey`, `GOOGLE_API_KEY`, or `GOOGLE_GENERATIVE_AI_API_KEY`.
 *   `GOOGLE_GENERATIVE_AI_BASE_URL` sets the endpoint.
 * - `minimax`: OpenAI-compatible Chat Completions from `@tanstack/ai-openai`.
 *   Key from `apiKey` or `MINIMAX_API_KEY`. `MINIMAX_BASE_URL` sets the
 *   endpoint (default `https://api.minimax.io/v1`).
 * - `vertex`: `@tanstack/ai-vertex` with ambient Google Cloud credentials
 *   (`GOOGLE_CLOUD_PROJECT` / `GOOGLE_VERTEX_PROJECT` and the location).
 *
 * A TanStack AI adapter is returned unchanged.
 *
 * @param spec - A model string, or a TanStack AI text adapter.
 * @param apiKey - The provider API key. When empty, the provider's env var
 *   is used. Not used for `vertex` or for an adapter.
 * @returns The adapter to pass to TanStack AI `chat()`.
 * @throws Error when `spec` is an AI SDK model object, the model string is
 *   invalid or names an unknown provider, `COPILOTKIT_OPENAI_API` is invalid,
 *   the API key is missing, or the adapter package is not installed (the
 *   message names the package to install).
 *
 * @example
 * ```ts
 * const adapter = await resolveModel("anthropic/claude-sonnet-4-6");
 * ```
 */
export async function resolveModel(
  spec: ModelSpecifier,
  apiKey?: string,
): Promise<AnyTextAdapter> {
  if (typeof spec !== "string") {
    if (isAISDKLanguageModel(spec)) {
      throw new Error(
        'BuiltInAgent "model" got an AI SDK model object. Run AI SDK models with a factory: new BuiltInAgent({ type: "aisdk", factory: ... }), with the helpers in "@copilotkit/runtime/agent/ai-sdk". Or pass a model string such as "openai/gpt-5", or a TanStack AI adapter such as openaiText("gpt-5").',
      );
    }
    return spec;
  }

  const { provider, model } = parseModelSpec(spec);

  if (!provider || !model) {
    throw new Error(
      `Invalid model string "${spec}". Use "openai/gpt-5", "anthropic/claude-sonnet-4.5", or "google/gemini-3.8-flash".`,
    );
  }

  const env = processEnv();
  const usage = `"${spec.trim()}" models`;

  switch (provider) {
    case "openai": {
      // Off OpenAI and Azure hosts, use Chat Completions
      // (`{base}/chat/completions`) instead of the Responses API, unless
      // COPILOTKIT_OPENAI_API says otherwise.
      const api = openAIApiFor(env.OPENAI_BASE_URL);
      const key = apiKeyFor(spec, apiKey, ["OPENAI_API_KEY"]);
      const openai = await loadOptionalPeer<typeof TanStackOpenAI>(
        "@tanstack/ai-openai",
        usage,
      );
      // Undefined when unset, so the adapter uses api.openai.com.
      const config = { baseURL: env.OPENAI_BASE_URL };
      // Any OpenAI model id is valid; the factory type lists only known ids.
      const openaiModel = model as TanStackOpenAI.OpenAIChatModel;
      return api === "chat"
        ? openai.createOpenaiChatCompletions(openaiModel, key, config)
        : openai.createOpenaiChat(openaiModel, key, config);
    }

    case "anthropic": {
      const key = apiKeyFor(spec, apiKey, ["ANTHROPIC_API_KEY"]);
      const anthropic = await loadOptionalPeer<typeof TanStackAnthropic>(
        "@tanstack/ai-anthropic",
        usage,
      );
      // ANTHROPIC_BASE_URL ends in the API version (the default is
      // `https://api.anthropic.com/v1`), and requests go to `{base}/messages`.
      // The adapter adds `/v1/messages` itself, so drop a trailing `/v1`.
      const baseURL = env.ANTHROPIC_BASE_URL?.replace(/\/v1\/?$/, "");
      return anthropic.createAnthropicChat(
        // Any Anthropic model id is valid; the factory type lists only known ids.
        model as TanStackAnthropic.AnthropicChatModel,
        key,
        { baseURL },
      );
    }

    case "google":
    case "gemini":
    case "google-gemini": {
      const key = apiKeyFor(spec, apiKey, [
        "GOOGLE_API_KEY",
        "GOOGLE_GENERATIVE_AI_API_KEY",
      ]);
      const gemini = await loadOptionalPeer<typeof TanStackGemini>(
        "@tanstack/ai-gemini",
        usage,
      );
      // GOOGLE_GENERATIVE_AI_BASE_URL ends in the API version (the default is
      // `https://generativelanguage.googleapis.com/v1beta`), and requests go
      // to `{base}/models/...`. An empty `apiVersion` keeps the adapter from
      // adding its own version segment.
      const baseURL = env.GOOGLE_GENERATIVE_AI_BASE_URL;
      const config = baseURL ? { baseURL, apiVersion: "" } : {};
      return gemini.createGeminiChat(
        // Any Gemini model id is valid; the factory type lists only known ids.
        model as TanStackGemini.GeminiTextModel,
        key,
        config,
      );
    }

    case "minimax": {
      const key = apiKeyFor(spec, apiKey, ["MINIMAX_API_KEY"]);
      // Load the package root first, so a missing install names the package
      // and not the subpath.
      await loadOptionalPeer("@tanstack/ai-openai", usage);
      const compatible = await loadOptionalPeer<
        typeof TanStackOpenAICompatible
      >("@tanstack/ai-openai/compatible", usage);
      return compatible.openaiCompatibleText(model, {
        name: "minimax",
        api: "chat-completions",
        apiKey: key,
        baseURL: env.MINIMAX_BASE_URL || "https://api.minimax.io/v1",
      });
    }

    case "vertex": {
      const vertex = await loadOptionalPeer<typeof TanStackVertex>(
        "@tanstack/ai-vertex",
        usage,
      );
      // Ambient Google Cloud credentials. Any Gemini model id is valid; the
      // factory type lists only known ids.
      return vertex.vertexText(model as TanStackGemini.GeminiTextModel);
    }

    default:
      throw new Error(
        `Unknown provider "${provider}" in "${spec}". Supported: openai, anthropic, google (gemini), minimax, vertex.`,
      );
  }
}

/**
 * Which vendor a model specifier will actually reach, as a closed vocabulary.
 *
 * `resolveModel` above is the only place this runtime builds a provider
 * adapter, so it is the only place that knows the endpoint. A caller who
 * passes an already-built adapter gets `unknown`: its endpoint was chosen
 * before it reached us, and a provider label that means only "speaks the
 * OpenAI wire" cannot tell Azure or OpenRouter from api.openai.com.
 *
 * This is sync on purpose: telemetry reads it, and it loads no adapter.
 * The branches below mirror `resolveModel`'s switch and must change with it.
 * `model-host-class.test.ts` walks every provider that switch accepts and
 * fails if one lands here as `unknown`.
 *
 * @param spec - A model string, or a TanStack AI text adapter.
 * @returns The host class, for example `"openai"`, `"azure"`, or `"unknown"`.
 *
 * @example
 * ```ts
 * classifyModelSpec("anthropic/claude-sonnet-4-6"); // "anthropic"
 * ```
 */
export function classifyModelSpec(spec: ModelSpecifier) {
  // A pre-built adapter: the endpoint was decided before it reached us.
  if (typeof spec !== "string") return "unknown";

  const { provider } = parseModelSpec(spec);
  const env = processEnv();

  switch (provider) {
    case "openai":
      return classifyModelHost(env.OPENAI_BASE_URL, "openai");
    case "anthropic":
      return classifyModelHost(env.ANTHROPIC_BASE_URL, "anthropic");
    case "google":
    case "gemini":
    case "google-gemini":
      return classifyModelHost(env.GOOGLE_GENERATIVE_AI_BASE_URL, "google");
    case "minimax":
      return classifyModelHost(
        env.MINIMAX_BASE_URL || "https://api.minimax.io/v1",
        "minimax",
      );
    case "vertex":
      // The Vertex adapter takes no base URL: the endpoint comes from ambient
      // Google credentials, so there is nothing to classify and nothing to leak.
      return "vertex";
    default:
      // `resolveModel` throws on anything else, so the run never starts.
      return "unknown";
  }
}
