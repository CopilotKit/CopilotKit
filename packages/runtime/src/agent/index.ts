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
import { Observable } from "rxjs";
import { randomUUID } from "@copilotkit/shared";
import type {
  InferSchemaOutput,
  ModelHostClass,
  StandardSchemaV1,
} from "@copilotkit/shared";
import { convertAISDKStream } from "./converters/aisdk";
import { convertTanStackStream } from "./converters/tanstack";
import {
  collectStandardRunFinishedDetails,
  getNonEmptyString,
  isRecord,
} from "./converters/usage";
import type { AgentRunFinishedDetails } from "./converters/usage";
import { SkillRegistry } from "../runtime/intelligence-platform/skill-registry";
import { prepareLearnedSkills } from "./learned-skills";
import type {
  BuiltInAgentLearnedSkills,
  BuiltInAgentLearnedSkillsOptions,
} from "./learned-skills";
export type {
  BuiltInAgentLearnedSkills,
  BuiltInAgentLearnedSkillsOptions,
} from "./learned-skills";
import type { InterruptDetails } from "./tool-spec";

/**
 * Thrown by `AgentFactoryContext.interrupt()` on a fresh (non-resume) run to
 * pause the factory. Caught in `BuiltInAgent.run` and translated into a RUN_FINISHED
 * event carrying `outcome:{type:"interrupt",interrupts}`. Not a real error.
 */
export class InterruptSignal extends Error {
  constructor(public readonly interrupts: Interrupt[]) {
    super("CopilotKit interrupt: run paused awaiting human input");
    this.name = "InterruptSignal";
  }
}

/**
 * The RUN_FINISHED for a stopped run. A stopped run is cancelled, not a
 * success. A client that declares no protocolVersion predates AG-UI 1.0 and
 * cannot parse the cancelled outcome, so it gets the plain event.
 */
function cancelledRunFinished(input: RunAgentInput) {
  const event: RunFinishedEvent = {
    type: EventType.RUN_FINISHED,
    threadId: input.threadId,
    runId: input.runId,
    ...(input.protocolVersion !== undefined
      ? { outcome: { type: "cancelled" as const } }
      : {}),
  };
  return event;
}

/**
 * Applies the details registered with `ctx.describeInterruptTool` to a native
 * approval interrupt, matched by `metadata.toolName`.
 */
function applyInterruptDetails(
  interrupt: Interrupt,
  detailsByTool: ReadonlyMap<string, InterruptDetails>,
) {
  const toolName = interrupt.metadata?.["toolName"];
  const details =
    typeof toolName === "string" ? detailsByTool.get(toolName) : undefined;
  if (!details) return interrupt;
  const described: Interrupt = {
    ...interrupt,
    reason: details.reason ?? "tool_call",
    message: details.message,
  };
  return described;
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
  // Method syntax keeps `defineTool(...)` results assignable to
  // `ToolDefinition` under `strictFunctionTypes`.
  execute?(args: InferSchemaOutput<TParameters>): Promise<unknown>;
  /**
   * When true, calling this tool pauses the run and emits a standard AG-UI
   * interrupt (RUN_FINISHED outcome:interrupt) keyed by the tool call's id.
   * The human response (resume payload) is injected as this tool call's result
   * on the resume run. Interrupt tools must NOT define `execute`. The AI SDK
   * pauses when a tool call has no result, even with a multi-step limit.
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
   * Verified learned-skills catalog and tool definitions for this run. Empty
   * when learned skills are disabled or no skills exist.
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
  /**
   * Register cleanup that runs once when the run ends: finished, interrupted,
   * failed, or aborted. Use it to close per-run resources such as MCP clients.
   * Cleanup errors are logged and do not change the run's outcome.
   */
  onRunEnd: (cleanup: () => void | Promise<void>) => void;
  /**
   * Set the reason and message of the interrupt a tool's native approval
   * request produces in this run (AI SDK or TanStack AI `needsApproval`).
   * Without it, the interrupt has reason `"tool_approval"`. With it, the reason
   * defaults to `"tool_call"`. The SDK helpers call this for `defineTool`
   * tools with `interrupt: true`.
   */
  describeInterruptTool: (toolName: string, details: InterruptDetails) => void;
}

/** Public name that avoids the runtime's request-scoped AgentFactoryContext. */
export type BuiltInAgentFactoryContext = AgentFactoryContext;

/**
 * Settings that every factory config shares.
 */
export interface BuiltInAgentFactoryConfigBase {
  /** Opt in to automatic snapshot acquisition before each run, including resumes. */
  learnedSkills?: BuiltInAgentLearnedSkillsOptions;
  /**
   * Explicit agent capabilities. **Shallow-merged** at the category level on
   * top of the defaults: providing a category (e.g. `tools`) replaces that
   * entire category, not individual fields within it.
   *
   * For example, `{ tools: { supported: true } }` drops the default
   * `clientProvided` value. Include all fields for any category you override.
   */
  capabilities?: Partial<AgentCapabilities>;
  /**
   * Which vendor hosts the model that the factory calls. Reported on the
   * `agent_execution_stream_*` telemetry events. Default: `"unknown"`.
   */
  modelHostClass?: ModelHostClass;
}

/**
 * Factory config for AI SDK backend.
 * The factory must return an object with a `fullStream` async iterable
 * (compatible with the result of `streamText()`; only `fullStream` is consumed).
 *
 * You own the `streamText()` call, so you also own its URL downloads. Pass
 * `experimental_download: createSafeUrlDownload({ signal: ctx.abortSignal })`
 * (from `@copilotkit/runtime/ai-sdk`) to keep the server from fetching
 * internal addresses named in request attachments, and to stop the downloads
 * when the run is aborted.
 */
export interface BuiltInAgentAISDKFactoryConfig extends BuiltInAgentFactoryConfigBase {
  type: "aisdk";
  factory: (
    ctx: AgentFactoryContext,
  ) => BuiltInAgentAISDKFactoryResult | Promise<BuiltInAgentAISDKFactoryResult>;
}

/**
 * What an AI SDK factory returns: a `streamText()` result, or any object with
 * its `fullStream`. Add `model` (the model the call used) to label the run's
 * usage with the model's `provider` and `modelId`.
 */
export interface BuiltInAgentAISDKFactoryResult {
  fullStream: AsyncIterable<unknown>;
  model?: unknown;
}

/**
 * Factory config for TanStack AI backend.
 * The factory must return an async iterable of TanStack AI stream chunks.
 */
export interface BuiltInAgentTanStackFactoryConfig extends BuiltInAgentFactoryConfigBase {
  type: "tanstack";
  factory: (
    ctx: AgentFactoryContext,
  ) => AsyncIterable<unknown> | Promise<AsyncIterable<unknown>>;
}

/**
 * Factory config for a custom backend that directly yields AG-UI events.
 */
export interface BuiltInAgentCustomFactoryConfig extends BuiltInAgentFactoryConfigBase {
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
 * Configuration for BuiltInAgent. You own the model call in `factory`, and
 * BuiltInAgent handles the run lifecycle, interrupts, and learned skills.
 *
 * To let CopilotKit build the model call, use `aiSdkAgent` from
 * `@copilotkit/runtime/ai-sdk` or `tanstackAIAgent` from
 * `@copilotkit/runtime/tanstack-ai`.
 */
export type BuiltInAgentConfiguration = BuiltInAgentFactoryConfig;

/**
 * Throws for settings that the agent cannot apply, so a config written for
 * an older release fails when the agent is constructed instead of on a run.
 * JavaScript callers get no type error for these keys.
 */
function assertSupportedConfig(config: object) {
  const isModelConfig = "model" in config && !("factory" in config);
  if (isModelConfig) {
    throw new Error(
      "BuiltInAgent: `model` is not supported. Use tanstackAIAgent({ adapter }) " +
        'from "@copilotkit/runtime/tanstack-ai" or aiSdkAgent({ model }) from ' +
        '"@copilotkit/runtime/ai-sdk", or pass { type, factory } to own the model call.',
    );
  }
  if ("urlDownload" in config) {
    // The factory owns its model call, so the setting could not take effect
    // and the AI SDK's default downloader would run instead. Fail loudly.
    throw new Error(
      "BuiltInAgent: urlDownload has no effect with a factory. Pass " +
        "experimental_download: createSafeUrlDownload({ signal: ctx.abortSignal }) " +
        '(from "@copilotkit/runtime/ai-sdk") to your own streamText() call instead.',
    );
  }
}

/**
 * An AG-UI agent whose model call is a factory you supply.
 *
 * The factory returns an AI SDK `streamText()` result (`type: "aisdk"`), a
 * TanStack AI `chat()` stream (`type: "tanstack"`), or AG-UI events
 * (`type: "custom"`). BuiltInAgent converts the stream to AG-UI events and
 * handles RUN_STARTED / RUN_FINISHED, interrupts and resumes, and learned
 * skills.
 *
 * @throws Error when constructed with a `model` and no `factory`, or with
 *   `urlDownload`.
 *
 * @example
 * ```ts
 * const agent = new BuiltInAgent({
 *   type: "custom",
 *   factory: async function* ({ input }) {
 *     yield {
 *       type: EventType.TEXT_MESSAGE_CHUNK,
 *       role: "assistant",
 *       delta: `Got ${input.messages.length} messages.`,
 *     };
 *   },
 * });
 * ```
 */
export class BuiltInAgent extends AbstractAgent {
  private abortController?: AbortController;
  private skillRegistry?: SkillRegistry;

  /**
   * Which vendor this agent's model reaches. Read by the SSE layer onto
   * `agent_execution_stream_*` telemetry. From the config's
   * `modelHostClass`, `"unknown"` when not set.
   */
  readonly modelHostClass: ModelHostClass;

  constructor(private config: BuiltInAgentConfiguration) {
    super();
    assertSupportedConfig(config);
    this.skillRegistry =
      config.learnedSkills === undefined
        ? undefined
        : new SkillRegistry(config.learnedSkills);
    this.modelHostClass = config.modelHostClass ?? "unknown";
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

    // Shallow merge at the category level: explicit overrides replace
    // entire categories when provided, inferred defaults fill the rest.
    return {
      ...inferred,
      ...this.config.capabilities,
    };
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    const config = this.config;
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

      const runEndCleanups: Array<() => void | Promise<void>> = [];
      const interruptToolDetails = new Map<string, InterruptDetails>();
      const ctx: Omit<AgentFactoryContext, "learnedSkills"> = {
        input,
        onRunEnd: (cleanup) => {
          runEndCleanups.push(cleanup);
        },
        describeInterruptTool: (toolName, details) => {
          interruptToolDetails.set(toolName, details);
        },
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

      (async () => {
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
              const model = isRecord(result.model) ? result.model : {};
              events = convertAISDKStream(
                result.fullStream,
                controller.signal,
                pendingInterrupts,
                input.state,
                runFinishedDetails,
                {
                  provider: getNonEmptyString(model.provider),
                  model: getNonEmptyString(model.modelId),
                },
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
            throw new InterruptSignal(
              pendingInterrupts.map((interrupt) =>
                applyInterruptDetails(interrupt, interruptToolDetails),
              ),
            );
          }

          if (controller.signal.aborted) {
            subscriber.next(cancelledRunFinished(input));
          } else {
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
            subscriber.next(cancelledRunFinished(input));
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
          for (const cleanup of runEndCleanups) {
            try {
              await cleanup();
            } catch (error) {
              console.error(
                "[CopilotKit] BuiltInAgent run cleanup failed:",
                error,
              );
            }
          }
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
    // Reuse resolved delivery configuration; cloning must not re-read environment.
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

export * from "./converters";
export type { AgentToolSpec, InterruptDetails } from "./tool-spec";
export {
  readInterruptDetails,
  withInterruptDetails,
  STATE_DELTA_TOOL_NAME,
  STATE_SNAPSHOT_TOOL_NAME,
  stateToolSpecs,
  toolDefinitionToSpec,
} from "./tool-spec";
export { buildAgentSystemPrompt } from "./prompt";
export { connectMCPServers } from "./mcp";
export type {
  ConnectMCPServersOptions,
  MCPClientConfig,
  MCPClientConfigHTTP,
  MCPClientConfigSSE,
} from "./mcp";
