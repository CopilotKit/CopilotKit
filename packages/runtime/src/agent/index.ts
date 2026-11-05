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
import type * as TanStackAI from "@tanstack/ai";
import type { AnyTextAdapter, AnyTool, ToolChoice } from "@tanstack/ai";
import type * as TanStackMCP from "@tanstack/ai-mcp";
import type {
  HttpTransportConfig,
  MCPClient,
  SseTransportConfig,
} from "@tanstack/ai-mcp";
import { Observable } from "rxjs";
import { randomUUID } from "@copilotkit/shared";
import type {
  InferSchemaOutput,
  ModelHostClass,
  StandardSchemaV1,
} from "@copilotkit/shared";
import { convertAISDKStream } from "./converters/aisdk";
import {
  convertInputToTanStackAI,
  convertTanStackStream,
} from "./converters/tanstack";
import {
  collectStandardRunFinishedDetails,
  isRecord,
} from "./converters/usage";
import type { AgentRunFinishedDetails } from "./converters/usage";
import { describeEndpoint } from "../runtime/handlers/shared/describe-endpoint";
import { SkillRegistry } from "../runtime/intelligence-platform/skill-registry";
import {
  prepareLearnedSkills,
  assertNoSkillToolConflicts,
} from "./learned-skills";
import type {
  BuiltInAgentLearnedSkills,
  BuiltInAgentLearnedSkillsOptions,
} from "./learned-skills";
import { mergeMCPTools, toToolNamePrefix } from "./mcp-tool-names";
import type { MCPToolSource } from "./mcp-tool-names";
import { assertNotAISDKModel, classifyModelSpec, resolveModel } from "./model";
import type { BuiltInAgentModel } from "./model";
import { loadOptionalPeer } from "./optional-peers";
import {
  STATE_TOOLS,
  toTanStackTools,
  withClassicToolRules,
} from "./classic-tools";

export type {
  BuiltInAgentLearnedSkills,
  BuiltInAgentLearnedSkillsOptions,
} from "./learned-skills";
export { resolveModel, classifyModelSpec, isAISDKLanguageModel } from "./model";
export type { BuiltInAgentModel, ModelSpecifier } from "./model";
export type {
  MCPClient,
  MCPClientOptions,
  HttpTransportConfig,
  SseTransportConfig,
  Transport as MCPTransport,
} from "@tanstack/ai-mcp";

/**
 * Properties that a run's `forwardedProps` can override, when the agent lists
 * them in `overridableProperties`:
 *
 * - `model`: a model string, such as `"anthropic/claude-sonnet-4-6"`.
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
 * MCP server reached over Streamable HTTP. The fields other than `name` are
 * the `@tanstack/ai-mcp` HTTP transport config: `url`, plus optional
 * `headers`, `fetch` (wrap it to add static and dynamic headers to each
 * request), and `authProvider`.
 */
export interface MCPClientConfigHTTP extends HttpTransportConfig {
  /**
   * Optional name for this server. When a tool name collides with another
   * MCP server's tool or with an app tool, the MCP tool is exposed as
   * `<name>_<tool>`. Without a name, the prefix is `mcp<N>`, where N is the
   * server's position among `mcpClients` and then `mcpServers`, from 1.
   * Give each server a different name: if a prefixed name is already in use,
   * a number is added (`<name>_<tool>_2`).
   */
  name?: string;
}

/**
 * MCP server reached over SSE. The fields other than `name` are the
 * `@tanstack/ai-mcp` SSE transport config: `url`, plus optional `headers`
 * (for example for authentication), `fetch`, and `authProvider`.
 */
export interface MCPClientConfigSSE extends SseTransportConfig {
  /**
   * Optional name for this server. When a tool name collides with another
   * MCP server's tool or with an app tool, the MCP tool is exposed as
   * `<name>_<tool>`. Without a name, the prefix is `mcp<N>`, where N is the
   * server's position among `mcpClients` and then `mcpServers`, from 1.
   * Give each server a different name: if a prefixed name is already in use,
   * a number is added (`<name>_<tool>_2`).
   */
  name?: string;
}

/**
 * MCP Client configuration
 */
export type MCPClientConfig = MCPClientConfigHTTP | MCPClientConfigSSE;

/**
 * A user-managed MCP client that provides tools to the agent.
 * The user is responsible for creating, configuring, and closing the client.
 * A client from `createMCPClient()` in `@tanstack/ai-mcp` fits this type.
 *
 * Unlike mcpServers, the agent does NOT create or close these clients.
 * This allows persistent connections, custom auth, and tool caching.
 */
export interface MCPClientProvider {
  /** Return TanStack AI tools to be merged into the agent's tools. */
  tools(): Promise<readonly AnyTool[]>;
}

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
 * Tool definition for BuiltInAgent
 */
export interface ToolDefinition<
  TParameters extends StandardSchemaV1 = StandardSchemaV1,
> {
  name: string;
  description: string;
  parameters: TParameters;
  /**
   * Server-side executor. Optional ONLY for interrupt tools (`interrupt:true`),
   * which pause the run instead of executing.
   */
  execute?: (args: InferSchemaOutput<TParameters>) => Promise<unknown>;
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
}

/**
 * Define a tool for use with BuiltInAgent
 * @param name - The name of the tool
 * @param description - Description of what the tool does
 * @param parameters - Schema for the tool's input parameters (any Standard Schema V1 compatible library: Zod, Valibot, ArkType, etc.)
 * @param execute - Function to execute the tool server-side
 * @returns Tool definition
 */
export function defineTool<TParameters extends StandardSchemaV1>(config: {
  name: string;
  description: string;
  parameters: TParameters;
  execute?: (args: InferSchemaOutput<TParameters>) => Promise<unknown>;
  interrupt?: boolean;
  interruptReason?: string;
  interruptMessage?: string;
}): ToolDefinition<TParameters> {
  return {
    name: config.name,
    description: config.description,
    parameters: config.parameters,
    execute: config.execute,
    interrupt: config.interrupt,
    interruptReason: config.interruptReason,
    interruptMessage: config.interruptMessage,
  };
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
 * Classic config: BuiltInAgent runs the model with TanStack AI `chat()` and
 * handles tools, MCP, state tools, and the system prompt.
 *
 * Install `@tanstack/ai` and the adapter package for your model, for example
 * `@tanstack/ai-openai` for `"openai/..."` models.
 */
export interface BuiltInAgentClassicConfig {
  /** Opt in to automatic snapshot acquisition before each run, including resumes. */
  learnedSkills?: BuiltInAgentLearnedSkillsOptions;
  /**
   * The model: a model string such as `"openai/gpt-5"`, or a TanStack AI
   * text adapter such as `openaiText("gpt-5")` from `@tanstack/ai-openai`.
   * See `resolveModel` for the providers and their env vars.
   */
  model: BuiltInAgentModel | AnyTextAdapter;
  /**
   * API key for the model provider (OpenAI, Anthropic, Google)
   * If not provided, falls back to environment variables:
   * - OPENAI_API_KEY for OpenAI models
   * - ANTHROPIC_API_KEY for Anthropic models
   * - GOOGLE_API_KEY for Google models
   * - MINIMAX_API_KEY for MiniMax models
   */
  apiKey?: string;
  /**
   * Maximum number of model calls in one run. Tools that the last call asks
   * for still run. Default: 1, or 10 when learned skills are available.
   */
  maxSteps?: number;
  /**
   * How the model uses the tools: `"auto"`, `"none"`, `"required"`, or
   * `{ type: "tool", name }`. Not set: the provider default.
   */
  toolChoice?: ToolChoice;
  /**
   * Provider options, passed to TanStack AI `chat()` as `modelOptions`
   * without changes. Their names and values are the provider's own, so see
   * the docs of your adapter package.
   *
   * @example
   * ```ts
   * new BuiltInAgent({
   *   model: "openai/gpt-5",
   *   modelOptions: { temperature: 0.2, max_output_tokens: 2048 },
   * });
   * ```
   */
  modelOptions?: Record<string, unknown>;
  /**
   * Prompt for the agent
   */
  prompt?: string;
  /**
   * List of properties that can be overridden by forwardedProps.
   */
  overridableProperties?: OverridableProperty[];
  /**
   * MCP servers to connect to on each run. Needs `@tanstack/ai-mcp`. The
   * agent creates the clients when the run starts and closes them when it
   * ends. A server that fails to connect is skipped for that run.
   */
  mcpServers?: MCPClientConfig[];
  /**
   * Optional list of user-managed MCP clients.
   * Unlike mcpServers, the agent does NOT create or close these clients.
   * The user controls the lifecycle, persistence, auth, and caching.
   *
   * A client from `createMCPClient()` in `@tanstack/ai-mcp` fits:
   * ```typescript
   * const client = await createMCPClient({
   *   transport: { type: "http", url: "https://mcp.example.com/mcp" },
   * });
   * const agent = new BuiltInAgent({ model: "...", mcpClients: [client] });
   * ```
   */
  mcpClients?: MCPClientProvider[];
  /**
   * Optional tools available to the agent
   */
  tools?: ToolDefinition[];
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
export type BuiltInAgentConfiguration =
  | BuiltInAgentClassicConfig
  | BuiltInAgentFactoryConfig;

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

export class BuiltInAgent extends AbstractAgent {
  private abortController?: AbortController;
  private skillRegistry?: SkillRegistry;

  /**
   * Which vendor this agent's configured model reaches. Read by the SSE layer
   * onto `agent_execution_stream_*` telemetry.
   *
   * Computed once, from the configured model, because that is what holds for
   * the agent's lifetime. A per-request `forwardedProps.model` override
   * (handled further down in `run`) can point somewhere else for one run and
   * is not reflected here — overrides are rare and the field describes the
   * agent, not the call.
   *
   * Factory-mode configs own their own LLM call, so there is no model for us
   * to classify.
   */
  readonly modelHostClass: ModelHostClass;

  /**
   * @throws Error when a classic config's `model` is an AI SDK model object.
   *   Run AI SDK models with a `type: "aisdk"` factory instead.
   */
  constructor(private config: BuiltInAgentConfiguration) {
    super();
    if (!isFactoryConfig(config)) assertNotAISDKModel(config.model);
    this.skillRegistry =
      config.learnedSkills === undefined
        ? undefined
        : new SkillRegistry(config.learnedSkills);
    this.modelHostClass = isFactoryConfig(config)
      ? "unknown"
      : classifyModelSpec(config.model);
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
    // above does not survive into the Observable/async closures below.
    const config = this.config;

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

      // MCP clients the agent created for this run; closed when it ends.
      const mcpClients: MCPClient[] = [];

      void (async () => {
        const runFinishedDetails: AgentRunFinishedDetails = {};
        const pendingInterrupts: Interrupt[] = [];
        try {
          const { chat, maxIterations } = await loadOptionalPeer<
            typeof TanStackAI
          >("@tanstack/ai", "BuiltInAgent with a model");
          signal.throwIfAborted();

          const overrides = this.forwardedOverrides(input.forwardedProps);
          const adapter = await resolveModel(
            overrides.model ?? config.model,
            config.apiKey,
          );
          signal.throwIfAborted();

          const converted = convertInputToTanStackAI(input, {
            forwardSystemMessages: config.forwardSystemMessages ?? false,
            forwardDeveloperMessages: config.forwardDeveloperMessages ?? false,
            prompt: overrides.prompt ?? config.prompt,
            resume: input.resume,
            keepToolResultMedia: true,
            format: "classic",
          });

          const learnedSkills = await prepareLearnedSkills(
            this.skillRegistry,
            signal,
          );
          signal.throwIfAborted();
          const systemPrompts = learnedSkills.catalog
            ? [learnedSkills.catalog, ...converted.systemPrompts]
            : converted.systemPrompts;

          // Frontend tools, then config tools, then the state tools. A later
          // tool replaces an earlier one with the same name.
          const ownTools: AnyTool[] = [
            ...converted.tools,
            ...toTanStackTools(config.tools ?? []),
            ...STATE_TOOLS,
          ];
          const appTools = [
            ...new Map(ownTools.map((tool) => [tool.name, tool])).values(),
          ];

          // MCP tools are collected per source and merged once, so a name
          // that two sources share keeps both tools instead of the later one
          // replacing the earlier.
          const mcpToolSources: MCPToolSource[] = [];
          const userMcpClients = config.mcpClients ?? [];

          // Tools from user-managed MCP clients (user controls lifecycle)
          for (const [index, client] of userMcpClients.entries()) {
            const mcpTools = await client.tools();
            signal.throwIfAborted();
            mcpToolSources.push({ label: `mcp${index + 1}`, tools: mcpTools });
          }

          const mcpServers = config.mcpServers ?? [];
          if (mcpServers.length > 0) {
            const { createMCPClient } = await loadOptionalPeer<
              typeof TanStackMCP
            >("@tanstack/ai-mcp", "BuiltInAgent mcpServers");
            signal.throwIfAborted();

            for (const [index, serverConfig] of mcpServers.entries()) {
              const { name, ...transport } = serverConfig;
              const label = name
                ? toToolNamePrefix(name)
                : `mcp${userMcpClients.length + index + 1}`;

              // A single MCP server being unavailable (down, 5xx, timeout,
              // bad auth) must NOT fail the whole run — skip it and continue
              // with the healthy servers and the agent's own tools.
              let mcpClient: MCPClient;
              try {
                mcpClient = await createMCPClient({ transport });
              } catch (err) {
                signal.throwIfAborted();
                console.error(
                  `[CopilotKit] MCP server ${describeEndpoint(serverConfig.url)} failed to connect — skipping it for this run:`,
                  err,
                );
                continue;
              }
              // Unsubscribe may have already cleaned up while connection was pending.
              if (signal.aborted) {
                await mcpClient.close();
                signal.throwIfAborted();
              }
              // Track it so it's closed on cleanup even if tools() fails.
              mcpClients.push(mcpClient);
              try {
                const mcpTools = await mcpClient.tools();
                signal.throwIfAborted();
                mcpToolSources.push({ label, tools: mcpTools });
              } catch (err) {
                signal.throwIfAborted();
                console.error(
                  `[CopilotKit] MCP server ${describeEndpoint(serverConfig.url)} tools() failed — skipping its tools for this run:`,
                  err,
                );
              }
            }
          }

          const tools = mergeMCPTools(appTools, mcpToolSources);
          if (this.skillRegistry) {
            assertNoSkillToolConflicts(tools);
            tools.push(...learnedSkills.tools);
          }
          signal.throwIfAborted();

          const stream = chat({
            adapter,
            messages: converted.messages,
            systemPrompts,
            tools,
            toolChoice: overrides.toolChoice ?? config.toolChoice,
            modelOptions: overrides.modelOptions ?? config.modelOptions,
            // Loading a skill must leave room for a model step that uses it.
            agentLoopStrategy: maxIterations(
              config.maxSteps || (learnedSkills.catalog ? 10 : 1),
            ),
            // Arguments that fail a tool's schema go back to the model as an
            // error result, without an attempt to repair them first.
            repairToolInput: false,
            abortController,
            threadId: input.threadId,
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
          await Promise.all(mcpClients.map((client) => client.close()));
        }
      })();

      // Cleanup function
      return () => {
        abortController.abort();
        if (this.abortController === abortController)
          this.abortController = undefined;
        // Cleanup MCP clients if stream is unsubscribed
        Promise.all(mcpClients.map((client) => client.close())).catch(() => {
          // Ignore cleanup errors
        });
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
    // AbstractAgent.middlewares is private in @ag-ui/client — no public accessor exists.
    // This coupling is intentional: clone() must preserve middleware chains.
    // @ts-expect-error accessing private AbstractAgent.middlewares
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
