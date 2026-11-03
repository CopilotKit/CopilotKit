import { stepCountIs, streamText } from "ai";
import type { LanguageModel } from "ai";
import { classifyModelHost } from "@copilotkit/shared";
import { BuiltInAgent } from "../agent";
import type {
  AgentFactoryContext,
  BuiltInAgentFactoryConfigBase,
} from "../agent";
import {
  isNumber,
  isRecord,
  isStringArray,
  isToolChoice,
  pickOverrides,
  resolveModelOverride,
} from "../agent/overrides";
import { aiSdk, resolveAiSdkUrlDownload } from "./helper";
import type { AiSdkOptions, AiSdkTools } from "./helper";
import { logModelCallError } from "./url-download";

type StreamTextOptions = Parameters<typeof streamText>[0];
type ProviderOptions = NonNullable<StreamTextOptions["providerOptions"]>;

/** `streamText()` options that `aiSdkAgent` sets itself on every run. */
type AgentOwnedOption =
  | "model"
  | "system"
  | "prompt"
  | "messages"
  | "tools"
  | "stopWhen"
  | "abortSignal"
  | "experimental_download"
  | "onError";

/** Step limit for a run with learned skills and no `maxSteps`, so a loaded skill can be used. */
const LEARNED_SKILLS_STEP_LIMIT = 10;

/** True for provider options: an object of per-provider option objects. */
function isProviderOptions(value: unknown): value is ProviderOptions {
  return isRecord(value) && Object.values(value).every(isRecord);
}

const overrideValidators = {
  toolChoice: isToolChoice,
  maxOutputTokens: isNumber,
  temperature: isNumber,
  topP: isNumber,
  topK: isNumber,
  presencePenalty: isNumber,
  frequencyPenalty: isNumber,
  stopSequences: isStringArray,
  seed: isNumber,
  maxRetries: isNumber,
  providerOptions: isProviderOptions,
};

/**
 * A setting that a client may override per run through `forwardedProps`.
 * `"model"` picks a model by name from the agent's `models`.
 */
export type AiSdkOverridableProperty =
  | "model"
  | keyof typeof overrideValidators;

/** Server tools for {@link aiSdkAgent}: fixed, or built for each run. */
export type AiSdkAgentTools =
  | AiSdkTools
  | ((ctx: AgentFactoryContext) => AiSdkTools | Promise<AiSdkTools>);

/**
 * Configuration for {@link aiSdkAgent}. Any other `streamText()` setting
 * (`temperature`, `providerOptions`, `toolChoice`, `maxOutputTokens`,
 * `headers`, and so on) passes through to every run.
 */
export type AiSdkAgentConfig = Omit<StreamTextOptions, AgentOwnedOption> &
  Omit<AiSdkOptions, "tools"> &
  Pick<BuiltInAgentFactoryConfigBase, "learnedSkills" | "capabilities"> & {
    /** The AI SDK model, for example `openai("gpt-5.5")`. */
    model: LanguageModel;
    /**
     * Your server tools: an AI SDK `ToolSet`, `defineTool` results, or a
     * function of the run context that returns either.
     */
    tools?: AiSdkAgentTools;
    /**
     * Largest number of model steps in one run. Each step can call tools.
     * Default: the AI SDK default (1), or 10 when learned skills are loaded.
     */
    maxSteps?: number;
    /**
     * Settings a client may override per run through `forwardedProps`.
     * Values of the wrong type are ignored.
     */
    overridableProperties?: AiSdkOverridableProperty[];
    /**
     * Models a client may pick by name with `forwardedProps.model`. Needs
     * `"model"` in `overridableProperties`. An unknown name keeps `model`.
     */
    models?: Record<string, LanguageModel>;
  };

/**
 * The endpoint a provider model sends requests to, when the model shows it.
 * AI SDK provider models keep it on `config` (`baseURL`, or a `url()`
 * builder). It is not part of the public model type, so the model is read
 * as `unknown`, and a model without it gives `undefined`.
 */
function observedEndpoint(model: unknown) {
  if (!isRecord(model) || !isRecord(model.config)) return undefined;
  const { baseURL, url } = model.config;
  if (typeof baseURL === "string") return baseURL;
  if (typeof url !== "function") return undefined;
  try {
    const endpoint: unknown = url({ modelId: model.modelId, path: "" });
    return typeof endpoint === "string" ? endpoint : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Which vendor hosts an AI SDK model, for telemetry. Read from the model's
 * endpoint, never guessed from its provider label: `openai.chat` is any
 * host that speaks the OpenAI API. `"unknown"` when the endpoint is not shown.
 */
function classifyLanguageModelHost(model: LanguageModel) {
  return classifyModelHost(observedEndpoint(model));
}

/**
 * Creates a BuiltInAgent that runs an AI SDK model with `streamText()`.
 *
 * Each run gets the client's messages, your prompt with the run's context
 * and state, frontend tools, the AG-UI state tools, MCP tools, learned
 * skills, and your tools. URL attachments are downloaded only from public
 * addresses unless you set `urlDownload`. Works with AI SDK v6 and v7.
 *
 * @param config - The model, prompt, tools, and any other `streamText()`
 *   settings. See {@link AiSdkAgentConfig}.
 * @throws Error when `urlDownload` has invalid options.
 *
 * @example
 * ```ts
 * import { openai } from "@ai-sdk/openai";
 * import { aiSdkAgent } from "@copilotkit/runtime/ai-sdk";
 *
 * const agent = aiSdkAgent({
 *   model: openai("gpt-5.5"),
 *   prompt: "You are a helpful assistant.",
 *   tools: { getWeather },
 *   maxSteps: 5,
 *   temperature: 0.3,
 * });
 * ```
 */
export function aiSdkAgent(config: AiSdkAgentConfig) {
  const {
    model,
    prompt,
    tools,
    mcpServers,
    maxSteps,
    learnedSkills,
    capabilities,
    overridableProperties,
    models,
    forwardSystemMessages,
    forwardDeveloperMessages,
    urlDownload,
    ...settings
  } = config;
  const downloadForRun = resolveAiSdkUrlDownload(urlDownload);

  return new BuiltInAgent({
    type: "aisdk",
    learnedSkills,
    capabilities,
    modelHostClass: classifyLanguageModelHost(model),
    factory: async (ctx) => {
      const { forwardedProps } = ctx.input;
      const runTools = typeof tools === "function" ? await tools(ctx) : tools;
      const base = await aiSdk(ctx, {
        prompt,
        tools: runTools,
        mcpServers,
        forwardSystemMessages,
        forwardDeveloperMessages,
        urlDownload: downloadForRun(ctx.abortSignal),
      });
      const runModel =
        resolveModelOverride(forwardedProps, overridableProperties, models) ??
        model;
      const overrides = pickOverrides(
        forwardedProps,
        overridableProperties,
        overrideValidators,
      );
      const hasLearnedSkills = ctx.learnedSkills.catalog !== "";
      const stepLimit =
        maxSteps ?? (hasLearnedSkills ? LEARNED_SKILLS_STEP_LIMIT : undefined);

      const result = streamText({
        ...settings,
        ...base,
        model: runModel,
        stopWhen: stepLimit === undefined ? undefined : stepCountIs(stepLimit),
        ...overrides,
        // The default handler prints the whole error, including a download
        // URL's query. The error still reaches the client as RUN_ERROR.
        onError: ({ error }) => logModelCallError(error),
      });
      return { fullStream: result.fullStream, model: runModel };
    },
  });
}
