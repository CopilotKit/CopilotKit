import type {
  BaseEvent,
  RunAgentInput,
  RunFinishedEvent,
  RunStartedEvent,
  ToolCallResultEvent,
  RunErrorEvent,
  Interrupt,
  ResumeEntry,
  ToolMessage,
} from "@ag-ui/client";
import { AbstractAgent, EventType, PROTOCOL_VERSION } from "@ag-ui/client";
import type { AgentCapabilities } from "@ag-ui/core";
import type {
  AnyTextAdapter,
  AnyTool,
  ChatMCPOptions,
  SystemPrompt,
  ToolChoice,
} from "@tanstack/ai";
import type { TextActivityOptions } from "@tanstack/ai/adapters";
import { Observable } from "rxjs";
import { randomUUID, schemaToJsonSchema } from "@copilotkit/shared";
import type {
  InferSchemaOutput,
  ModelHostClass,
  StandardSchemaV1,
} from "@copilotkit/shared";
import { convertAISDKStream, formatToolError } from "./converters/aisdk";
import {
  convertInputToTanStackAI,
  convertTanStackStream,
} from "./converters/tanstack";
import {
  collectStandardRunFinishedDetails,
  isRecord,
} from "./converters/usage";
import type { AgentRunFinishedDetails } from "./converters/usage";
import { SkillRegistry } from "../runtime/intelligence-platform/skill-registry";
import {
  prepareLearnedSkills,
  assertNoSkillToolConflicts,
} from "./learned-skills";
import type {
  BuiltInAgentLearnedSkills,
  BuiltInAgentLearnedSkillsOptions,
} from "./learned-skills";
import { assertTextAdapter } from "./model";
import {
  assertFrontendToolSchemas,
  STATE_TOOLS,
  withClassicToolRules,
} from "./classic-tools";

export type {
  BuiltInAgentLearnedSkills,
  BuiltInAgentLearnedSkillsOptions,
} from "./learned-skills";
export { isAISDKLanguageModel } from "./model";

/**
 * Properties that a run's `forwardedProps` can override, when the agent lists
 * them in `overridableProperties`:
 *
 * - `model`: a model name, such as `"fast"`. The agent's `resolveModel`
 *   turns it into an adapter.
 * - `toolChoice`: `"auto"`, `"none"`, `"required"`, or
 *   `{ type: "tool", name }`.
 * - `prompt`: the agent's prompt, as a string.
 * - `modelOptions`: replaces the configured `modelOptions` object.
 */
export type OverridableProperty =
  | "model"
  | "toolChoice"
  | "prompt"
  | "modelOptions";

/**
 * Thrown by `AgentFactoryContext.interrupt()` on a fresh (non-resume) run to
 * pause the factory. Caught in `runFactory` and translated into a RUN_FINISHED
 * event carrying `outcome:{type:"interrupt",interrupts}`. Not a real error.
 */
export class InterruptSignal extends Error {
  constructor(public readonly interrupts: Interrupt[]) {
    super("CopilotKit interrupt: run paused awaiting human input");
    this.name = "InterruptSignal";
  }
}

/**
 * The CopilotKit settings of a `defineTool()` tool. They live in the tool's
 * `metadata.copilotkit`, which TanStack AI passes through without reading.
 */
export type CopilotKitToolSettings = {
  /**
   * When true, calling this tool pauses the run and emits a standard AG-UI
   * interrupt (RUN_FINISHED outcome:interrupt) keyed by the tool call's id.
   * The human response (resume payload) is injected as this tool call's result
   * on the resume run. Interrupt tools must NOT define `execute`: a tool call
   * with no executor ends the run, even with a multi-step limit.
   */
  interrupt?: boolean;
  /** Optional categorical reason surfaced on the Interrupt (default: "tool_call"). */
  interruptReason?: string;
  /** Optional human-readable prompt surfaced on the Interrupt. */
  interruptMessage?: string;
};

/**
 * A tool made with `defineTool()`. It is a TanStack AI server tool as a plain
 * object, so it works in the BuiltInAgent `tools`, in your own `chat()` call,
 * and in a `type: "tanstack"` factory.
 *
 * - `inputSchema` is the JSON Schema of the tool's parameters.
 * - `execute` validates its arguments with the parameters schema first, then
 *   calls your `execute` with the parsed output.
 * - `metadata.copilotkit` holds the interrupt settings.
 */
export type ToolDefinition<
  TParameters extends StandardSchemaV1 = StandardSchemaV1,
> = {
  __toolSide: "server";
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /**
   * Server-side executor. Not set for interrupt tools, which pause the run
   * instead of executing.
   */
  execute?: (
    args: StandardSchemaV1.InferInput<TParameters>,
  ) => Promise<unknown>;
  metadata: { copilotkit: CopilotKitToolSettings };
};

/**
 * Defines a server tool for BuiltInAgent, or for any TanStack AI `chat()`
 * call.
 *
 * The parameters become the tool's JSON Schema, which the model sees. Before
 * `execute` runs, the arguments go through the schema's own Standard Schema
 * validation, so `execute` gets the parsed output (for example with Zod
 * defaults applied). Arguments that fail the schema, and errors that `execute`
 * throws, become the tool's error result.
 *
 * A tool without `execute` (an interrupt tool) has no executor, so `chat()`
 * stops the run when the model calls it.
 *
 * @param config.name - The name of the tool.
 * @param config.description - What the tool does, for the model.
 * @param config.parameters - Schema for the tool's input parameters (any
 *   Standard Schema V1 library that can describe itself as JSON Schema: Zod,
 *   Valibot, ArkType, etc.).
 * @param config.execute - Runs the tool server-side with the parsed arguments.
 * @param config.interrupt - Pause the run for human input instead of
 *   executing. See {@link CopilotKitToolSettings}.
 * @throws Error when the parameters schema cannot describe itself as JSON
 *   Schema.
 *
 * ```ts
 * const weather = defineTool({
 *   name: "get_weather",
 *   description: "Get the weather for a city.",
 *   parameters: z.object({ city: z.string() }),
 *   execute: async ({ city }) => ({ city, temperature: 21 }),
 * });
 * ```
 */
export function defineTool<TParameters extends StandardSchemaV1>(
  config: {
    name: string;
    description: string;
    parameters: TParameters;
    execute?: (args: InferSchemaOutput<TParameters>) => Promise<unknown>;
  } & CopilotKitToolSettings,
) {
  const tool: ToolDefinition<TParameters> = {
    __toolSide: "server",
    name: config.name,
    description: config.description,
    inputSchema: schemaToJsonSchema(config.parameters),
    metadata: {
      copilotkit: {
        interrupt: config.interrupt,
        interruptReason: config.interruptReason,
        interruptMessage: config.interruptMessage,
      },
    },
  };
  const { execute, parameters } = config;
  if (!execute) return tool;

  const executeWithParsedArgs = async (args: unknown) => {
    const parsed = await parameters["~standard"].validate(args);
    if (!("value" in parsed) || parsed.issues) {
      const issues = parsed.issues ?? [];
      const details = issues.map((issue) => issue.message).join("; ");
      throw new Error(`Invalid arguments for tool ${config.name}: ${details}`);
    }
    // `validate` on a schema whose type is the generic `TParameters` resolves
    // to its constraint, so TypeScript types the output as `unknown`. It is
    // the schema's output.
    const value = parsed.value as InferSchemaOutput<TParameters>;
    try {
      return await execute(value);
    } catch (error) {
      throw new Error(formatToolError(error), { cause: error });
    }
  };
  tool.execute = executeWithParsedArgs;
  return tool;
}

/**
 * Context passed to the user-supplied factory function in factory mode.
 */
export interface AgentFactoryContext {
  /**
   * Verified skill catalog and TanStack AI server tools for this run; empty
   * when disabled or no skills exist. Pass the tools to TanStack `chat()` as
   * they are. For `streamText()`, convert them with `toAISDKTools` from
   * `@copilotkit/runtime/agent/ai-sdk`.
   */
  learnedSkills: BuiltInAgentLearnedSkills;
  input: RunAgentInput;
  /**
   * Prefer `abortSignal` for most use cases (AI SDK, fetch, custom backends).
   * Provided for backends like TanStack AI that require the full AbortController.
   * Do NOT call `.abort()` on this controller — use `abortRun()` on the agent instead.
   */
  abortController: AbortController;
  abortSignal: AbortSignal;
  /**
   * Pause the run for human input (AG-UI standard interrupt). On a fresh run
   * this throws an InterruptSignal (caught by the runtime) and the run finishes
   * with `outcome:{type:"interrupt",interrupts}`. On the resume run (when
   * `input.resume` covers these interrupts) it returns the matching ResumeEntry
   * responses so the factory can continue. Each `interrupts[i].id` is matched to
   * `input.resume[].interruptId`.
   */
  interrupt: (interrupts: Interrupt[]) => Promise<ResumeEntry[]>;
}

/** Public name that avoids the runtime's request-scoped AgentFactoryContext. */
export type BuiltInAgentFactoryContext = AgentFactoryContext;

/**
 * Factory config for AI SDK backend.
 * The factory must return an object with a `fullStream` async iterable
 * (compatible with the result of `streamText()` — only `fullStream` is consumed).
 *
 * `@copilotkit/runtime/agent/ai-sdk` has the helpers for the `streamText()`
 * call you own:
 *
 * - `convertMessagesToVercelAISDKMessages` and `convertToolsToVercelAITools`
 *   turn `ctx.input` into AI SDK messages and tools.
 * - `toAISDKTools` turns `ctx.learnedSkills.tools` into an AI SDK `ToolSet`.
 * - `createSafeUrlDownload({ signal: ctx.abortSignal })`, passed as
 *   `experimental_download`, keeps the server from fetching internal
 *   addresses named in request attachments, and stops the downloads when the
 *   run is aborted.
 */
export interface BuiltInAgentAISDKFactoryConfig {
  /** Opt in to automatic snapshot acquisition before each run, including resumes. */
  learnedSkills?: BuiltInAgentLearnedSkillsOptions;
  type: "aisdk";
  factory: (
    ctx: AgentFactoryContext,
  ) =>
    | { fullStream: AsyncIterable<unknown> }
    | Promise<{ fullStream: AsyncIterable<unknown> }>;
}

/**
 * Factory config for TanStack AI backend.
 * The factory must return an async iterable of TanStack AI stream chunks.
 */
export interface BuiltInAgentTanStackFactoryConfig {
  /** Opt in to automatic snapshot acquisition before each run, including resumes. */
  learnedSkills?: BuiltInAgentLearnedSkillsOptions;
  type: "tanstack";
  factory: (
    ctx: AgentFactoryContext,
  ) => AsyncIterable<unknown> | Promise<AsyncIterable<unknown>>;
}

/**
 * Factory config for a custom backend that directly yields AG-UI events.
 */
export interface BuiltInAgentCustomFactoryConfig {
  /** Opt in to automatic snapshot acquisition before each run, including resumes. */
  learnedSkills?: BuiltInAgentLearnedSkillsOptions;
  type: "custom";
  factory: (
    ctx: AgentFactoryContext,
  ) => AsyncIterable<BaseEvent> | Promise<AsyncIterable<BaseEvent>>;
}

/**
 * Union of all factory-mode configurations.
 */
export type BuiltInAgentFactoryConfig =
  | BuiltInAgentAISDKFactoryConfig
  | BuiltInAgentTanStackFactoryConfig
  | BuiltInAgentCustomFactoryConfig;

/**
 * The TanStack AI `chat()` options for a text adapter, as `chat()` types them
 * for a streamed run without an output schema.
 */
type ChatOptionsFor<
  TAdapter extends AnyTextAdapter,
  TContext,
> = TextActivityOptions<TAdapter, undefined, true, TContext>;

/**
 * The TanStack AI `chat()` options that BuiltInAgent's classic config takes
 * next to `model`. Their types come from the adapter in `model`, the same way
 * `chat({ adapter, ... })` types them:
 *
 * - `modelOptions`: the provider options of the adapter.
 * - `reasoning`: only the levels the model has.
 * - `tools`: server tools (`defineTool()`, `toolDefinition().server()`) and
 *   the provider tools that the model supports, such as `webSearchTool` from
 *   `@tanstack/ai-openai/tools`.
 * - `systemPrompts`: strings, or `{ content, metadata }` with the metadata
 *   the adapter accepts.
 * - `middleware` and `context`: the hooks get the type of `context` as
 *   `ctx.context`.
 *
 * The agent passes these to `chat()` on each run. See the TanStack AI docs of
 * `chat()` for each option.
 */
export type BuiltInAgentChatOptions<
  TAdapter extends AnyTextAdapter = AnyTextAdapter,
  TContext = unknown,
> = Pick<
  ChatOptionsFor<TAdapter, TContext>,
  | "promptCache"
  | "retry"
  | "wrapFetch"
  | "middleware"
  | "context"
  | "toolExecution"
  | "lazyToolsConfig"
  | "metadata"
  | "debug"
  | "agentLoopStrategy"
  | "repairToolInput"
  | "modelOptions"
  | "toolChoice"
  | "tools"
> & {
  /**
   * How hard the model thinks: a level, or `{ level, summary?,
   * budgetTokens? }`. Only the levels the model has are accepted. A model
   * that does not reason takes no `reasoning`.
   */
  reasoning?: NeverAsUndefined<ChatOptionsFor<TAdapter, TContext>["reasoning"]>;
  /**
   * More system prompts, after `prompt`: strings, or `{ content, metadata }`
   * with the metadata the adapter accepts (for example Anthropic
   * `cache_control`). An adapter without system prompt metadata takes
   * strings and `{ content }` only.
   */
  systemPrompts?: Array<
    SystemPrompt<NeverAsUndefined<TAdapter["~types"]["systemPromptMetadata"]>>
  >;
};

/**
 * `undefined` in place of `never`. TanStack AI types an option `never` when
 * the model does not support it (`reasoning` on a model that does not
 * reason, system prompt `metadata` on an adapter without any). As `undefined`,
 * the option still takes no value, and a config written for any adapter can
 * be spread into a config for such a model.
 */
type NeverAsUndefined<T> = [T] extends [never] ? undefined : T;

/**
 * A model that `resolveModel` picked for one run, with the options for it:
 *
 * - `adapter`: the TanStack AI text adapter.
 * - `modelOptions`: replaces the configured `modelOptions` for this run.
 * - `reasoning`: replaces the configured `reasoning` for this run.
 *
 * TanStack AI's `createChatOptions({ adapter, modelOptions, reasoning })`
 * returns this shape, typed by that adapter.
 */
export type ResolvedModelOptions = Pick<
  ChatOptionsFor<AnyTextAdapter, unknown>,
  "adapter" | "modelOptions" | "reasoning"
>;

/**
 * Classic config: BuiltInAgent runs the model with TanStack AI `chat()` and
 * handles tools, MCP, state tools, and the system prompt.
 *
 * Install `@tanstack/ai` and the adapter package for your provider, for
 * example `@tanstack/ai-openai`.
 *
 * Next to the CopilotKit settings below, it takes the `chat()` options in
 * {@link BuiltInAgentChatOptions}, typed by the adapter in `model`:
 *
 * ```ts
 * new BuiltInAgent({
 *   model: openaiText("gpt-5.2"),
 *   reasoning: { level: "high", summary: true },
 *   modelOptions: { text: { verbosity: "low" } },
 *   tools: [refund, webSearchTool({ type: "web_search" })],
 *   retry: { maxRetries: 3 },
 * });
 * ```
 *
 * The agent sets the run's `messages`, `threadId`, `abortController`, and
 * `stream` itself, so the config has no such keys.
 *
 * @typeParam TAdapter - The adapter type, inferred from `model`.
 * @typeParam TContext - The type of `context`, inferred from it. The
 *   `middleware` hooks get it as `ctx.context`.
 */
export interface BuiltInAgentClassicConfig<
  TAdapter extends AnyTextAdapter = AnyTextAdapter,
  TContext = unknown,
> extends BuiltInAgentChatOptions<TAdapter, TContext> {
  /** Opt in to automatic snapshot acquisition before each run, including resumes. */
  learnedSkills?: BuiltInAgentLearnedSkillsOptions;
  /**
   * The model, as a TanStack AI text adapter, for example
   * `openaiText("gpt-5")` from `@tanstack/ai-openai`. The adapter holds its
   * own API key and base URL.
   */
  model: TAdapter;
  /**
   * Turns a forwarded model name into a model, when `"model"` is in
   * `overridableProperties`. It returns one of these:
   *
   * - An adapter. The run uses the configured `modelOptions` and
   *   `reasoning` with it.
   * - `{ adapter, modelOptions?, reasoning? }`. Its `modelOptions` and
   *   `reasoning` replace the configured ones for this run. Build it with
   *   TanStack AI's `createChatOptions()` to type the options by that
   *   adapter.
   * - `undefined`, for a name you do not accept. The run then uses `model`.
   *
   * The configured `tools`, provider tools included, do not change.
   *
   * @example
   * ```ts
   * new BuiltInAgent({
   *   model: openaiText("gpt-5"),
   *   overridableProperties: ["model"],
   *   resolveModel: (name) =>
   *     name === "deep"
   *       ? createChatOptions({
   *           adapter: openaiText("gpt-5.2"),
   *           reasoning: "high",
   *           modelOptions: { text: { verbosity: "low" } },
   *         })
   *       : undefined,
   * });
   * ```
   */
  resolveModel?: (
    name: string,
  ) => AnyTextAdapter | ResolvedModelOptions | undefined;
  /**
   * Maximum number of model calls in one run. Tools that the last call asks
   * for still run. Default: 1, or 10 when learned skills are available.
   * `agentLoopStrategy`, when set, is used instead.
   */
  maxSteps?: number;
  /**
   * The agent's system prompt. The frontend can replace it when `"prompt"`
   * is in `overridableProperties`. It goes after the learned-skills catalog
   * and before `systemPrompts`.
   */
  prompt?: string;
  /**
   * List of properties that can be overridden by forwardedProps.
   */
  overridableProperties?: OverridableProperty[];
  /**
   * MCP servers whose tools the agent offers to the model, as TanStack AI's
   * `chat()` `mcp` option. On each run, `chat()` reads the tools of each
   * client in `clients`.
   *
   * - `connection`: the agent sets `"keep-alive"` unless you set it. The
   *   clients in the config are used by every run, so the agent does not
   *   close them. Close them yourself when your server shuts down. With
   *   `"close"`, `chat()` closes them when the first run ends.
   * - `lazyTools`: read the tool schemas only when the model needs them.
   * - `onDiscoveryError`: called when one client fails to list its tools.
   *   Return to skip that client, or throw to fail the run. Without it, the
   *   error fails the run.
   *
   * Tool names must be unique. If two MCP servers have a tool with the same
   * name, or an MCP tool has the name of an app or frontend tool, the run
   * fails. Give a client a `prefix` to keep its tool names apart.
   *
   * ```typescript
   * import { createMCPClient } from "@tanstack/ai-mcp";
   *
   * const client = await createMCPClient({
   *   transport: { type: "http", url: "https://mcp.example.com/mcp" },
   * });
   * const agent = new BuiltInAgent({
   *   model: openaiText("gpt-5"),
   *   mcp: { clients: [client] },
   * });
   * ```
   */
  mcp?: ChatMCPOptions;
  /**
   * Forward system-role messages from input to the LLM, as system prompts.
   * Default: false
   */
  forwardSystemMessages?: boolean;
  /**
   * Forward developer-role messages from input to the LLM, as system prompts.
   * Default: false
   */
  forwardDeveloperMessages?: boolean;
  /**
   * Explicit agent capabilities. **Shallow-merged** at the category level on
   * top of auto-inferred defaults — providing a category (e.g. `tools`)
   * replaces that entire category, not individual fields within it.
   *
   * For example, `{ tools: { supported: true } }` will drop the inferred
   * `clientProvided` value. Include all fields for any category you override.
   */
  capabilities?: Partial<AgentCapabilities>;
}

/**
 * Configuration for BuiltInAgent.
 *
 * Two modes:
 * - **Classic** (model + params): BuiltInAgent handles everything — the TanStack AI `chat()` call, tools, MCP, state tools.
 * - **Factory** (type + factory): You own the LLM call. BuiltInAgent handles lifecycle only.
 */
export type BuiltInAgentConfiguration<
  TAdapter extends AnyTextAdapter = AnyTextAdapter,
  TContext = unknown,
> = BuiltInAgentClassicConfig<TAdapter, TContext> | BuiltInAgentFactoryConfig;

/**
 * Type guard: returns true if this is a factory-mode config.
 */
function isFactoryConfig(
  config: BuiltInAgentConfiguration,
): config is BuiltInAgentFactoryConfig {
  return "factory" in config;
}

/**
 * A `forwardedProps.toolChoice` value as a TanStack AI tool choice, or
 * `undefined` when it is not one. `{ type: "tool", toolName }` is accepted
 * as well as `{ type: "tool", name }`.
 */
function toToolChoice(value: unknown) {
  if (value === "auto" || value === "required" || value === "none") {
    return value;
  }
  if (!isRecord(value) || value.type !== "tool") return undefined;
  const name = typeof value.name === "string" ? value.name : value.toolName;
  return typeof name === "string" ? { type: "tool" as const, name } : undefined;
}

/**
 * Splits `input.resume` for a classic run.
 *
 * - `approvals`: the entries that answer a call of a `needsApproval` config
 *   tool, under the interrupt id `chat()` gave that call
 *   (`approval_<toolCallId>`). `chat()` then runs the tool on approve, and
 *   skips it on reject or cancel.
 * - `toolResults`: the other entries. They go back to the model as tool
 *   results.
 * - `messages`: the history without a tool message the client added for an
 *   approval in this resume. `chat()` would read that message as the tool's
 *   result and not run the tool.
 */
function splitApprovalResume(input: RunAgentInput, tools: readonly AnyTool[]) {
  const approvalTools = new Set(
    tools.filter((tool) => tool.needsApproval).map((tool) => tool.name),
  );
  const approvalCallIds = new Set(
    input.messages.flatMap((message) =>
      message.role === "assistant"
        ? (message.toolCalls ?? [])
            .filter((call) => approvalTools.has(call.function.name))
            .map((call) => call.id)
        : [],
    ),
  );
  const approvals: ResumeEntry[] = [];
  const toolResults: ResumeEntry[] = [];
  for (const entry of input.resume ?? []) {
    if (approvalCallIds.has(entry.interruptId)) {
      approvals.push({
        ...entry,
        interruptId: `approval_${entry.interruptId}`,
      });
    } else {
      toolResults.push(entry);
    }
  }
  const resumedCallIds = new Set(
    approvals.map((entry) => entry.interruptId.slice("approval_".length)),
  );
  const messages = input.messages.filter(
    (message) =>
      !(message.role === "tool" && resumedCallIds.has(message.toolCallId)),
  );
  return { approvals, toolResults, messages };
}

/**
 * The `chat()` options of a classic config that the agent passes to `chat()`
 * as they are. It leaves out the CopilotKit settings, and the options that
 * the agent merges or replaces on each run (`systemPrompts`, `tools`,
 * `toolChoice`, `modelOptions`, `reasoning`, `agentLoopStrategy`,
 * `repairToolInput`). Keys the config does not set stay out.
 */
function passThroughChatOptions(config: BuiltInAgentClassicConfig) {
  // An allowlist, not a rest spread: a JavaScript caller that sets a key the
  // agent owns (`outputSchema`, `state`, `resume`, `runId`, ...) must not
  // reach chat().
  const {
    promptCache,
    retry,
    wrapFetch,
    middleware,
    context,
    toolExecution,
    lazyToolsConfig,
    metadata,
    debug,
  } = config;
  return {
    promptCache,
    retry,
    wrapFetch,
    middleware,
    context,
    toolExecution,
    lazyToolsConfig,
    metadata,
    debug,
  };
}

/**
 * An AG-UI agent that runs a model with TanStack AI `chat()` (classic config),
 * or runs your own LLM call (factory config).
 *
 * @typeParam TAdapter - The adapter type of a classic config, inferred from
 *   `model`. It types the `chat()` options of the config.
 * @typeParam TContext - The type of the classic config's `context`, inferred
 *   from it.
 *
 * ```ts
 * const agent = new BuiltInAgent({
 *   model: openaiText("gpt-5.2"),
 *   prompt: "You are a helpful assistant.",
 *   reasoning: "low",
 * });
 * ```
 */
export class BuiltInAgent<
  TAdapter extends AnyTextAdapter = AnyTextAdapter,
  TContext = unknown,
> extends AbstractAgent {
  private abortController?: AbortController;
  private skillRegistry?: SkillRegistry;

  /** Whether this agent already warned about an unresolved model override. */
  private warnedUnresolvedModel = false;

  /**
   * Which vendor this agent's model reaches, read by the SSE layer onto
   * `agent_execution_stream_*` telemetry. Always `"unknown"`: a TanStack AI
   * adapter keeps its base URL private, and a factory config owns its own
   * LLM call.
   */
  readonly modelHostClass: ModelHostClass = "unknown";

  /**
   * @throws Error when a classic config's `model` is a model string or an AI
   *   SDK model object. Pass a TanStack AI text adapter, or run AI SDK models
   *   with a `type: "aisdk"` factory.
   */
  constructor(private config: BuiltInAgentConfiguration<TAdapter, TContext>) {
    super();
    if (!isFactoryConfig(config)) assertTextAdapter(config.model);
    this.skillRegistry =
      config.learnedSkills === undefined
        ? undefined
        : new SkillRegistry(config.learnedSkills);
  }

  /**
   * Check if a property can be overridden by forwardedProps
   */
  canOverride(property: OverridableProperty): boolean {
    if (isFactoryConfig(this.config)) return false;
    return this.config?.overridableProperties?.includes(property) ?? false;
  }

  /**
   * The `forwardedProps` values this run may use, one per property in
   * `overridableProperties`. A value of the wrong shape is ignored.
   */
  private forwardedOverrides(forwardedProps: unknown) {
    const props = isRecord(forwardedProps) ? forwardedProps : {};
    const model =
      typeof props.model === "string" && this.canOverride("model")
        ? props.model
        : undefined;
    const toolChoice: ToolChoice | undefined = this.canOverride("toolChoice")
      ? toToolChoice(props.toolChoice)
      : undefined;
    const prompt =
      typeof props.prompt === "string" && this.canOverride("prompt")
        ? props.prompt
        : undefined;
    const modelOptions =
      isRecord(props.modelOptions) && this.canOverride("modelOptions")
        ? props.modelOptions
        : undefined;
    return { model, toolChoice, prompt, modelOptions };
  }

  /**
   * The model for this run: the forwarded model name through `resolveModel`,
   * else the configured `model`. Returns the adapter with the `modelOptions`
   * and `reasoning` to use with it. An override that does not resolve logs
   * one warning per agent.
   *
   * @throws Error when `resolveModel` returns a model string or an AI SDK
   *   model object.
   */
  private modelFor(
    config: BuiltInAgentClassicConfig,
    modelName: string | undefined,
  ) {
    const configured = {
      adapter: config.model,
      modelOptions: config.modelOptions,
      reasoning: config.reasoning,
    };
    if (modelName === undefined) return configured;
    const resolved = config.resolveModel?.(modelName);
    if (resolved) {
      const source = `resolveModel(${JSON.stringify(modelName)})`;
      assertTextAdapter(resolved, source);
      if (!("adapter" in resolved)) return { ...configured, adapter: resolved };
      assertTextAdapter(resolved.adapter, source);
      return resolved;
    }
    if (!this.warnedUnresolvedModel) {
      this.warnedUnresolvedModel = true;
      const reason = config.resolveModel
        ? "resolveModel returned undefined for it"
        : "the agent has no resolveModel";
      console.warn(
        `[CopilotKit] Ignoring the forwarded model ${JSON.stringify(modelName)}: ${reason}. The run uses the configured model adapter.`,
      );
    }
    return configured;
  }

  async getCapabilities(): Promise<AgentCapabilities> {
    const inferred: AgentCapabilities = {
      tools: {
        supported: true,
        clientProvided: true,
      },
      transport: {
        streaming: true,
      },
      humanInTheLoop: {
        interrupts: true,
      },
    };

    // Factory-mode configs have no `capabilities` property.
    const capabilities = isFactoryConfig(this.config)
      ? undefined
      : this.config.capabilities;

    if (!capabilities) {
      return inferred;
    }

    // Shallow merge at the category level — explicit overrides replace
    // entire categories when provided, inferred defaults fill the rest.
    return {
      ...inferred,
      ...capabilities,
    };
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    if (isFactoryConfig(this.config)) {
      return this.runFactory(input, this.config);
    }

    // Capture the narrowed classic config — the narrowing of `this.config`
    // above does not survive into the Observable/async closures below. The
    // run reads it with the default type arguments: `chat()` gets a model
    // that `resolveModel` may have picked, so its options are typed for any
    // adapter.
    const config: BuiltInAgentClassicConfig = this.config;

    if (this.abortController) {
      throw new Error(
        "Agent is already running. Call abortRun() first or create a new instance.",
      );
    }

    // Set synchronously before Observable creation to close TOCTOU window
    this.abortController = new AbortController();
    const abortController = this.abortController;
    const signal = abortController.signal;

    return new Observable<BaseEvent>((subscriber) => {
      const startEvent: RunStartedEvent = {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
        // AG-UI 1.0: a producer states its own protocol version.
        protocolVersion: PROTOCOL_VERSION,
      };
      subscriber.next(startEvent);

      void (async () => {
        const runFinishedDetails: AgentRunFinishedDetails = {};
        const pendingInterrupts: Interrupt[] = [];
        try {
          const overrides = this.forwardedOverrides(input.forwardedProps);
          const model = this.modelFor(config, overrides.model);
          const prompt = overrides.prompt ?? config.prompt;
          const configSystemPrompts = config.systemPrompts ?? [];
          // The classic converter joins `prompt` with the context and state
          // into one system prompt. Config `systemPrompts` go between the
          // two, so with them the prompt is sent on its own.
          const promptJoinsContext = configSystemPrompts.length === 0;

          assertFrontendToolSchemas(input.tools ?? []);
          const resume = splitApprovalResume(input, config.tools ?? []);
          const converted = convertInputToTanStackAI(
            { ...input, messages: resume.messages },
            {
              forwardSystemMessages: config.forwardSystemMessages ?? false,
              forwardDeveloperMessages:
                config.forwardDeveloperMessages ?? false,
              prompt: promptJoinsContext ? prompt : undefined,
              resume: resume.toolResults,
              keepToolResultMedia: true,
              format: "classic",
            },
          );

          const learnedSkills = await prepareLearnedSkills(
            this.skillRegistry,
            signal,
          );
          signal.throwIfAborted();
          const promptOnItsOwn = !promptJoinsContext && prompt ? [prompt] : [];
          const systemPrompts = [
            ...(learnedSkills.catalog ? [learnedSkills.catalog] : []),
            ...promptOnItsOwn,
            ...configSystemPrompts,
            ...converted.systemPrompts,
          ];

          // Frontend tools, then config tools, then the state tools. A later
          // tool replaces an earlier one with the same name.
          const ownTools: AnyTool[] = [
            ...converted.tools,
            ...(config.tools ?? []),
            ...STATE_TOOLS,
          ];
          const appTools = [
            ...new Map(ownTools.map((tool) => [tool.name, tool])).values(),
          ];
          if (this.skillRegistry) {
            assertNoSkillToolConflicts(appTools);
            appTools.push(...learnedSkills.tools);
          }

          // @tanstack/ai is ESM-only, so the CommonJS build cannot require()
          // it. A literal import() loads it from both builds, and bundlers
          // and output tracing still follow it.
          const { chat, maxIterations } = await import("@tanstack/ai");
          const stream = chat({
            ...passThroughChatOptions(config),
            // The keys below are the agent's. They come after the config's
            // options, so a config key of the same name cannot replace them.
            adapter: model.adapter,
            messages: converted.messages,
            systemPrompts,
            tools: appTools,
            // chat() adds the MCP tools after these. Config clients serve
            // every run, so chat() keeps them open unless the config says
            // otherwise.
            ...(config.mcp
              ? { mcp: { connection: "keep-alive" as const, ...config.mcp } }
              : {}),
            toolChoice: overrides.toolChoice ?? config.toolChoice,
            modelOptions: overrides.modelOptions ?? model.modelOptions,
            reasoning: model.reasoning,
            // Loading a skill must leave room for a model step that uses it.
            agentLoopStrategy:
              config.agentLoopStrategy ??
              maxIterations(
                config.maxSteps || (learnedSkills.catalog ? 10 : 1),
              ),
            // Arguments that fail a tool's schema go back to the model as an
            // error result, without an attempt to repair them first.
            repairToolInput: config.repairToolInput ?? false,
            abortController,
            threadId: input.threadId,
            // chat() runs or skips an approved tool itself. It needs the id of
            // the run that paused, and the interrupt ids it issued for it.
            ...(resume.approvals.length > 0
              ? {
                  resume: resume.approvals,
                  parentRunId: input.parentRunId ?? input.runId,
                }
              : {}),
            stream: true,
          });

          const events = convertTanStackStream(
            withClassicToolRules(stream, config.tools ?? [], pendingInterrupts),
            signal,
            pendingInterrupts,
            input.state,
            runFinishedDetails,
          );
          for await (const event of events) {
            subscriber.next(event);
          }

          if (signal.aborted) {
            // A stopped run is cancelled, not a success. A client that
            // declares no protocolVersion predates 1.0 and cannot parse the
            // cancelled outcome, so it keeps the plain event.
            const cancelledEvent: RunFinishedEvent = {
              type: EventType.RUN_FINISHED,
              threadId: input.threadId,
              runId: input.runId,
              ...(input.protocolVersion !== undefined
                ? { outcome: { type: "cancelled" as const } }
                : {}),
            };
            subscriber.next(cancelledEvent);
          } else {
            const finishedEvent = {
              type: EventType.RUN_FINISHED,
              threadId: input.threadId,
              runId: input.runId,
              ...runFinishedDetails,
              ...(pendingInterrupts.length > 0
                ? {
                    outcome: {
                      type: "interrupt",
                      interrupts: pendingInterrupts,
                    },
                  }
                : {}),
            } as RunFinishedEvent;
            subscriber.next(finishedEvent);
          }
          subscriber.complete();
        } catch (error) {
          if (signal.aborted) {
            subscriber.complete();
          } else {
            const runErrorEvent: RunErrorEvent = {
              type: EventType.RUN_ERROR,
              message: error instanceof Error ? error.message : String(error),
              threadId: input.threadId,
              runId: input.runId,
            } as RunErrorEvent;
            subscriber.next(runErrorEvent);
            subscriber.error(error);
          }
        } finally {
          if (this.abortController === abortController)
            this.abortController = undefined;
        }
      })();

      // Cleanup function
      return () => {
        abortController.abort();
        if (this.abortController === abortController)
          this.abortController = undefined;
      };
    });
  }

  private runFactory(
    input: RunAgentInput,
    config: BuiltInAgentFactoryConfig,
  ): Observable<BaseEvent> {
    if (this.abortController) {
      throw new Error(
        "Agent is already running. Call abortRun() first or create a new instance.",
      );
    }

    // Set synchronously before Observable creation to close TOCTOU window
    this.abortController = new AbortController();
    const controller = this.abortController;

    return new Observable<BaseEvent>((subscriber) => {
      const startEvent: RunStartedEvent = {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
        // AG-UI 1.0: a producer states its own protocol version.
        protocolVersion: PROTOCOL_VERSION,
      };
      subscriber.next(startEvent);

      const ctx: Omit<AgentFactoryContext, "learnedSkills"> = {
        input,
        abortController: controller,
        abortSignal: controller.signal,
        interrupt: async (interrupts: Interrupt[]) => {
          const resume = input.resume ?? [];
          const ids = new Set(interrupts.map((i) => i.id));
          const matching = resume.filter((r) => ids.has(r.interruptId));
          // All requested interrupts addressed → resume: return responses.
          if (interrupts.length > 0 && matching.length === interrupts.length) {
            return matching;
          }
          // Fresh run (or not yet addressed) → pause.
          throw new InterruptSignal(interrupts);
        },
      };

      void (async () => {
        const runFinishedDetails: AgentRunFinishedDetails = {};
        try {
          // Resume injection (aisdk/tanstack): map each ResumeEntry to a tool-role
          // message keyed by interruptId (=== the paused tool call's id) and append
          // it to the messages the factory sees. Both SDK converters
          // (convertMessagesToVercelAISDKMessages / convertInputToTanStackAI) turn a
          // tool-role message into that SDK's native tool-result, so the model
          // continues — no SDK-specific approval-response wiring needed. The `custom`
          // factory reads input.resume itself via ctx.interrupt(), so leave it alone.
          // Idempotent: skip entries the client already recorded as a tool-result
          // message in the thread (useInterrupt persists resolutions so the
          // conversation stays well-formed across turns). Only synthesize results
          // for entries that aren't already answered, so we never double-answer a
          // tool call.
          const toolCallIds = new Set(
            input.messages.flatMap((message) =>
              message.role === "assistant"
                ? (message.toolCalls ?? []).map((call) => call.id)
                : [],
            ),
          );
          const answeredToolMessages = input.messages.filter(
            (message): message is ToolMessage => message.role === "tool",
          );
          const answeredToolCallIds = new Set(
            answeredToolMessages.map((message) => message.toolCallId),
          );
          const nativeResume =
            config.type === "custom" ? [] : (input.resume ?? []);
          const resumeToolMessages: ToolMessage[] = [];
          const decisionsByCall = new Map<string, string>();
          for (const entry of nativeResume) {
            if (!toolCallIds.has(entry.interruptId)) continue;
            const content = JSON.stringify(
              entry.status === "cancelled"
                ? { status: "cancelled" }
                : (entry.payload ?? { status: "resolved" }),
            );
            if (decisionsByCall.has(entry.interruptId)) {
              if (decisionsByCall.get(entry.interruptId) !== content) {
                throw new Error(
                  `Conflicting decisions for resumed tool call ${entry.interruptId}`,
                );
              }
              continue;
            }
            decisionsByCall.set(entry.interruptId, content);
            if (answeredToolCallIds.has(entry.interruptId)) continue;
            resumeToolMessages.push({
              id: randomUUID(),
              role: "tool",
              toolCallId: entry.interruptId,
              content,
            });
          }
          const resumedIds = new Set(
            nativeResume.map((entry) => entry.interruptId),
          );
          const resumedResults = new Map(
            [...answeredToolMessages, ...resumeToolMessages]
              .filter((message) => resumedIds.has(message.toolCallId))
              .map((message) => [message.toolCallId, message.content]),
          );
          // Save accepted answers before model work, so Stop cannot discard them.
          for (const message of resumeToolMessages) {
            const event: ToolCallResultEvent = {
              type: EventType.TOOL_CALL_RESULT,
              messageId: message.id,
              toolCallId: message.toolCallId,
              role: "tool",
              content: message.content,
            };
            subscriber.next(event);
          }
          const factoryInput: RunAgentInput =
            resumeToolMessages.length > 0 && config.type !== "custom"
              ? {
                  ...input,
                  messages: [...input.messages, ...resumeToolMessages],
                }
              : input;

          const learnedSkills = await prepareLearnedSkills(
            this.skillRegistry,
            controller.signal,
          );
          controller.signal.throwIfAborted();
          const factoryCtx: AgentFactoryContext = {
            ...ctx,
            input: factoryInput,
            learnedSkills,
          };
          let events: AsyncIterable<BaseEvent>;
          let customRunFinishedEvent: RunFinishedEvent | undefined;
          // Filled by the converters with one Interrupt per native approval
          // request; a non-empty array after the stream drains pauses the run.
          const pendingInterrupts: Interrupt[] = [];

          switch (config.type) {
            case "aisdk": {
              const result = await config.factory(factoryCtx);
              events = convertAISDKStream(
                result.fullStream,
                controller.signal,
                pendingInterrupts,
                input.state,
                runFinishedDetails,
              );
              break;
            }
            case "tanstack": {
              const stream = await config.factory(factoryCtx);
              events = convertTanStackStream(
                stream,
                controller.signal,
                pendingInterrupts,
                input.state,
                runFinishedDetails,
              );
              break;
            }
            case "custom": {
              events = await config.factory(factoryCtx);
              break;
            }
            default: {
              const _exhaustive: never = config;
              throw new Error(
                `Unknown agent config type: ${(_exhaustive as BuiltInAgentFactoryConfig).type}`,
              );
            }
          }

          for await (const event of events) {
            if (
              event.type === EventType.TOOL_CALL_RESULT &&
              "toolCallId" in event &&
              typeof event.toolCallId === "string" &&
              "content" in event &&
              resumedResults.has(event.toolCallId)
            ) {
              if (resumedResults.get(event.toolCallId) !== event.content) {
                throw new Error(
                  `Conflicting result for resumed tool call ${event.toolCallId}`,
                );
              }
              continue;
            }
            if (
              config.type === "custom" &&
              event.type === EventType.RUN_FINISHED
            ) {
              customRunFinishedEvent = event as RunFinishedEvent;
              collectStandardRunFinishedDetails(
                event as unknown as Record<string, unknown>,
                runFinishedDetails,
              );
              continue;
            }
            subscriber.next(event);
          }

          // A native approval request pauses the run: reuse the same
          // InterruptSignal path the `custom` factory's ctx.interrupt() uses,
          // which the catch below turns into RUN_FINISHED outcome:interrupt.
          if (pendingInterrupts.length > 0 && !controller.signal.aborted) {
            throw new InterruptSignal(pendingInterrupts);
          }

          if (!controller.signal.aborted) {
            const finishedEvent = {
              ...customRunFinishedEvent,
              type: EventType.RUN_FINISHED,
              threadId: input.threadId,
              runId: input.runId,
              ...runFinishedDetails,
            } as RunFinishedEvent;
            subscriber.next(finishedEvent);
          }
          subscriber.complete();
        } catch (error) {
          if (error instanceof InterruptSignal) {
            const finishedEvent = {
              type: EventType.RUN_FINISHED,
              threadId: input.threadId,
              runId: input.runId,
              ...runFinishedDetails,
              outcome: { type: "interrupt", interrupts: error.interrupts },
            } as RunFinishedEvent;
            subscriber.next(finishedEvent);
            subscriber.complete();
          } else if (controller.signal.aborted) {
            subscriber.complete();
          } else {
            const runErrorEvent: RunErrorEvent = {
              type: EventType.RUN_ERROR,
              message: error instanceof Error ? error.message : String(error),
              threadId: input.threadId,
              runId: input.runId,
            } as RunErrorEvent;
            subscriber.next(runErrorEvent);
            subscriber.error(error);
          }
        } finally {
          if (this.abortController === controller)
            this.abortController = undefined;
        }
      })();

      return () => {
        controller.abort();
        if (this.abortController === controller)
          this.abortController = undefined;
      };
    });
  }

  clone() {
    // Share the config and the skill registry with the original agent.
    const cloned = new BuiltInAgent({
      ...this.config,
      learnedSkills: undefined,
    });
    cloned.config = this.config;
    cloned.skillRegistry = this.skillRegistry;
    // clone() must preserve middleware chains.
    cloned.middlewares = [...this.middlewares];
    return cloned;
  }

  abortRun(): void {
    this.abortController?.abort();
  }
}

export { convertAISDKStream } from "./converters/aisdk";
export {
  convertTanStackStream,
  convertInputToTanStackAI,
} from "./converters/tanstack";
export type {
  TanStackChatMessage,
  TanStackInputOptions,
  TanStackInputResult,
} from "./converters/tanstack";
