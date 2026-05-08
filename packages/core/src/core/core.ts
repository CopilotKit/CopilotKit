import type { AbstractAgent, Context, State } from "@ag-ui/client";
import type { AgentSubscriber } from "@ag-ui/client";
import { Throttler } from "@tanstack/pacer";
import type {
  FrontendTool,
  SuggestionsConfig,
  Suggestion,
  CopilotRuntimeTransport,
  RuntimeMode,
  RuntimeLicenseStatus,
  IntelligenceRuntimeInfo,
} from "../types";
import type {
  CopilotKitCoreAddAgentParams,
  CopilotKitCoreRegisterProxiedAgentParams,
  CopilotKitCoreRegisterProxiedAgentResult,
} from "./agent-registry";
import { AgentRegistry } from "./agent-registry";
import { ContextStore } from "./context-store";
import { SuggestionEngine } from "./suggestion-engine";
import type {
  CopilotKitCoreRunAgentParams,
  CopilotKitCoreConnectAgentParams,
  CopilotKitCoreGetToolParams,
  CopilotKitCoreRunToolParams,
  CopilotKitCoreRunToolResult,
} from "./run-handler";
import { RunHandler } from "./run-handler";
import type { DebugConfig } from "@copilotkit/shared";
import { StateManager } from "./state-manager";
import { ThreadStoreRegistry } from "./thread-store-registry";
import type { ɵThreadStore } from "../threads";

/** Configuration options for `CopilotKitCore`. */
export interface CopilotKitCoreConfig {
  /** The endpoint of the CopilotRuntime. */
  runtimeUrl?: string;
  /** Transport style for CopilotRuntime endpoints. Defaults to REST. */
  runtimeTransport?: CopilotRuntimeTransport;
  /** Mapping from agent name to its `AbstractAgent` instance. For development only - production requires CopilotRuntime. */
  agents__unsafe_dev_only?: Record<string, AbstractAgent>;
  /** Headers appended to every HTTP request made by `CopilotKitCore`. */
  headers?: Record<string, string>;
  /** Credentials mode for fetch requests (e.g., "include" for HTTP-only cookies). */
  credentials?: RequestCredentials;
  /** Properties sent as `forwardedProps` to the AG-UI agent. */
  properties?: Record<string, unknown>;
  /** Ordered collection of frontend tools available to the core. */
  tools?: FrontendTool<any>[];
  /** Suggestions config for the core. */
  suggestionsConfig?: SuggestionsConfig[];
  /** Enable debug logging for the client-side event pipeline. */
  debug?: DebugConfig;
}

export type {
  CopilotKitCoreAddAgentParams,
  CopilotKitCoreRegisterProxiedAgentParams,
  CopilotKitCoreRegisterProxiedAgentResult,
};
export type {
  CopilotKitCoreRunAgentParams,
  CopilotKitCoreConnectAgentParams,
  CopilotKitCoreGetToolParams,
  CopilotKitCoreRunToolParams,
  CopilotKitCoreRunToolResult,
};

export interface CopilotKitCoreStopAgentParams {
  agent: AbstractAgent;
}

export type CopilotKitCoreGetSuggestionsResult = {
  suggestions: Suggestion[];
  isLoading: boolean;
};

export enum CopilotKitCoreErrorCode {
  RUNTIME_INFO_FETCH_FAILED = "runtime_info_fetch_failed",
  AGENT_CONNECT_FAILED = "agent_connect_failed",
  AGENT_RUN_FAILED = "agent_run_failed",
  AGENT_RUN_FAILED_EVENT = "agent_run_failed_event",
  AGENT_RUN_ERROR_EVENT = "agent_run_error_event",
  TOOL_ARGUMENT_PARSE_FAILED = "tool_argument_parse_failed",
  TOOL_HANDLER_FAILED = "tool_handler_failed",
  TOOL_NOT_FOUND = "tool_not_found",
  AGENT_NOT_FOUND = "agent_not_found",
  /**
   * Emitted when an agent run fails because the thread is already locked
   * by another active run.
   *
   * @example
   * ```tsx
   * <CopilotKitProvider
   *   onError={({ code, error, context }) => {
   *     if (code === "agent_thread_locked") {
   *       // Show "Agent is busy, retry?" UI
   *     }
   *   }}
   * />
   * ```
   */
  AGENT_THREAD_LOCKED = "agent_thread_locked",
  // Transcription errors
  TRANSCRIPTION_FAILED = "transcription_failed",
  TRANSCRIPTION_SERVICE_NOT_CONFIGURED = "transcription_service_not_configured",
  TRANSCRIPTION_INVALID_AUDIO = "transcription_invalid_audio",
  TRANSCRIPTION_RATE_LIMITED = "transcription_rate_limited",
  TRANSCRIPTION_AUTH_FAILED = "transcription_auth_failed",
  TRANSCRIPTION_NETWORK_ERROR = "transcription_network_error",
  SUBSCRIBER_CALLBACK_FAILED = "subscriber_callback_failed",
}

export interface CopilotKitCoreSubscriber {
  onRuntimeConnectionStatusChanged?: (event: {
    copilotkit: CopilotKitCore;
    status: CopilotKitCoreRuntimeConnectionStatus;
  }) => void | Promise<void>;
  onToolExecutionStart?: (event: {
    copilotkit: CopilotKitCore;
    toolCallId: string;
    agentId: string;
    toolName: string;
    args: unknown;
  }) => void | Promise<void>;
  onToolExecutionEnd?: (event: {
    copilotkit: CopilotKitCore;
    toolCallId: string;
    agentId: string;
    toolName: string;
    result: string;
    error?: string;
  }) => void | Promise<void>;
  onAgentsChanged?: (event: {
    copilotkit: CopilotKitCore;
    agents: Readonly<Record<string, AbstractAgent>>;
  }) => void | Promise<void>;
  onContextChanged?: (event: {
    copilotkit: CopilotKitCore;
    context: Readonly<Record<string, Context>>;
  }) => void | Promise<void>;
  onSuggestionsConfigChanged?: (event: {
    copilotkit: CopilotKitCore;
    suggestionsConfig: Readonly<Record<string, SuggestionsConfig>>;
  }) => void | Promise<void>;
  onSuggestionsChanged?: (event: {
    copilotkit: CopilotKitCore;
    agentId: string;
    suggestions: Suggestion[];
  }) => void | Promise<void>;
  onSuggestionsStartedLoading?: (event: {
    copilotkit: CopilotKitCore;
    agentId: string;
  }) => void | Promise<void>;
  onSuggestionsFinishedLoading?: (event: {
    copilotkit: CopilotKitCore;
    agentId: string;
  }) => void | Promise<void>;
  onPropertiesChanged?: (event: {
    copilotkit: CopilotKitCore;
    properties: Readonly<Record<string, unknown>>;
  }) => void | Promise<void>;
  onHeadersChanged?: (event: {
    copilotkit: CopilotKitCore;
    headers: Readonly<Record<string, string>>;
  }) => void | Promise<void>;
  onError?: (event: {
    copilotkit: CopilotKitCore;
    error: Error;
    code: CopilotKitCoreErrorCode;
    context: Record<string, any>;
  }) => void | Promise<void>;
  onThreadStoreRegistered?: (event: {
    copilotkit: CopilotKitCore;
    agentId: string;
    store: ɵThreadStore;
  }) => void | Promise<void>;
  /**
   * Fired when a thread store is removed from the registry, either by an
   * explicit `unregister()` call or by a `register()` call that replaces an
   * existing store for the same `agentId`.
   *
   * The previous store is delivered via `prevStore` so subscribers can tear
   * down state that depends on the concrete instance (e.g. cancel an active
   * subscription) without consulting the registry. By the time async
   * subscribers resume after an `await`, a replacement `register()` may have
   * already installed the new store under the same key, so calling
   * `registry.get(agentId)` inside this callback is unsafe and may return
   * the new store instead of the unregistered one.
   */
  onThreadStoreUnregistered?: (event: {
    copilotkit: CopilotKitCore;
    agentId: string;
    prevStore: ɵThreadStore;
  }) => void | Promise<void>;
}

// Subscription object returned by subscribe() and subscribeToAgentWithOptions()
export interface CopilotKitCoreSubscription {
  unsubscribe: () => void;
}

/**
 * The callback keys accepted by {@link CopilotKitCore.subscribeToAgentWithOptions}.
 * This tuple is the single source of truth — both the
 * `SubscribeToAgentSubscriber` type and the runtime `ALLOWED_KEYS` set
 * are derived from it, so they cannot desynchronise.
 */
const SUBSCRIBE_TO_AGENT_KEYS = [
  "onMessagesChanged",
  "onStateChanged",
  "onRunInitialized",
  "onRunFinalized",
  "onRunFailed",
  "onRunErrorEvent",
] as const satisfies readonly (keyof AgentSubscriber)[];

/**
 * Runtime allowlist derived from {@link SUBSCRIBE_TO_AGENT_KEYS}. Hoisted
 * to module scope so the Set is allocated once, not per-subscription.
 */
const ALLOWED_KEYS: ReadonlySet<(typeof SUBSCRIBE_TO_AGENT_KEYS)[number]> =
  new Set(SUBSCRIBE_TO_AGENT_KEYS);

/**
 * The subset of `AgentSubscriber` callbacks accepted by
 * {@link CopilotKitCore.subscribeToAgentWithOptions}. Only the callbacks
 * listed in {@link SUBSCRIBE_TO_AGENT_KEYS} are supported:
 * `onMessagesChanged`, `onStateChanged`, and the four run lifecycle
 * callbacks (`onRunInitialized`, `onRunFinalized`, `onRunFailed`,
 * `onRunErrorEvent`).
 *
 * Two categories of `AgentSubscriber` members are excluded:
 *
 * - **AG-UI event handlers** (`onEvent`, `onToolCallStartEvent`, etc.)
 *   return `AgentStateMutation` with `stopPropagation` — semantics that
 *   the throttle and error-protection wrappers cannot safely mediate.
 *
 * - **Per-item notification callbacks** (`onNewMessage`, `onNewToolCall`)
 *   return `void` and have no mutation concerns, but are excluded to keep
 *   the surface area minimal — `onMessagesChanged` already covers the
 *   same data at a coarser granularity, and throttling per-item callbacks
 *   would have different semantic expectations.
 *
 * `onRunErrorEvent` is technically an AG-UI event handler (its return type
 * includes `stopPropagation`), but it is included here because all
 * framework consumers need it to reset `isRunning` on protocol-level
 * `RUN_ERROR` events — distinct from `onRunFailed` which handles local
 * exceptions like network errors. In practice, consumers return `void`
 * from this callback, so the `stopPropagation` semantics are unused.
 *
 * Note: the included lifecycle callbacks return
 * `Omit<AgentStateMutation, "stopPropagation">` (or full
 * `AgentStateMutation` in the case of `onRunErrorEvent`). On the error
 * path, `safeCall` discards those return values (see its inline
 * documentation).
 *
 * Use `agent.subscribe()` directly when event mutation or per-item
 * notification semantics are needed.
 */
export type SubscribeToAgentSubscriber = Pick<
  AgentSubscriber,
  (typeof SUBSCRIBE_TO_AGENT_KEYS)[number]
>;

/** Options for {@link CopilotKitCore.subscribeToAgentWithOptions}. */
export interface SubscribeToAgentOptions {
  /**
   * Throttle interval (ms) for `onMessagesChanged` / `onStateChanged`.
   * Non-negative finite number; `0` explicitly disables throttling.
   * Falls back to `defaultThrottleMs` when `undefined`.
   */
  throttleMs?: number;
}

export enum CopilotKitCoreRuntimeConnectionStatus {
  Disconnected = "disconnected",
  Connected = "connected",
  Connecting = "connecting",
  Error = "error",
}

/**
 * Internal interface for delegate classes to access CopilotKitCore methods.
 * This provides type safety while allowing controlled access to private functionality.
 */
export interface CopilotKitCoreFriendsAccess {
  // Notification methods
  notifySubscribers(
    handler: (subscriber: CopilotKitCoreSubscriber) => void | Promise<void>,
    errorMessage: string,
  ): Promise<void>;

  emitError(params: {
    error: Error;
    code: CopilotKitCoreErrorCode;
    context?: Record<string, any>;
  }): Promise<void>;

  // Getters for internal state
  readonly headers: Readonly<Record<string, string>>;
  readonly credentials: RequestCredentials | undefined;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly context: Readonly<Record<string, Context>>;
  readonly debug?: DebugConfig;

  // Internal methods
  buildFrontendTools(agentId?: string): import("@ag-ui/client").Tool[];
  getAgent(id: string): AbstractAgent | undefined;

  // References to delegate subsystems
  readonly suggestionEngine: {
    clearSuggestions(agentId: string): void;
    reloadSuggestions(agentId: string): void;
  };

  /**
   * Called before each follow-up agent run (after tool execution).
   * See CopilotKitCore.waitForPendingFrameworkUpdates for details.
   */
  waitForPendingFrameworkUpdates(): Promise<void>;
}

export class CopilotKitCore {
  private _headers: Record<string, string>;
  private _credentials?: RequestCredentials;
  private _properties: Record<string, unknown>;
  private _defaultThrottleMs?: number;
  private _debug?: DebugConfig;

  private subscribers: Set<CopilotKitCoreSubscriber> = new Set();

  // Delegate classes
  private agentRegistry: AgentRegistry;
  private contextStore: ContextStore;
  private suggestionEngine: SuggestionEngine;
  private runHandler: RunHandler;
  private stateManager: StateManager;
  private threadStoreRegistry: ThreadStoreRegistry;
  /**
   * Tracks the agent IDs from the most recent `onAgentsChanged` notification.
   * Used to gate thread-store auto-unregister so the FIRST empty-agents
   * notification (before published agents are merged in) does not rip out a
   * store that was registered prior to that initial notification.
   */
  private previousAgentIds: Set<string> = new Set();

  constructor({
    runtimeUrl,
    runtimeTransport = "auto",
    headers = {},
    credentials,
    properties = {},
    agents__unsafe_dev_only = {},
    tools = [],
    suggestionsConfig = [],
    debug,
  }: CopilotKitCoreConfig) {
    this._headers = headers;
    this._credentials = credentials;
    this._properties = properties;
    this._debug = debug;

    // Initialize delegate classes
    this.agentRegistry = new AgentRegistry(this);
    this.contextStore = new ContextStore(this);
    this.suggestionEngine = new SuggestionEngine(this);
    this.runHandler = new RunHandler(this);
    this.stateManager = new StateManager(this);
    this.threadStoreRegistry = new ThreadStoreRegistry(this);

    // Initialize each subsystem
    this.agentRegistry.initialize(agents__unsafe_dev_only);
    this.runHandler.initialize(tools);
    this.suggestionEngine.initialize(suggestionsConfig);
    this.stateManager.initialize();

    this.agentRegistry.setRuntimeTransport(runtimeTransport);
    this.agentRegistry.setRuntimeUrl(runtimeUrl);

    // Seed the previous-agents snapshot from the constructor-supplied agents.
    // `agentRegistry.initialize` does not emit `onAgentsChanged`, so the
    // subscriber below would otherwise see its first non-empty notification
    // as an "addition" relative to an empty baseline — and a later removal
    // of those same agents would NOT trigger the auto-unregister branch
    // because the guard would think the agentId was never previously
    // present. Seeding the set here keeps the guard honest.
    this.previousAgentIds = new Set(Object.keys(agents__unsafe_dev_only));

    // Subscribe to agent changes to track state for new agents
    this.subscribe({
      onAgentsChanged: ({ agents }) => {
        Object.values(agents).forEach((agent) => {
          if (agent.agentId) {
            this.stateManager.subscribeToAgent(agent);
          }
        });

        // Unregister thread stores for agents that have been removed.
        //
        // Critically, only unregister an agentId that was present in the
        // PREVIOUS agents snapshot AND is missing from the new one. Without
        // the "previously had" guard, the FIRST `onAgentsChanged({ agents: {} })`
        // delivered to a freshly-published core would tear out a thread store
        // that a consumer (e.g. useThreads) just registered — `core.agents`
        // is asynchronously populated and the empty-map notification fires
        // before the published agents are merged in.
        const currentAgentIds = new Set(Object.keys(agents));
        // Each iteration is wrapped so a throw on one id does not stall
        // cleanup for the rest of the set. Both registries' unregister
        // paths are idempotent, so re-attempts on the next
        // onAgentsChanged are safe.
        for (const agentId of Object.keys(this.threadStoreRegistry.getAll())) {
          if (
            this.previousAgentIds.has(agentId) &&
            !currentAgentIds.has(agentId)
          ) {
            try {
              this.threadStoreRegistry.unregister(agentId);
            } catch (err) {
              console.error(
                `CopilotKitCore.onAgentsChanged: threadStoreRegistry.unregister failed for "${agentId}":`,
                err,
              );
            }
          }
        }

        // Symmetric cleanup for state-manager subscriptions: any agentId
        // that disappeared from the registry (e.g. via `unregister()` from
        // a registerProxiedAgent caller) should release its StateManager
        // subscription. Without this, the subscription leaks — events from
        // a still-running observable on the removed agent would continue
        // to populate stateByRun/messageToRun for the dead id.
        for (const agentId of this.previousAgentIds) {
          if (!currentAgentIds.has(agentId)) {
            try {
              this.stateManager.unsubscribeFromAgent(agentId);
            } catch (err) {
              console.error(
                `CopilotKitCore.onAgentsChanged: stateManager.unsubscribeFromAgent failed for "${agentId}":`,
                err,
              );
            }
          }
        }

        this.previousAgentIds = currentAgentIds;
      },
    });
  }

  /**
   * Internal method used by delegate classes and subclasses to notify subscribers
   */
  protected async notifySubscribers(
    handler: (subscriber: CopilotKitCoreSubscriber) => void | Promise<void>,
    errorMessage: string,
  ): Promise<void> {
    await Promise.all(
      Array.from(this.subscribers).map(async (subscriber) => {
        try {
          await handler(subscriber);
        } catch (error) {
          console.error(errorMessage, error);
        }
      }),
    );
  }

  /**
   * Internal method used by delegate classes to emit errors
   */
  private async emitError({
    error,
    code,
    context = {},
  }: {
    error: Error;
    code: CopilotKitCoreErrorCode;
    context?: Record<string, any>;
  }): Promise<void> {
    await this.notifySubscribers(
      (subscriber) =>
        subscriber.onError?.({
          copilotkit: this,
          error,
          code,
          context,
        }),
      "Subscriber onError error:",
    );
  }

  /**
   * Log a message to the console and emit an error to subscribers.
   * Catches failures from `emitError` itself to prevent unhandled rejections.
   */
  private logAndEmitError(
    message: string,
    params: {
      error: Error;
      code: CopilotKitCoreErrorCode;
      context?: Record<string, any>;
    },
    logLevel: "error" | "warn" = "error",
  ): void {
    console[logLevel](message, params.error);
    this.emitError(params).catch((emitErr: unknown) => {
      console.error(message + " — emitError itself failed:", emitErr);
    });
  }

  /**
   * Snapshot accessors
   */
  get context(): Readonly<Record<string, Context>> {
    return this.contextStore.context;
  }

  get agents(): Readonly<Record<string, AbstractAgent>> {
    return this.agentRegistry.agents;
  }

  get tools(): Readonly<FrontendTool<any>[]> {
    return this.runHandler.tools;
  }

  get runtimeUrl(): string | undefined {
    return this.agentRegistry.runtimeUrl;
  }

  setRuntimeUrl(runtimeUrl: string | undefined): void {
    this.agentRegistry.setRuntimeUrl(runtimeUrl);
  }

  get runtimeTransport(): CopilotRuntimeTransport {
    return this.agentRegistry.runtimeTransport;
  }

  setRuntimeTransport(runtimeTransport: CopilotRuntimeTransport): void {
    this.agentRegistry.setRuntimeTransport(runtimeTransport);
  }

  get runtimeVersion(): string | undefined {
    return this.agentRegistry.runtimeVersion;
  }

  get headers(): Readonly<Record<string, string>> {
    return this._headers;
  }

  get credentials(): RequestCredentials | undefined {
    return this._credentials;
  }

  get properties(): Readonly<Record<string, unknown>> {
    return this._properties;
  }

  /**
   * Default throttle interval (ms) used by `subscribeToAgentWithOptions()`
   * when the caller does not specify an explicit `throttleMs`.
   * `undefined` means no default is configured; `0` means no throttling.
   */
  get defaultThrottleMs(): number | undefined {
    return this._defaultThrottleMs;
  }

  /**
   * Set the default throttle interval (ms) for `subscribeToAgentWithOptions()`.
   *
   * Accepts a non-negative finite number or `undefined` (to clear the
   * default). Invalid values (NaN, Infinity, negative) are logged as
   * errors and ignored — the previous valid value is preserved.
   */
  setDefaultThrottleMs(value: number | undefined): void {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      this.logAndEmitError(
        `CopilotKitCore.setDefaultThrottleMs: value must be a non-negative finite number or undefined, ` +
          `got ${value}. Keeping current value (${this._defaultThrottleMs}).`,
        {
          error: new Error(
            `setDefaultThrottleMs: invalid value (${value}), keeping current value (${this._defaultThrottleMs})`,
          ),
          code: CopilotKitCoreErrorCode.SUBSCRIBER_CALLBACK_FAILED,
          context: { value, currentValue: this._defaultThrottleMs },
        },
      );
      return;
    }
    this._defaultThrottleMs = value;
  }

  get debug(): DebugConfig | undefined {
    return this._debug;
  }

  setDebug(debug: DebugConfig | undefined): void {
    this._debug = debug;
  }

  get runtimeConnectionStatus(): CopilotKitCoreRuntimeConnectionStatus {
    return this.agentRegistry.runtimeConnectionStatus;
  }

  get audioFileTranscriptionEnabled(): boolean {
    return this.agentRegistry.audioFileTranscriptionEnabled;
  }

  get runtimeMode(): RuntimeMode {
    return this.agentRegistry.runtimeMode;
  }

  get intelligence(): IntelligenceRuntimeInfo | undefined {
    return this.agentRegistry.intelligence;
  }

  get a2uiEnabled(): boolean {
    return this.agentRegistry.a2uiEnabled;
  }

  get openGenerativeUIEnabled(): boolean {
    return this.agentRegistry.openGenerativeUIEnabled;
  }

  get licenseStatus(): RuntimeLicenseStatus | undefined {
    return this.agentRegistry.licenseStatus;
  }

  /**
   * Configuration updates
   */
  setHeaders(headers: Record<string, string>): void {
    this._headers = headers;
    this.agentRegistry.applyHeadersToAgents(
      this.agentRegistry.agents as Record<string, AbstractAgent>,
    );
    void this.notifySubscribers(
      (subscriber) =>
        subscriber.onHeadersChanged?.({
          copilotkit: this,
          headers: this.headers,
        }),
      "Subscriber onHeadersChanged error:",
    );
  }

  setCredentials(credentials: RequestCredentials | undefined): void {
    this._credentials = credentials;
    this.agentRegistry.applyCredentialsToAgents(
      this.agentRegistry.agents as Record<string, AbstractAgent>,
    );
  }

  setProperties(properties: Record<string, unknown>): void {
    this._properties = properties;
    void this.notifySubscribers(
      (subscriber) =>
        subscriber.onPropertiesChanged?.({
          copilotkit: this,
          properties: this.properties,
        }),
      "Subscriber onPropertiesChanged error:",
    );
  }

  /**
   * Agent management (delegated to AgentRegistry)
   */
  setAgents__unsafe_dev_only(agents: Record<string, AbstractAgent>): void {
    this.agentRegistry.setAgents__unsafe_dev_only(agents);
  }

  addAgent__unsafe_dev_only(params: CopilotKitCoreAddAgentParams): void {
    this.agentRegistry.addAgent__unsafe_dev_only(params);
  }

  removeAgent__unsafe_dev_only(id: string): void {
    this.agentRegistry.removeAgent__unsafe_dev_only(id);
  }

  /**
   * Register a proxied agent against an existing runtime agent. The proxy is
   * exposed under `agentId` (local registry id) and routes outbound runtime
   * requests to `runtimeAgentId`. Throws if `agentId` is already taken.
   *
   * Returns the minted proxy and an `unregister` handle for cleanup.
   *
   * Use this to mount multiple frontend agents against a single runtime
   * agent (e.g. one per chat window) without implicit per-thread cloning.
   *
   * @example
   * const { agent, unregister } = copilotkit.registerProxiedAgent({
   *   agentId: "chat-1",
   *   runtimeAgentId: "default",
   * });
   * // ... <CopilotChat agentId="chat-1" />
   * // on cleanup:
   * unregister();
   */
  registerProxiedAgent(
    params: CopilotKitCoreRegisterProxiedAgentParams,
  ): CopilotKitCoreRegisterProxiedAgentResult {
    return this.agentRegistry.registerProxiedAgent(params);
  }

  getAgent(id: string): AbstractAgent | undefined {
    return this.agentRegistry.getAgent(id);
  }

  /**
   * Context management (delegated to ContextStore)
   */
  addContext(context: Context): string {
    return this.contextStore.addContext(context);
  }

  removeContext(id: string): void {
    this.contextStore.removeContext(id);
  }

  /**
   * Thread store registry (delegated to ThreadStoreRegistry)
   */
  registerThreadStore(agentId: string, store: ɵThreadStore): void {
    this.threadStoreRegistry.register(agentId, store);
  }

  unregisterThreadStore(agentId: string): void {
    this.threadStoreRegistry.unregister(agentId);
  }

  getThreadStore(agentId: string): ɵThreadStore | undefined {
    return this.threadStoreRegistry.get(agentId);
  }

  getThreadStores(): Readonly<Record<string, ɵThreadStore>> {
    return this.threadStoreRegistry.getAll();
  }

  /**
   * Suggestions management (delegated to SuggestionEngine)
   */
  addSuggestionsConfig(config: SuggestionsConfig): string {
    return this.suggestionEngine.addSuggestionsConfig(config);
  }

  removeSuggestionsConfig(id: string): void {
    this.suggestionEngine.removeSuggestionsConfig(id);
  }

  reloadSuggestions(agentId: string): void {
    this.suggestionEngine.reloadSuggestions(agentId);
  }

  clearSuggestions(agentId: string): void {
    this.suggestionEngine.clearSuggestions(agentId);
  }

  getSuggestions(agentId: string): CopilotKitCoreGetSuggestionsResult {
    return this.suggestionEngine.getSuggestions(agentId);
  }

  /**
   * Tool management (delegated to RunHandler)
   */
  addTool<T extends Record<string, unknown> = Record<string, unknown>>(
    tool: FrontendTool<T>,
  ): void {
    this.runHandler.addTool(tool);
  }

  removeTool(id: string, agentId?: string): void {
    this.runHandler.removeTool(id, agentId);
  }

  getTool(params: CopilotKitCoreGetToolParams): FrontendTool<any> | undefined {
    return this.runHandler.getTool(params);
  }

  setTools(tools: FrontendTool<any>[]): void {
    this.runHandler.setTools(tools);
  }

  /**
   * Subscription lifecycle
   */
  subscribe(subscriber: CopilotKitCoreSubscriber): CopilotKitCoreSubscription {
    this.subscribers.add(subscriber);

    // Return subscription with unsubscribe method
    return {
      unsubscribe: () => {
        this.subscribers.delete(subscriber);
      },
    };
  }

  /**
   * Subscribe to an agent's notification and lifecycle events with
   * optional configuration (e.g. throttling).
   *
   * Wraps every callback with error protection (`safeCall`) and applies
   * the options before delegating to `agent.subscribe()`.
   *
   * See {@link SubscribeToAgentSubscriber} for the accepted callback subset
   * and the rationale for excluding AG-UI event handlers.
   */
  subscribeToAgentWithOptions(
    agent: AbstractAgent,
    subscriber: SubscribeToAgentSubscriber,
    options?: SubscribeToAgentOptions,
  ): CopilotKitCoreSubscription {
    const resolved = options?.throttleMs ?? this._defaultThrottleMs ?? 0;

    let effectiveMs = 0;
    if (!Number.isFinite(resolved) || resolved < 0) {
      const source =
        options?.throttleMs !== undefined ? "throttleMs" : "defaultThrottleMs";
      this.logAndEmitError(
        `CopilotKitCore.subscribeToAgentWithOptions: ${source} must be a non-negative finite number, ` +
          `got ${resolved}. Falling back to unthrottled.`,
        {
          error: new Error(
            `subscribeToAgentWithOptions: invalid ${source} (${resolved}), falling back to unthrottled`,
          ),
          code: CopilotKitCoreErrorCode.SUBSCRIBER_CALLBACK_FAILED,
          context: { agentId: agent.agentId, source, value: resolved },
        },
      );
    } else {
      effectiveMs = resolved;
    }

    const agentLabel = agent.agentId || "(unknown agent)";

    // Wraps a callback so that synchronous throws and async rejections are
    // caught, logged, and emitted — preventing one failing callback from
    // corrupting the agent's notification loop.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const safeCall = <F extends (...args: any[]) => any>(
      label: string,
      fn: F,
      ...args: Parameters<F>
    ): any => {
      const reportError = (err: unknown, verb: string) => {
        this.logAndEmitError(
          `CopilotKitCore.subscribeToAgentWithOptions[${agentLabel}]: ${label} callback ${verb}:`,
          {
            error: err instanceof Error ? err : new Error(String(err)),
            code: CopilotKitCoreErrorCode.SUBSCRIBER_CALLBACK_FAILED,
            context: { agentId: agent.agentId, callback: label },
          },
        );
      };
      try {
        const result = fn(...args);
        if (result instanceof Promise) {
          return result.catch((err: unknown) => {
            reportError(err, "rejected");
          });
        }
        return result;
      } catch (err) {
        reportError(err, "threw");
      }
    };

    const guardAll = (
      sub: SubscribeToAgentSubscriber,
    ): SubscribeToAgentSubscriber => {
      const guarded: SubscribeToAgentSubscriber = {};
      if (sub.onMessagesChanged) {
        const fn = sub.onMessagesChanged;
        guarded.onMessagesChanged = (params) =>
          safeCall("onMessagesChanged", fn, params);
      }
      if (sub.onStateChanged) {
        const fn = sub.onStateChanged;
        guarded.onStateChanged = (params) =>
          safeCall("onStateChanged", fn, params);
      }
      if (sub.onRunInitialized) {
        const fn = sub.onRunInitialized;
        guarded.onRunInitialized = (params) =>
          safeCall("onRunInitialized", fn, params);
      }
      if (sub.onRunFinalized) {
        const fn = sub.onRunFinalized;
        guarded.onRunFinalized = (params) =>
          safeCall("onRunFinalized", fn, params);
      }
      if (sub.onRunFailed) {
        const fn = sub.onRunFailed;
        guarded.onRunFailed = (params) => safeCall("onRunFailed", fn, params);
      }
      if (sub.onRunErrorEvent) {
        const fn = sub.onRunErrorEvent;
        guarded.onRunErrorEvent = (params) =>
          safeCall("onRunErrorEvent", fn, params);
      }
      return guarded;
    };

    // Warn about unsupported keys so JS / `as any` consumers get diagnostics.
    for (const key of Object.keys(subscriber)) {
      if (
        typeof (subscriber as Record<string, unknown>)[key] === "function" &&
        !(ALLOWED_KEYS as ReadonlySet<string>).has(key)
      ) {
        const message =
          `CopilotKitCore.subscribeToAgentWithOptions[${agentLabel}]: callback "${key}" is not supported ` +
          `and was dropped. Supported callbacks: ${Array.from(ALLOWED_KEYS).join(", ")}. ` +
          `Use agent.subscribe() directly for event handlers and per-item notifications.`;
        this.logAndEmitError(
          message,
          {
            error: new Error(message),
            code: CopilotKitCoreErrorCode.SUBSCRIBER_CALLBACK_FAILED,
            context: { agentId: agent.agentId, droppedCallback: key },
          },
          "warn",
        );
      }
    }

    // No throttle — guard callbacks and subscribe directly.
    if (effectiveMs <= 0) {
      const subscription = agent.subscribe(guardAll(subscriber));
      return { unsubscribe: () => subscription.unsubscribe() };
    }

    // Throttled path: lifecycle callbacks fire immediately; onMessagesChanged
    // and onStateChanged share a single Throttler that flushes the latest
    // params for both channels.
    let active = true;
    let latestMessagesParams:
      | Parameters<
          NonNullable<SubscribeToAgentSubscriber["onMessagesChanged"]>
        >[0]
      | null = null;
    let latestStateParams:
      | Parameters<NonNullable<SubscribeToAgentSubscriber["onStateChanged"]>>[0]
      | null = null;

    const flushPending = () => {
      if (active && subscriber.onMessagesChanged && latestMessagesParams) {
        const params = latestMessagesParams;
        latestMessagesParams = null;
        safeCall("onMessagesChanged", subscriber.onMessagesChanged, params);
      }
      if (active && subscriber.onStateChanged && latestStateParams) {
        const params = latestStateParams;
        latestStateParams = null;
        safeCall("onStateChanged", subscriber.onStateChanged, params);
      }
    };

    const throttler = new Throttler(flushPending, {
      wait: effectiveMs,
      leading: true,
      trailing: true,
    });

    // Lifecycle callbacks are guarded but never throttled.
    const lifecycleOnly: SubscribeToAgentSubscriber = {};
    if (subscriber.onRunInitialized)
      lifecycleOnly.onRunInitialized = subscriber.onRunInitialized;
    if (subscriber.onRunFinalized)
      lifecycleOnly.onRunFinalized = subscriber.onRunFinalized;
    if (subscriber.onRunFailed)
      lifecycleOnly.onRunFailed = subscriber.onRunFailed;
    if (subscriber.onRunErrorEvent)
      lifecycleOnly.onRunErrorEvent = subscriber.onRunErrorEvent;

    const wrappedSubscriber: SubscribeToAgentSubscriber =
      guardAll(lifecycleOnly);

    if (subscriber.onMessagesChanged) {
      wrappedSubscriber.onMessagesChanged = (params) => {
        latestMessagesParams = params;
        throttler.maybeExecute();
      };
    }

    if (subscriber.onStateChanged) {
      wrappedSubscriber.onStateChanged = (params) => {
        latestStateParams = params;
        throttler.maybeExecute();
      };
    }

    const subscription = agent.subscribe(wrappedSubscriber);

    return {
      unsubscribe: () => {
        active = false;
        throttler.cancel();
        subscription.unsubscribe();
      },
    };
  }

  /**
   * Agent connectivity (delegated to RunHandler)
   */
  async connectAgent(
    params: CopilotKitCoreConnectAgentParams,
  ): Promise<import("@ag-ui/client").RunAgentResult> {
    return this.runHandler.connectAgent(params);
  }

  stopAgent(params: CopilotKitCoreStopAgentParams): void {
    this.runHandler.abortCurrentRun();
    params.agent.abortRun();
  }

  async runAgent(
    params: CopilotKitCoreRunAgentParams,
  ): Promise<import("@ag-ui/client").RunAgentResult> {
    return this.runHandler.runAgent(params);
  }

  /**
   * Programmatically execute a registered frontend tool without going through an LLM turn.
   * The handler runs, render components show up in the UI, and both the tool call and
   * result messages are added to `agent.messages`.
   */
  async runTool(
    params: CopilotKitCoreRunToolParams,
  ): Promise<CopilotKitCoreRunToolResult> {
    return this.runHandler.runTool(params);
  }

  /**
   * State management (delegated to StateManager)
   */
  getStateByRun(
    agentId: string,
    threadId: string,
    runId: string,
  ): State | undefined {
    return this.stateManager.getStateByRun(agentId, threadId, runId);
  }

  getRunIdForMessage(
    agentId: string,
    threadId: string,
    messageId: string,
  ): string | undefined {
    return this.stateManager.getRunIdForMessage(agentId, threadId, messageId);
  }

  getRunIdsForThread(agentId: string, threadId: string): string[] {
    return this.stateManager.getRunIdsForThread(agentId, threadId);
  }

  /**
   * Internal method used by RunHandler to build frontend tools
   */
  private buildFrontendTools(agentId?: string): import("@ag-ui/client").Tool[] {
    return this.runHandler.buildFrontendTools(agentId);
  }

  /**
   * Called before each follow-up agent run (after tool execution).
   *
   * When a frontend tool handler calls framework state setters (e.g. React's
   * setState), those updates are batched and deferred — they do not take effect
   * until the framework's scheduler runs (React uses MessageChannel).
   * useAgentContext registers context via useLayoutEffect, which runs
   * synchronously after React commits that deferred batch.
   *
   * Without yielding here, the follow-up runAgent reads the context store
   * synchronously while the deferred updates are still pending, producing stale
   * context for the next agent turn.
   *
   * Override in framework-specific subclasses to yield to the framework
   * scheduler before the follow-up run. The base implementation is a no-op
   * because non-React environments have no deferred state to flush.
   */
  async waitForPendingFrameworkUpdates(): Promise<void> {}
}
