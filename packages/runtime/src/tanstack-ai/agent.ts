import {
  chat,
  combineStrategies,
  maxIterations,
  untilFinishReason,
} from "@tanstack/ai";
import type { AnyTextAdapter } from "@tanstack/ai";
import { BuiltInAgent } from "../agent/index";
import type {
  AgentFactoryContext,
  BuiltInAgentFactoryConfigBase,
} from "../agent/index";
import type { MCPClientConfig } from "../agent/mcp";
import {
  isRecord,
  pickOverrides,
  resolveModelOverride,
} from "../agent/overrides";
import { tanstackAI, toTanStackTools } from "./helper";
import type { TanStackAITools } from "./helper";

/** Loading a learned skill needs room for a model turn that uses it. */
const LEARNED_SKILLS_MAX_ITERATIONS = 10;

/**
 * `chat()` settings that a client may override through the run's
 * `forwardedProps`, when the agent lists them in `overridableProperties`.
 *
 * - `model`: a name from `adapters`. The run uses that adapter.
 * - `modelOptions`: an object, merged over the configured `modelOptions`.
 */
export type TanStackAIOverridableProperty = "model" | "modelOptions";

/**
 * A text adapter, or a function that creates it. A function is called on the
 * agent's first run, not when the agent is created, so an adapter that reads
 * its API key from the environment does not throw at import time.
 */
export type TanStackAIAdapterInput<TAdapter extends AnyTextAdapter> =
  | TAdapter
  | (() => TAdapter);

type ChatOptions = Parameters<typeof chat>[0];

/** `chat()` options that `tanstackAIAgent` sets from the run. */
type RunChatOptionKeys =
  | "adapter"
  | "modelOptions"
  | "messages"
  | "systemPrompts"
  | "tools"
  | "abortController"
  | "threadId"
  | "runId"
  | "stream"
  | "outputSchema"
  | "agentLoopStrategy"
  | "resume"
  | "state";

/**
 * Configuration for {@link tanstackAIAgent}. Other `chat()` options
 * (`mcp`, `metadata`, `middleware`, `toolChoice`, ...) pass through to
 * every `chat()` call.
 */
export type TanStackAIAgentConfig<TAdapter extends AnyTextAdapter> =
  BuiltInAgentFactoryConfigBase &
    Omit<ChatOptions, RunChatOptionKeys> & {
      /**
       * The text adapter, for example `openaiText("gpt-5.5")`, or a function
       * that creates it on the first run: `() => openaiText("gpt-5.5")`.
       */
      adapter: TanStackAIAdapterInput<TAdapter>;
      /** Provider options for the adapter, such as `temperature`. */
      modelOptions?: TAdapter["~types"]["providerOptions"];
      /** The agent's system prompt. */
      prompt?: string;
      /**
       * Server tools, or a function of the run context that returns them.
       * TanStack AI tools and `defineTool` tools can be mixed.
       */
      tools?:
        | TanStackAITools
        | ((
            ctx: AgentFactoryContext,
          ) => TanStackAITools | Promise<TanStackAITools>);
      /** MCP servers to connect to on each run. */
      mcpServers?: MCPClientConfig[];
      /**
       * The most model turns in one run. Default: TanStack AI's default (5),
       * or 10 when learned skills are available.
       */
      maxIterations?: number;
      /** `chat()` settings a client may override through `forwardedProps`. */
      overridableProperties?: TanStackAIOverridableProperty[];
      /**
       * Adapters a client may pick by name with `forwardedProps.model`, when
       * `overridableProperties` includes `"model"`. Each value is an adapter
       * or a function that creates it the first time a client picks it. The
       * configured `modelOptions` go to the picked adapter too.
       */
      adapters?: Record<string, TanStackAIAdapterInput<AnyTextAdapter>>;
    };

/**
 * Returns a getter for the adapter. A function input is called on the first
 * get and its adapter is kept. A throw is not kept: the next get calls the
 * function again.
 */
function lazyAdapter<TAdapter extends AnyTextAdapter>(
  input: TanStackAIAdapterInput<TAdapter>,
) {
  if (typeof input !== "function") return () => input;
  let resolved: TAdapter | undefined;
  return () => {
    resolved ??= input();
    return resolved;
  };
}

function agentLoopStrategy(limit: number) {
  // Same as TanStack AI's default strategy, with this turn limit.
  return combineStrategies([
    maxIterations(limit),
    untilFinishReason(["length"]),
  ]);
}

/**
 * Creates a BuiltInAgent that runs TanStack AI's `chat()` with your adapter.
 *
 * Each run gets the frontend tools, the state tools, the context and state
 * prompts, learned skills, and MCP tools (see `tanstackAI`). A tool with
 * `needsApproval: true`, or a `defineTool` tool with `interrupt: true`,
 * pauses the run with an AG-UI interrupt.
 *
 * @param config - The adapter, prompt, tools, and agent settings. Other
 *   `chat()` options pass through. Pass the adapter as a function
 *   (`adapter: () => openaiText("gpt-5.5")`) to create it on the first run
 *   instead of at import. An error from that function fails the run.
 * @throws Error when a `defineTool` schema in a `tools` array cannot be
 *   converted to JSON Schema (for example a Valibot schema that is not
 *   wrapped in `toStandardJsonSchema`).
 *
 * @example
 * ```ts
 * import { openaiText } from "@tanstack/ai-openai";
 * import { tanstackAIAgent } from "@copilotkit/runtime/tanstack-ai";
 *
 * const agent = tanstackAIAgent({
 *   adapter: openaiText("gpt-5.5"),
 *   prompt: "You are a helpful assistant.",
 *   tools: [getWeather],
 * });
 * ```
 */
export function tanstackAIAgent<TAdapter extends AnyTextAdapter>(
  config: TanStackAIAgentConfig<TAdapter>,
) {
  const {
    adapter,
    adapters,
    modelOptions,
    prompt,
    tools,
    mcpServers,
    maxIterations: iterationLimit,
    overridableProperties,
    learnedSkills,
    capabilities,
    modelHostClass,
    ...chatOptions
  } = config;
  // Map a static tools array once, so a schema that cannot be converted
  // fails here instead of on every run.
  const configuredTools = Array.isArray(tools) ? toTanStackTools(tools) : tools;
  // Adapter functions run on the first run that needs them. Clones share
  // this factory, so they share the created adapters too.
  const getAdapter = lazyAdapter(adapter);
  const adapterGetters = adapters
    ? Object.fromEntries(
        Object.entries(adapters).map(([name, input]) => [
          name,
          lazyAdapter(input),
        ]),
      )
    : undefined;

  return new BuiltInAgent({
    type: "tanstack",
    learnedSkills,
    capabilities,
    modelHostClass,
    factory: async (ctx) => {
      // The adapter comes first, so an adapter that fails to create stops
      // the run before any MCP server is connected.
      const { forwardedProps } = ctx.input;
      const getRunAdapter =
        resolveModelOverride(
          forwardedProps,
          overridableProperties,
          adapterGetters,
        ) ?? getAdapter;
      const runAdapter = getRunAdapter();

      const runTools =
        typeof configuredTools === "function"
          ? await configuredTools(ctx)
          : configuredTools;
      const base = await tanstackAI(ctx, {
        prompt,
        tools: runTools,
        mcpServers,
      });

      const overrides = pickOverrides(forwardedProps, overridableProperties, {
        modelOptions: isRecord,
      });
      const runModelOptions = overrides.modelOptions
        ? { ...modelOptions, ...overrides.modelOptions }
        : modelOptions;

      const limit =
        iterationLimit ??
        (ctx.learnedSkills.catalog ? LEARNED_SKILLS_MAX_ITERATIONS : undefined);

      return chat({
        ...chatOptions,
        ...base,
        adapter: runAdapter,
        modelOptions: runModelOptions,
        ...(limit !== undefined && {
          agentLoopStrategy: agentLoopStrategy(limit),
        }),
        stream: true,
      });
    },
  });
}
