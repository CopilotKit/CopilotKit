import type {
  AbstractAgent,
  AgentSubscriber,
  Message,
  RunAgentResult,
  ResumeEntry,
  Tool,
  ToolCall,
} from "@ag-ui/client";
import { randomUUID, logger, schemaToJsonSchema } from "@copilotkit/shared";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { CopilotKitCore, CopilotKitCoreFriendsAccess } from "./core";
import { CopilotKitCoreErrorCode } from "./core";
import { AgentThreadLockedError } from "../intelligence-agent";
import type { FrontendTool } from "../types";
import type { CopilotKitCoreContinuationHandoff } from "./state-manager";

export interface CopilotKitCoreRunAgentParams {
  agent: AbstractAgent;
  forwardedProps?: Record<string, unknown>;
  /**
   * Optional caller-supplied run identifier forwarded to the underlying AG-UI
   * agent. When omitted, the agent creates one.
   */
  runId?: string;
  /**
   * Per-interrupt responses addressing every open AG-UI interrupt from the
   * previous run. Forwarded to the agent as the standard `resume` array.
   */
  resume?: ResumeEntry[];
}

export interface CopilotKitCoreConnectAgentParams {
  agent: AbstractAgent;
}

export interface CopilotKitCoreGetToolParams {
  toolName: string;
  agentId?: string;
}

/**
 * Parameters for programmatic tool execution via `copilotkit.runTool()`.
 */
export interface CopilotKitCoreRunToolParams {
  /** Name of the registered frontend tool to execute. */
  name: string;
  /** Optional agent ID. If omitted, uses the default agent lookup. */
  agentId?: string;
  /** Parameters to pass to the tool handler. */
  parameters?: Record<string, unknown>;
  /**
   * Whether to trigger an LLM follow-up after tool execution.
   * - `false` (default): execute tool, add messages to history, done.
   * - `"generate"`: after execution, trigger another agent run so the LLM responds to the tool result.
   * - Any other string: add a user message with this text, then trigger another agent run.
   */
  followUp?: string | false;
}

/**
 * Result of programmatic tool execution via `copilotkit.runTool()`.
 */
export interface CopilotKitCoreRunToolResult {
  /** The unique ID of the tool call. */
  toolCallId: string;
  /** The stringified result from the tool handler. */
  result: string;
  /** Error message if the handler failed. */
  error?: string;
}

/**
 * Internal result from the shared tool handler execution logic.
 */
interface ExecuteToolHandlerResult {
  result: string;
  error?: string;
  isArgumentError: boolean;
}

/**
 * A registered A2UI catalog component, as exposed to the inspector via
 * `CopilotKitCore.catalogComponents`. `schema` is an opaque JSON-schema-ish
 * value (the built catalog's Zod schema or a serialized form); the inspector
 * treats it as unknown. `description` is optional because the built
 * `ComponentApi` does not carry descriptions.
 */
export interface CopilotKitCoreCatalogComponent {
  name: string;
  description?: string;
  schema: unknown;
}

/**
 * Absolute safety cap on the depth of recursive follow-up runs triggered by
 * `processAgentResult`. Without this, any scenario that keeps
 * `needsFollowUp = true` (e.g. the LLM repeatedly calling the same tool, a
 * backend that errors after receiving tool results, or input processors that
 * reprocess tool messages) would loop indefinitely, silently consuming API
 * quota and potentially DOS'ing the backend.
 *
 * The cap is deliberately high so that legitimate multi-step agent workflows
 * (search → fill form → confirm → update → send email, etc.) are never
 * affected; it only trips on runaway recursion.
 */
const MAX_FOLLOW_UP_DEPTH = 100;

/**
 * Name of the catch-all frontend tool. A tool registered under this name
 * handles any tool call that has no exact match (see `executeWildcardTool`),
 * and is never advertised to the agent.
 */
const WILDCARD_TOOL_NAME = "*";

/**
 * Handles agent execution, tool calling, and agent connectivity for CopilotKitCore.
 * Manages the complete lifecycle of agent runs including tool execution and follow-ups.
 */
export class RunHandler {
  /**
   * Tools owned by the framework provider, replaced wholesale by
   * {@link initialize} and {@link setTools} whenever the provider re-syncs its
   * props or runtime feature flags.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _propTools: FrontendTool<any>[] = [];

  /**
   * Tools registered imperatively via {@link addTool} — `useFrontendTool`,
   * `useHumanInTheLoop`, and direct `core.addTool()` callers. Held separately
   * from {@link _propTools} so a provider re-sync cannot wipe them: they share
   * one array before, so the `/info` response flipping `openGenerativeUI` (or
   * any other provider-prop change) silently dropped every hook-registered
   * tool (#4952). Key = `capabilityKey(name, agentId)`.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _hookTools: Map<string, FrontendTool<any>> = new Map();

  /** Memoized merge of both buckets; invalidated on every registry write. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _cachedMergedTools: FrontendTool<any>[] | null = null;

  /**
   * The full list of A2UI catalog components registered by the provider.
   * Order is preserved for display in the inspector.
   */
  private _catalogComponents: CopilotKitCoreCatalogComponent[] = [];

  /**
   * Names of catalog components the caller has explicitly disabled. A name
   * absent from this set is enabled (default). Survives re-registration so a
   * catalog identity change does not silently re-enable a disabled component.
   */
  private _disabledCatalogComponents: Set<string> = new Set();

  /**
   * Keys of frontend tools explicitly disabled at runtime via the Inspector's
   * Capabilities tool (`setToolEnabled`). Kept independently of each tool's own
   * `available` flag so a hook re-registering the tool (which resets
   * `available`) does not clobber the override. Key = `capabilityKey(name, agentId)`.
   */
  private _disabledToolKeys = new Set<string>();

  /**
   * Tracks whether the current run (including in-flight tool execution)
   * has been aborted via `stopAgent()` or `agent.abortRun()`. Created
   * fresh in `runAgent()`, aborted by `abortCurrentRun()`.
   */
  private _runAbortController: AbortController | null = null;

  /**
   * Tracks recursive `runAgent` depth so that the abort controller and
   * `agent.abortRun()` intercept are only set up / torn down at the
   * top-level call, not on follow-up recursive calls from
   * `processAgentResult`.
   */
  private _runDepth = 0;

  /**
   * Tracks the threadId of the most recent `connectAgent` call so we
   * can distinguish a fresh thread restore (different threadId than
   * last time — chat is rebuilding state from scratch, must clear
   * messages/state and ask the gateway for a full replay) from a
   * same-thread churn re-connect (effect-dep churn or transient
   * disconnect — local messages/state are still meaningful, must
   * preserve them and let the gateway resume from
   * `lastSeenEventId`).
   *
   * Tyler's bug fired because every `connectAgent` was treated as a
   * fresh restore, which forced the gateway to replay the full
   * thread history on every churn re-connect and amplified the
   * downstream churn into duplicate `cpki_event_id` rows in the
   * inspector and intermittent "Message not found" toasts.
   */
  private _lastConnectedThreadIdsByAgent = new Map<string, string | null>();
  private _anonymousAgentIds = new WeakMap<AbstractAgent, string>();
  private _nextAnonymousAgentId = 0;

  constructor(private core: CopilotKitCore) {}

  /**
   * Abort the current run. Called by `CopilotKitCore.stopAgent()` to signal
   * that in-flight tool handlers should stop and `processAgentResult` should
   * not start a follow-up run.
   */
  abortCurrentRun(): void {
    this._runAbortController?.abort();
  }

  /**
   * Typed access to CopilotKitCore's internal ("friend") methods.
   * Centralises the single unavoidable cast so call-sites stay clean.
   */
  private get _internal(): CopilotKitCoreFriendsAccess {
    return this.core as unknown as CopilotKitCoreFriendsAccess;
  }

  /**
   * Return a stable restore-tracking key for the logical agent being
   * connected. Named agents share their last-thread marker across proxy
   * instances; anonymous agents fall back to object identity.
   */
  private getConnectRestoreKey(agent: AbstractAgent): string {
    if (agent.agentId) {
      return `agent:${agent.agentId}`;
    }

    const existing = this._anonymousAgentIds.get(agent);
    if (existing) {
      return existing;
    }

    const anonymousId = `anonymous:${this._nextAnonymousAgentId}`;
    this._nextAnonymousAgentId += 1;
    this._anonymousAgentIds.set(agent, anonymousId);
    return anonymousId;
  }

  /**
   * Get all tools as a readonly array: provider-owned tools in registration
   * order, with imperatively-added tools appended and taking precedence over a
   * provider tool of the same name + agentId.
   */
  get tools(): Readonly<FrontendTool<any>[]> {
    if (this._hookTools.size === 0) {
      return this._propTools;
    }
    if (this._cachedMergedTools) {
      return this._cachedMergedTools;
    }
    // Merge: hook entries override prop entries with the same key. Overriding
    // an existing key keeps the prop entry's position, so provider order is
    // preserved and only genuinely new hook tools land at the end.
    const merged = new Map<string, FrontendTool<any>>();
    for (const tool of this._propTools) {
      merged.set(this.capabilityKey(tool.name, tool.agentId), tool);
    }
    for (const [key, tool] of this._hookTools) {
      merged.set(key, tool);
    }
    this._cachedMergedTools = Array.from(merged.values());
    return this._cachedMergedTools;
  }

  /**
   * Initialize with tools
   */
  initialize(tools: FrontendTool<any>[]): void {
    this._propTools = tools;
    this._cachedMergedTools = null;
  }

  /**
   * Add a tool to the registry. Survives provider re-syncs ({@link setTools}),
   * and shadows a provider tool of the same name + agentId.
   */
  addTool<T extends Record<string, unknown> = Record<string, unknown>>(
    tool: FrontendTool<T>,
  ): void {
    const key = this.capabilityKey(tool.name, tool.agentId);

    // Only a competing imperative registration is a conflict. A provider tool
    // of the same name is shadowed rather than treated as a duplicate — hooks
    // mount after the provider and are the more specific registration.
    if (this._hookTools.has(key)) {
      logger.warn(
        `Tool already exists: '${tool.name}' for agent '${tool.agentId || "global"}', skipping.`,
      );
      return;
    }

    this._hookTools.set(key, tool);
    this._cachedMergedTools = null;
  }

  /**
   * Remove a tool by name and optionally by agentId
   */
  removeTool(id: string, agentId?: string): void {
    this._hookTools.delete(this.capabilityKey(id, agentId));
    this._propTools = this._propTools.filter((tool) => {
      // Remove tool if both name and agentId match
      if (agentId !== undefined) {
        return !(tool.name === id && tool.agentId === agentId);
      }
      // If no agentId specified, only remove global tools with matching name
      return !(tool.name === id && !tool.agentId);
    });
    this._cachedMergedTools = null;
  }

  /**
   * Get a tool by name and optionally by agentId.
   * If agentId is provided, it will first look for an agent-specific tool,
   * then fall back to a global tool with the same name.
   */
  getTool(params: CopilotKitCoreGetToolParams): FrontendTool<any> | undefined {
    const { toolName, agentId } = params;
    const tools = this.tools;

    // If agentId is provided, first look for agent-specific tool
    if (agentId) {
      const agentTool = tools.find(
        (tool) => tool.name === toolName && tool.agentId === agentId,
      );
      if (agentTool) {
        return agentTool;
      }
    }

    // Fall back to global tool (no agentId)
    return tools.find((tool) => tool.name === toolName && !tool.agentId);
  }

  /**
   * Set all provider-owned tools at once. Replaces the previous provider set;
   * tools registered via {@link addTool} are unaffected.
   */
  setTools(tools: FrontendTool<any>[]): void {
    this._propTools = [...tools];
    this._cachedMergedTools = null;
  }

  /**
   * Return the registered A2UI catalog components (readonly).
   */
  get catalogComponents(): ReadonlyArray<CopilotKitCoreCatalogComponent> {
    return this._catalogComponents;
  }

  /**
   * Replace the registered catalog component list. Preserves the disabled set
   * (by name) so re-registration does not re-enable disabled components.
   */
  setCatalogComponents(components: CopilotKitCoreCatalogComponent[]): void {
    this._catalogComponents = [...components];
  }

  /**
   * Enable or disable a catalog component by name.
   */
  setCatalogComponentEnabled(name: string, enabled: boolean): void {
    if (enabled) {
      this._disabledCatalogComponents.delete(name);
    } else {
      this._disabledCatalogComponents.add(name);
    }
  }

  /**
   * Whether a catalog component is enabled. Unknown names default to enabled.
   */
  isCatalogComponentEnabled(name: string): boolean {
    return !this._disabledCatalogComponents.has(name);
  }

  /**
   * Connect an agent (establish initial connection)
   */
  async connectAgent({
    agent,
  }: CopilotKitCoreConnectAgentParams): Promise<RunAgentResult> {
    try {
      const incomingThreadId = agent.threadId ?? null;
      const restoreKey = this.getConnectRestoreKey(agent);
      const isFreshRestore =
        incomingThreadId !==
        (this._lastConnectedThreadIdsByAgent.get(restoreKey) ?? null);
      this._lastConnectedThreadIdsByAgent.set(restoreKey, incomingThreadId);

      // Detach any active run before connecting to avoid previous runs
      // interfering. This stays unconditional — both fresh restores and
      // churn re-connects need the previous socket torn down before a new
      // one can open.
      await agent.detachActiveRun();

      // State reset + replay-cursor clear are gated on actually moving
      // to a different thread. On same-thread churn, the local
      // messages/state are still the right view of the thread, and the
      // gateway can resume from `lastSeenEventId` instead of replaying
      // the full history.
      if (isFreshRestore) {
        agent.setMessages([]);
        agent.setState({});
        const cursorAware = agent as {
          clearReconnectCursor?: (id: string) => void;
          clearReplayCursor?: (id: string) => void;
        };
        if (incomingThreadId) {
          if (typeof cursorAware.clearReplayCursor === "function") {
            cursorAware.clearReplayCursor(incomingThreadId);
          }
          if (typeof cursorAware.clearReconnectCursor === "function") {
            cursorAware.clearReconnectCursor(incomingThreadId);
          }
        }
      }

      // Re-apply core headers (merged on top of the agent's own headers) so a
      // late header update is picked up without clobbering per-agent headers.
      this._internal.applyHeadersToAgent(agent);

      // Notify subscribers (e.g. the inspector) about the agent that is about
      // to run. Per-thread clones are not in the agent registry, so
      // onAgentsChanged never fires for them and they would otherwise be
      // invisible to subscribers.
      await this._internal.notifySubscribers(
        (subscriber) =>
          subscriber.onAgentRunStarted?.({
            copilotkit: this.core,
            agent,
          }),
        "Subscriber onAgentRunStarted error:",
      );

      const runAgentResult = await agent.connectAgent(
        {
          forwardedProps: this._internal.properties,
          tools: this.buildFrontendTools(agent.agentId),
          context: this._internal.getContextForAgent(agent.agentId),
        },
        this.createAgentErrorSubscriber(agent),
      );

      return this.processAgentResult({
        runAgentResult,
        agent,
        executeFrontendTools: false,
      });
    } catch (error) {
      const connectError =
        error instanceof Error ? error : new Error(String(error));
      // Silently ignore abort errors (e.g. from navigation during active requests)
      const isAbort =
        connectError.name === "AbortError" ||
        connectError.message === "Fetch is aborted" ||
        connectError.message === "signal is aborted without reason" ||
        connectError.message === "component unmounted";
      if (!isAbort) {
        const context: Record<string, any> = {};
        if (agent.agentId) {
          context.agentId = agent.agentId;
        }
        await this._internal.emitError({
          error: connectError,
          code: CopilotKitCoreErrorCode.AGENT_CONNECT_FAILED,
          context,
        });
      }
      return { result: undefined, newMessages: [] };
    }
  }

  /**
   * Run an agent
   */
  async runAgent(
    { agent, forwardedProps, resume, runId }: CopilotKitCoreRunAgentParams,
    continuationHandoff?: CopilotKitCoreContinuationHandoff,
  ): Promise<RunAgentResult> {
    // Agent ID is guaranteed to be set by validateAndAssignAgentId
    if (agent.agentId) {
      void this._internal.suggestionEngine.clearSuggestions(agent.agentId);
    }

    // Re-apply core headers (merged on top of the agent's own headers) so a
    // late header update is picked up without clobbering per-agent headers.
    this._internal.applyHeadersToAgent(agent);

    // Detach any active run (e.g. a long-lived connectAgent pipeline) before
    // starting a new run.  We await the detach to ensure the previous pipeline
    // has fully finalized — its activeRunCompletionPromise resolves once the
    // observable finalize block runs, which happens synchronously after the
    // takeUntil signal completes the chain.  This prevents a race where the new
    // runAgent() overwrites activeRunDetach$ / activeRunCompletionPromise before
    // the old pipeline can clean up, causing dropped runs.
    //
    // Historical note: an earlier version used fire-and-forget (`void`) here
    // because awaiting caused a deadlock when connectAgent's
    // ConnectNotImplementedError cleanup was still in-flight.  That deadlock
    // was resolved in @ag-ui/client ≥0.0.42 where the catchError path
    // (ConnectNotImplementedError → EMPTY) always runs the finalize block,
    // so the completion promise now resolves reliably.
    if (agent.detachActiveRun) {
      try {
        await agent.detachActiveRun();
      } catch (error) {
        continuationHandoff?.cancel();
        throw error;
      }
    }

    // Set up abort controller and agent.abortRun() intercept only for the
    // top-level call. Recursive follow-up calls from processAgentResult
    // reuse the same controller.
    const isTopLevel = this._runDepth === 0;
    let originalAbortRun: (() => void) | undefined;

    if (isTopLevel) {
      this._runAbortController = new AbortController();

      // Intercept agent.abortRun() so that calling it directly (not via
      // stopAgent) also aborts in-flight tool execution and prevents
      // follow-up runs.
      const controller = this._runAbortController;
      originalAbortRun = agent.abortRun.bind(agent);
      agent.abortRun = () => {
        controller.abort();
        originalAbortRun!();
      };

      // Notify subscribers (e.g. the inspector) about the agent that is about
      // to run. Per-thread clones are not in the agent registry, so
      // onAgentsChanged never fires for them and they would otherwise be
      // invisible to subscribers. Fired once per top-level run; recursive
      // follow-up runs reuse the same instance and need no re-notification.
      await this._internal.notifySubscribers(
        (subscriber) =>
          subscriber.onAgentRunStarted?.({
            copilotkit: this.core,
            agent,
          }),
        "Subscriber onAgentRunStarted error:",
      );
    }

    this._runDepth++;

    try {
      let logicalRunId = runId;
      const agentSubscriber = this.createAgentErrorSubscriber(agent);
      let started = false;
      const onRunStartedEvent = agentSubscriber.onRunStartedEvent;
      const onRunInitialized = agentSubscriber.onRunInitialized;
      agentSubscriber.onRunInitialized = async (params) => {
        continuationHandoff?.bind(params.input);
        return onRunInitialized?.(params);
      };
      agentSubscriber.onRunStartedEvent = async (params) => {
        started = true;
        // A continuation keeps reporting under the run it continues; only an
        // ordinary run adopts the id the transport assigned it.
        if (!continuationHandoff) {
          logicalRunId = params.input.runId;
        }
        return onRunStartedEvent?.(params);
      };
      // An internal continuation (a human-in-the-loop tool resolved and this is
      // the recursive follow-up) deliberately does NOT pin the originating run
      // id on the wire. Pinning it made the transport treat the follow-up as a
      // resumption of a run it had already completed: it re-delivered that
      // run's applied half — duplicating every tool call already on the
      // message, each duplicate carrying empty arguments — and the follow-up's
      // own tool call never reached client state, so its card never rendered.
      //
      // One logical run is still what everything downstream sees: the state
      // manager re-stamps the continuation's events onto `runId` (passed to
      // markNextRunAsContinuation), and `logicalRunId` below keeps the result
      // reported under it. So external tracing still gets a single run without
      // the wire having to lie about which invocation this is.
      const pinRunIdOnWire = runId !== undefined && !continuationHandoff;
      const agentRunInput = {
        forwardedProps: {
          ...this._internal.properties,
          ...forwardedProps,
        },
        ...(resume !== undefined ? { resume } : {}),
        ...(pinRunIdOnWire ? { runId } : {}),
        tools: this.buildFrontendTools(agent.agentId),
        context: this._internal.getContextForAgent(agent.agentId),
      };
      const runAgentResult = await agent.runAgent(
        agentRunInput,
        agentSubscriber,
      );
      if (!started) {
        continuationHandoff?.cancel();
      }
      return await this.processAgentResult({
        runAgentResult,
        agent,
        runId: logicalRunId,
      });
    } catch (error) {
      continuationHandoff?.cancel();
      const runError =
        error instanceof Error ? error : new Error(String(error));
      const context: Record<string, any> = {};
      if (agent.agentId) {
        context.agentId = agent.agentId;
      }
      await this._internal.emitError({
        error: runError,
        code: CopilotKitCoreErrorCode.AGENT_RUN_FAILED,
        context,
      });
      return { result: undefined, newMessages: [] };
    } finally {
      this._runDepth--;
      // Restore original abortRun when the entire chain (including
      // recursive follow-ups) is complete.
      if (isTopLevel && originalAbortRun) {
        agent.abortRun = originalAbortRun;
      }
    }
  }

  /**
   * Process agent result and execute tools
   */
  private async processAgentResult({
    runAgentResult,
    agent,
    runId,
    executeFrontendTools = true,
  }: {
    runAgentResult: RunAgentResult;
    agent: AbstractAgent;
    runId?: string;
    executeFrontendTools?: boolean;
  }): Promise<RunAgentResult> {
    const { newMessages } = runAgentResult;
    // Agent ID is guaranteed to be set by validateAndAssignAgentId
    const agentId = agent.agentId!;

    let needsFollowUp = false;

    if (executeFrontendTools) {
      for (const message of newMessages) {
        if (message.role === "assistant") {
          for (const toolCall of message.toolCalls || []) {
            const tool = this.getTool({
              toolName: toolCall.function.name,
              agentId: agent.agentId,
            });

            let wildcardTool: FrontendTool<any> | undefined;
            const getWildcardTool = () => {
              if (tool || wildcardTool) {
                return wildcardTool;
              }
              wildcardTool = this.getTool({
                toolName: WILDCARD_TOOL_NAME,
                agentId: agent.agentId,
              });
              return wildcardTool;
            };

            let existingResultIndex = newMessages.findIndex(
              (m) => m.role === "tool" && m.toolCallId === toolCall.id,
            );
            const existingResult =
              existingResultIndex === -1
                ? undefined
                : newMessages[existingResultIndex];
            const executableTool = tool ?? getWildcardTool();

            if (
              existingResult &&
              executableTool?.handler &&
              this.isFrontendPlaceholderResult(existingResult)
            ) {
              newMessages.splice(existingResultIndex, 1);
              existingResultIndex = -1;

              const agentMsgIdx = agent.messages.findIndex(
                (m) => m.role === "tool" && m.toolCallId === toolCall.id,
              );
              if (agentMsgIdx !== -1) {
                agent.messages.splice(agentMsgIdx, 1);
              }
            }

            if (existingResultIndex === -1) {
              if (tool) {
                const followUp = await this.executeSpecificTool(
                  tool,
                  toolCall,
                  message,
                  agent,
                  agentId,
                );
                if (followUp) {
                  needsFollowUp = true;
                }
              } else {
                const fallbackTool = getWildcardTool();
                if (fallbackTool) {
                  const followUp = await this.executeWildcardTool(
                    fallbackTool,
                    toolCall,
                    message,
                    agent,
                    agentId,
                  );
                  if (followUp) {
                    needsFollowUp = true;
                  }
                }
              }
            }
          }
        }
      }
    }

    if (needsFollowUp && !this._runAbortController?.signal.aborted) {
      // Circuit breaker: bail out instead of recursing once the follow-up
      // chain exceeds an absolute safety cap. `_runDepth` reflects the current
      // depth of nested runAgent calls (it is incremented in runAgent and
      // decremented in its finally block), so a runaway loop — repeated
      // identical tool calls, a backend that keeps erroring after tool
      // results, reprocessed tool messages, etc. — eventually trips this
      // guard rather than looping forever and exhausting API quota.
      if (this._runDepth >= MAX_FOLLOW_UP_DEPTH) {
        logger.warn(
          `[CopilotKit] Follow-up depth limit (${MAX_FOLLOW_UP_DEPTH}) reached for agent "${agentId}". ` +
            `Stopping recursive follow-up runs to prevent an infinite loop. ` +
            `This usually indicates a tool that keeps requesting a follow-up (e.g. the LLM repeatedly ` +
            `calling the same tool). Consider setting "followUp: false" on the offending tool.`,
        );
      } else {
        // Yield to the framework scheduler before the follow-up run so that any
        // deferred state updates (e.g. React useEffect in useAgentContext) can
        // complete and write fresh values into the context store before runAgent
        // reads it. The base implementation is a no-op; React overrides this.
        await this._internal.waitForPendingFrameworkUpdates();
        const continuationHandoff =
          this._internal.stateManager.markNextRunAsContinuation(agent, runId);
        return await this.runAgent(
          {
            agent,
            ...(runId !== undefined ? { runId } : {}),
          },
          continuationHandoff,
        );
      }
    }

    void this._internal.suggestionEngine.reloadSuggestions(agentId);

    return runAgentResult;
  }

  private isFrontendPlaceholderResult(message: Message): boolean {
    if (message.role !== "tool") {
      return false;
    }

    const normalized = this.normalizeToolResultContent(message.content);
    return normalized === "Forwarded to client";
  }

  private normalizeToolResultContent(content: unknown): string | null {
    if (typeof content === "string") {
      return content.trim();
    }

    if (Array.isArray(content)) {
      const text = content
        .flatMap((part) => {
          if (typeof part === "string") {
            return [part];
          }
          if (
            part &&
            typeof part === "object" &&
            "text" in part &&
            typeof (part as { text?: unknown }).text === "string"
          ) {
            return [(part as { text: string }).text];
          }
          return [];
        })
        .join("")
        .trim();
      return text.length > 0 ? text : null;
    }

    if (
      content &&
      typeof content === "object" &&
      "text" in content &&
      typeof (content as { text?: unknown }).text === "string"
    ) {
      return (content as { text: string }).text.trim();
    }

    return null;
  }

  /**
   * Shared handler execution logic used by executeSpecificTool, executeWildcardTool, and runTool.
   * Handles arg parsing, subscriber notifications, handler invocation, result stringification,
   * and error handling.
   */
  private async executeToolHandler({
    tool,
    toolCall,
    agent,
    agentId,
    handlerArgs,
    toolType,
    messageId,
  }: {
    tool: FrontendTool<any>;
    toolCall: { id: string; function: { name: string; arguments: string } };
    agent: AbstractAgent;
    agentId: string;
    handlerArgs: unknown;
    toolType: string;
    messageId?: string;
  }): Promise<ExecuteToolHandlerResult> {
    let toolCallResult = "";
    let errorMessage: string | undefined;
    let isArgumentError = false;

    let parsedArgs: unknown;
    try {
      parsedArgs = parseToolArguments(handlerArgs, toolCall.function.name);
    } catch (error) {
      const parseError =
        error instanceof Error ? error : new Error(String(error));
      errorMessage = parseError.message;
      isArgumentError = true;
      await this._internal.emitError({
        error: parseError,
        code: CopilotKitCoreErrorCode.TOOL_ARGUMENT_PARSE_FAILED,
        context: {
          agentId,
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          rawArguments: handlerArgs,
          toolType,
          ...(messageId ? { messageId } : {}),
        },
      });
    }

    await this._internal.notifySubscribers(
      (subscriber) =>
        subscriber.onToolExecutionStart?.({
          copilotkit: this.core,
          toolCallId: toolCall.id,
          agentId,
          toolName: toolCall.function.name,
          args: parsedArgs,
        }),
      "Subscriber onToolExecutionStart error:",
    );

    if (!errorMessage) {
      try {
        const result = await tool.handler!(parsedArgs as any, {
          toolCall: toolCall as any,
          agent,
          signal: this._runAbortController?.signal,
        });
        if (result === undefined || result === null) {
          toolCallResult = "";
        } else if (typeof result === "string") {
          toolCallResult = result;
        } else {
          toolCallResult = JSON.stringify(result);
        }
      } catch (error) {
        const handlerError =
          error instanceof Error ? error : new Error(String(error));
        errorMessage = handlerError.message;
        await this._internal.emitError({
          error: handlerError,
          code: CopilotKitCoreErrorCode.TOOL_HANDLER_FAILED,
          context: {
            agentId,
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            parsedArgs,
            toolType,
            ...(messageId ? { messageId } : {}),
          },
        });
      }
    }

    if (errorMessage) {
      toolCallResult = `Error: ${errorMessage}`;
    }

    await this._internal.notifySubscribers(
      (subscriber) =>
        subscriber.onToolExecutionEnd?.({
          copilotkit: this.core,
          toolCallId: toolCall.id,
          agentId,
          toolName: toolCall.function.name,
          result: errorMessage ? "" : toolCallResult,
          error: errorMessage,
        }),
      "Subscriber onToolExecutionEnd error:",
    );

    return { result: toolCallResult, error: errorMessage, isArgumentError };
  }

  /**
   * Execute a specific tool
   */
  private async executeSpecificTool(
    tool: FrontendTool<any>,
    toolCall: ToolCall,
    message: Message,
    agent: AbstractAgent,
    agentId: string,
  ): Promise<boolean> {
    // Check if tool is constrained to a specific agent
    if (tool?.agentId && tool.agentId !== agent.agentId) {
      // Tool is not available for this agent, skip it
      return false;
    }

    let handlerResult: ExecuteToolHandlerResult = {
      result: "",
      error: undefined,
      isArgumentError: false,
    };

    if (tool?.handler) {
      handlerResult = await this.executeToolHandler({
        tool,
        toolCall,
        agent,
        agentId,
        handlerArgs: toolCall.function.arguments,
        toolType: "specific",
        messageId: message.id,
      });
    }

    {
      const messageIndex = agent.messages.findIndex((m) => m.id === message.id);
      if (messageIndex === -1) {
        // Parent message no longer in agent's messages (e.g. thread was switched
        // while the tool handler was still executing). Skip result insertion and
        // do not request a follow-up to avoid mutating the wrong thread.
        return false;
      }
      // Find the correct insertion point: after the parent assistant message
      // and any tool-result messages already inserted for earlier tool calls
      // in the same batch. This preserves tool-result ordering relative to
      // the toolCalls array, which some providers (OpenAI) require.
      let insertAt = messageIndex + 1;
      while (
        insertAt < agent.messages.length &&
        agent.messages[insertAt]?.role === "tool"
      ) {
        insertAt++;
      }
      const toolMessage = {
        id: randomUUID(),
        role: "tool" as const,
        toolCallId: toolCall.id,
        content: handlerResult.result,
      };
      agent.messages.splice(insertAt, 0, toolMessage);

      if (!handlerResult.error && tool?.followUp !== false) {
        return true; // Needs follow-up
      }
    }

    return false;
  }

  /**
   * Execute a wildcard tool.
   * Wildcard tools receive args wrapped as `{toolName, args}`, which differs from
   * specific tools, so this method keeps its own arg-wrapping logic rather than
   * delegating to `executeToolHandler`.
   */
  private async executeWildcardTool(
    wildcardTool: FrontendTool<any>,
    toolCall: ToolCall,
    message: Message,
    agent: AbstractAgent,
    agentId: string,
  ): Promise<boolean> {
    // Check if wildcard tool is constrained to a specific agent
    if (wildcardTool?.agentId && wildcardTool.agentId !== agent.agentId) {
      // Wildcard tool is not available for this agent, skip it
      return false;
    }

    let toolCallResult = "";
    let errorMessage: string | undefined;

    if (wildcardTool?.handler) {
      let parsedArgs: unknown;
      try {
        parsedArgs = parseToolArguments(
          toolCall.function.arguments,
          toolCall.function.name,
        );
      } catch (error) {
        const parseError =
          error instanceof Error ? error : new Error(String(error));
        errorMessage = parseError.message;
        await this._internal.emitError({
          error: parseError,
          code: CopilotKitCoreErrorCode.TOOL_ARGUMENT_PARSE_FAILED,
          context: {
            agentId: agentId,
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            rawArguments: toolCall.function.arguments,
            toolType: "wildcard",
            messageId: message.id,
          },
        });
      }

      const wildcardArgs = {
        toolName: toolCall.function.name,
        args: parsedArgs,
      };

      await this._internal.notifySubscribers(
        (subscriber) =>
          subscriber.onToolExecutionStart?.({
            copilotkit: this.core,
            toolCallId: toolCall.id,
            agentId: agentId,
            toolName: toolCall.function.name,
            args: wildcardArgs,
          }),
        "Subscriber onToolExecutionStart error:",
      );

      if (!errorMessage) {
        try {
          const result = await wildcardTool.handler(wildcardArgs as any, {
            toolCall,
            agent,
          });
          if (result === undefined || result === null) {
            toolCallResult = "";
          } else if (typeof result === "string") {
            toolCallResult = result;
          } else {
            toolCallResult = JSON.stringify(result);
          }
        } catch (error) {
          const handlerError =
            error instanceof Error ? error : new Error(String(error));
          errorMessage = handlerError.message;
          await this._internal.emitError({
            error: handlerError,
            code: CopilotKitCoreErrorCode.TOOL_HANDLER_FAILED,
            context: {
              agentId: agentId,
              toolCallId: toolCall.id,
              toolName: toolCall.function.name,
              parsedArgs: wildcardArgs,
              toolType: "wildcard",
              messageId: message.id,
            },
          });
        }
      }

      if (errorMessage) {
        toolCallResult = `Error: ${errorMessage}`;
      }

      await this._internal.notifySubscribers(
        (subscriber) =>
          subscriber.onToolExecutionEnd?.({
            copilotkit: this.core,
            toolCallId: toolCall.id,
            agentId: agentId,
            toolName: toolCall.function.name,
            result: errorMessage ? "" : toolCallResult,
            error: errorMessage,
          }),
        "Subscriber onToolExecutionEnd error:",
      );
    }

    {
      const messageIndex = agent.messages.findIndex((m) => m.id === message.id);
      if (messageIndex === -1) {
        // Parent message no longer in agent's messages (e.g. thread was switched
        // while the tool handler was still executing). Skip result insertion and
        // do not request a follow-up to avoid mutating the wrong thread.
        return false;
      }
      // Find the correct insertion point: after the parent assistant message
      // and any tool-result messages already inserted for earlier tool calls
      // in the same batch. This preserves tool-result ordering relative to
      // the toolCalls array, which some providers (OpenAI) require.
      let insertAt = messageIndex + 1;
      while (
        insertAt < agent.messages.length &&
        agent.messages[insertAt]?.role === "tool"
      ) {
        insertAt++;
      }
      const toolMessage = {
        id: randomUUID(),
        role: "tool" as const,
        toolCallId: toolCall.id,
        content: toolCallResult,
      };
      agent.messages.splice(insertAt, 0, toolMessage);

      if (!errorMessage && wildcardTool?.followUp !== false) {
        return true; // Needs follow-up
      }
    }

    return false;
  }

  /**
   * Programmatically execute a registered frontend tool without going through an LLM turn.
   * The handler runs, render components show up in the UI, and both the tool call and
   * result messages are added to `agent.messages`.
   */
  async runTool(
    params: CopilotKitCoreRunToolParams,
  ): Promise<CopilotKitCoreRunToolResult> {
    const { name, agentId, parameters = {}, followUp = false } = params;

    // 1. Look up the tool
    const tool = this.getTool({ toolName: name, agentId });
    if (!tool) {
      const error = new Error(`Tool not found: ${name}`);
      await this._internal.emitError({
        error,
        code: CopilotKitCoreErrorCode.TOOL_NOT_FOUND,
        context: { toolName: name, agentId },
      });
      throw error;
    }

    // 2. Look up the agent
    const resolvedAgentId = agentId ?? "default";
    const agent = this._internal.getAgent(resolvedAgentId);
    if (!agent) {
      const error = new Error(`Agent not found: ${resolvedAgentId}`);
      await this._internal.emitError({
        error,
        code: CopilotKitCoreErrorCode.AGENT_NOT_FOUND,
        context: { agentId: resolvedAgentId },
      });
      throw error;
    }

    // 3. Create assistant message with tool call
    const toolCallId = randomUUID();
    const assistantToolCall = {
      id: toolCallId,
      type: "function" as const,
      function: {
        name,
        arguments: JSON.stringify(parameters),
      },
    };
    const assistantMessage: Message = {
      id: randomUUID(),
      role: "assistant",
      content: "",
      toolCalls: [assistantToolCall],
    };

    // 4. Push assistant message into agent's messages
    agent.messages.push(assistantMessage);

    // 5. Execute the tool handler (if it has one)
    let handlerResult: ExecuteToolHandlerResult = {
      result: "",
      error: undefined,
      isArgumentError: false,
    };

    if (tool.handler) {
      handlerResult = await this.executeToolHandler({
        tool,
        toolCall: assistantToolCall,
        agent,
        agentId: resolvedAgentId,
        handlerArgs: parameters,
        toolType: "runTool",
      });
    }

    // 6. Create and insert tool result message
    const toolResultMessage: Message = {
      id: randomUUID(),
      role: "tool",
      toolCallId,
      content: handlerResult.result,
    };

    const assistantIndex = agent.messages.findIndex(
      (m) => m.id === assistantMessage.id,
    );
    if (assistantIndex !== -1) {
      agent.messages.splice(assistantIndex + 1, 0, toolResultMessage);
    } else {
      // Fallback: push to end if assistant message was removed
      agent.messages.push(toolResultMessage);
    }

    // 7. Handle followUp (only if no error)
    if (!handlerResult.error && followUp !== false) {
      if (typeof followUp === "string" && followUp !== "generate") {
        // Custom text: add a user message first
        const userMessage: Message = {
          id: randomUUID(),
          role: "user",
          content: followUp,
        };
        agent.messages.push(userMessage);
      }
      // Yield to the framework scheduler so deferred state updates (e.g. React
      // useEffect in useAgentContext) can complete before the follow-up run reads
      // the context store. Mirrors the same yield in processAgentResult.
      await this._internal.waitForPendingFrameworkUpdates();
      // Trigger agent run for both "generate" and custom text
      await this.runAgent({ agent });
    }

    // 8. Return result
    return {
      toolCallId,
      result: handlerResult.result,
      error: handlerResult.error,
    };
  }

  /** Stable identity for a tool override: agent-scope + name (NUL-separated). */
  private capabilityKey(name: string, agentId?: string): string {
    return `${agentId ?? ""}\u0000${name}`;
  }

  /**
   * Enable/disable a registered frontend tool at runtime without unregistering
   * it. A disabled tool is omitted from {@link buildFrontendTools}, so the agent
   * never receives it. Unlike the per-tool `available` flag, this override
   * survives the tool being re-registered.
   */
  setToolEnabled(name: string, enabled: boolean, agentId?: string): void {
    const key = this.capabilityKey(name, agentId);
    if (enabled) {
      this._disabledToolKeys.delete(key);
    } else {
      this._disabledToolKeys.add(key);
    }
  }

  /** Whether a tool is currently enabled (not overridden off). Defaults true. */
  isToolEnabled(name: string, agentId?: string): boolean {
    return !this._disabledToolKeys.has(this.capabilityKey(name, agentId));
  }

  /**
   * Build frontend tools for an agent
   */
  buildFrontendTools(agentId?: string): Tool[] {
    return this.tools
      .filter(
        (tool) =>
          // A wildcard tool is a local catch-all handler (see
          // `executeWildcardTool`), not something the model can call —
          // advertising it would offer the agent a tool named `*`.
          tool.name !== WILDCARD_TOOL_NAME &&
          tool.available !== false &&
          (tool.available as boolean | string | undefined) !== "disabled" &&
          (!tool.agentId || tool.agentId === agentId) &&
          this.isToolEnabled(tool.name, tool.agentId),
      )
      .map((tool) => ({
        name: tool.name,
        description: tool.description ?? "",
        parameters: createToolSchema(tool),
      }));
  }

  /**
   * Create an agent error subscriber
   */
  private createAgentErrorSubscriber(agent: AbstractAgent): AgentSubscriber {
    const emitAgentError = async (
      error: Error,
      code: CopilotKitCoreErrorCode,
      extraContext: Record<string, any> = {},
    ) => {
      const context: Record<string, any> = { ...extraContext };
      if (agent.agentId) {
        context.agentId = agent.agentId;
      }
      await this._internal.emitError({
        error,
        code,
        context,
      });
    };

    return {
      onRunFailed: async ({ error }: { error: Error }) => {
        const code =
          error instanceof AgentThreadLockedError
            ? CopilotKitCoreErrorCode.AGENT_THREAD_LOCKED
            : CopilotKitCoreErrorCode.AGENT_RUN_FAILED_EVENT;
        await emitAgentError(error, code, {
          source: "onRunFailed",
        });
      },
      onRunErrorEvent: async ({ event }) => {
        // A user-initiated stop (stopAgent / agent.abortRun) makes the agent
        // emit a terminal RUN_ERROR — often code "abort" — as its cancellation
        // signal. That is expected, not a failure: surfacing it would pop an
        // error banner on Stop (#5966, follow-up to #5812). Mirror the
        // local-abort suppression on the runAgent/connectAgent paths and skip
        // it. Prefer the abort controller (the client's own record that it
        // initiated the stop) over the agent-supplied `code`, which is not
        // standardized across agents.
        const runWasAborted = this._runAbortController?.signal.aborted === true;
        if (runWasAborted || event?.code === "abort") {
          return;
        }

        const eventError =
          event?.rawEvent instanceof Error
            ? event.rawEvent
            : event?.rawEvent?.error instanceof Error
              ? event.rawEvent.error
              : undefined;

        const errorMessage =
          typeof event?.rawEvent?.error === "string"
            ? event.rawEvent.error
            : (event?.message ?? "Agent run error");

        const rawError = eventError ?? new Error(errorMessage);

        if (event?.code && !(rawError as any).code) {
          (rawError as any).code = event.code;
        }

        await emitAgentError(
          rawError,
          CopilotKitCoreErrorCode.AGENT_RUN_ERROR_EVENT,
          {
            source: "onRunErrorEvent",
            event,
            runtimeErrorCode: event?.code,
          },
        );
      },
    };
  }
}

/**
 * Empty tool schema constant
 */
const EMPTY_TOOL_SCHEMA = {
  type: "object",
  properties: {},
} as const satisfies Record<string, unknown>;

/**
 * Create a JSON schema from a tool's parameters
 */
function createToolSchema(tool: FrontendTool<any>): Record<string, unknown> {
  if (!tool.parameters) {
    return { ...EMPTY_TOOL_SCHEMA };
  }

  const rawSchema = schemaToJsonSchema(tool.parameters, {
    zodToJsonSchema: (schema, options) =>
      zodToJsonSchema(
        schema as Parameters<typeof zodToJsonSchema>[0],
        options as Parameters<typeof zodToJsonSchema>[1],
      ),
  });

  if (!rawSchema || typeof rawSchema !== "object") {
    return { ...EMPTY_TOOL_SCHEMA };
  }

  const { $schema: _$schema, ...schema } = rawSchema as Record<string, unknown>;

  if (typeof schema.type !== "string") {
    schema.type = "object";
  }
  if (typeof schema.properties !== "object" || schema.properties === null) {
    schema.properties = {};
  }

  stripAdditionalProperties(schema);
  return schema;
}

function stripAdditionalProperties(schema: unknown): void {
  if (!schema || typeof schema !== "object") {
    return;
  }

  if (Array.isArray(schema)) {
    schema.forEach(stripAdditionalProperties);
    return;
  }

  const record = schema as Record<string, unknown>;

  if (record.additionalProperties !== undefined) {
    delete record.additionalProperties;
  }

  for (const value of Object.values(record)) {
    stripAdditionalProperties(value);
  }
}

/**
 * Ensures parsed tool arguments are a plain object.
 * Throws for non-object values so the caller's catch block can emit
 * a structured TOOL_ARGUMENT_PARSE_FAILED error.
 *
 * @internal Exported for testing only.
 */
export function ensureObjectArgs(
  parsed: unknown,
  toolName: string,
): Record<string, unknown> {
  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  throw new Error(
    `Tool arguments for ${toolName} parsed to non-object (${typeof parsed})`,
  );
}

/**
 * Parses raw tool call arguments into a validated object.
 *
 * Some LLM providers (e.g. @ai-sdk/openai-compatible) may send empty string "",
 * null, or undefined instead of "{}". This function normalises those cases to an
 * empty object so callers don't crash on JSON.parse("").
 *
 * A debug-level warning is emitted when the fallback triggers so silent coercion
 * is observable in logs.
 *
 * @internal Exported for testing only.
 */
export function parseToolArguments(
  rawArgs: unknown,
  toolName: string,
): Record<string, unknown> {
  if (rawArgs === "" || rawArgs === null || rawArgs === undefined) {
    logger.debug(
      `[parseToolArguments] Tool "${toolName}" received empty/null/undefined arguments — defaulting to {}`,
    );
    return {};
  }
  const parsed = typeof rawArgs === "string" ? JSON.parse(rawArgs) : rawArgs;
  return ensureObjectArgs(parsed, toolName);
}
