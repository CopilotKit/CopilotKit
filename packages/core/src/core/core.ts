import {
  AbstractAgent,
  type AgentSubscriber,
  Context,
  State,
} from "@ag-ui/client";
import {
  FrontendTool,
  SuggestionsConfig,
  Suggestion,
  CopilotRuntimeTransport,
  RuntimeMode,
  RuntimeLicenseStatus,
  IntelligenceRuntimeInfo,
} from "../types";
import { AgentRegistry, CopilotKitCoreAddAgentParams } from "./agent-registry";
import { ContextStore } from "./context-store";
import { SuggestionEngine } from "./suggestion-engine";
import {
  RunHandler,
  CopilotKitCoreRunAgentParams,
  CopilotKitCoreConnectAgentParams,
  CopilotKitCoreGetToolParams,
  CopilotKitCoreRunToolParams,
  CopilotKitCoreRunToolResult,
} from "./run-handler";
import { DebugConfig } from "@copilotkit/shared";
import { StateManager } from "./state-manager";

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

export type { CopilotKitCoreAddAgentParams };
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
  /**
   * Fired when an agent run or connect begins. The `agent` may be a per-thread
   * clone that is not present in `core.agents`. Subscribers (e.g. the inspector)
   * can use this to subscribe to the clone's AG-UI events.
   */
  onAgentRunStarted?: (event: {
    copilotkit: CopilotKitCore;
    agent: AbstractAgent;
  }) => void | Promise<void>;
}

// Subscription object returned by subscribe() and subscribeToAgent()
export interface CopilotKitCoreSubscription {
  unsubscribe: () => void;
}

/**
 * The subset of `AgentSubscriber` callbacks accepted by
 * {@link CopilotKitCore.subscribeToAgent}. Only high-level notification
 * and lifecycle callbacks are supported. AG-UI event handlers (e.g.
 * `onEvent`, `onToolCallStartEvent`) are excluded because
 * `subscribeToAgent` is designed for observation, not event mutation.
 * Event handlers participate in the agent's event processing pipeline
 * and may return `AgentStateMutation` with `stopPropagation` — semantics
 * that the throttle and error-protection wrappers cannot safely mediate.
 * Use `agent.subscribe()` directly when event mutation semantics are needed.
 */
export type SubscribeToAgentSubscriber = Pick<
  AgentSubscriber,
  | "onMessagesChanged"
  | "onStateChanged"
  | "onRunInitialized"
  | "onRunFinalized"
  | "onRunFailed"
>;

/** Options for {@link CopilotKitCore.subscribeToAgent}. */
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

  /**
   * Subscribe the state manager to an agent (including per-thread clones).
   * Called by RunHandler before executing an agent so that events from
   * clones are tracked in stateByRun/messageToRun.
   */
  subscribeAgentToStateManager(agent: AbstractAgent): void;
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

    // Initialize each subsystem
    this.agentRegistry.initialize(agents__unsafe_dev_only);
    this.runHandler.initialize(tools);
    this.suggestionEngine.initialize(suggestionsConfig);
    this.stateManager.initialize();

    this.agentRegistry.setRuntimeTransport(runtimeTransport);
    this.agentRegistry.setRuntimeUrl(runtimeUrl);

    // Subscribe to agent changes to track state for new agents
    this.subscribe({
      onAgentsChanged: ({ agents }) => {
        Object.values(agents).forEach((agent) => {
          if (agent.agentId) {
            this.stateManager.subscribeToAgent(agent);
          }
        });
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
   * Default throttle interval (ms) used by `subscribeToAgent()` when the
   * caller does not specify an explicit `throttleMs`. A value of `0` means
   * no throttling. Invalid values (negative, non-finite) are logged as
   * errors and ignored, preserving the current value.
   */
  get defaultThrottleMs(): number | undefined {
    return this._defaultThrottleMs;
  }

  setDefaultThrottleMs(value: number | undefined): void {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      console.error(
        `CopilotKitCore.setDefaultThrottleMs: value must be a non-negative finite number or undefined, ` +
          `got ${value}. Keeping current value (${this._defaultThrottleMs}).`,
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
   * Subscribe to an agent's notification and lifecycle events with optional
   * throttling on `onMessagesChanged` and `onStateChanged`.
   *
   * Resolves effective throttle: `options.throttleMs ?? defaultThrottleMs ?? 0`.
   * When > 0, uses a leading+trailing pattern: first notification fires
   * immediately, subsequent ones within the window are coalesced, and a
   * trailing timer ensures the most recent update fires after the window.
   * Both `onMessagesChanged` and `onStateChanged` share a single throttle
   * window; a notification from either channel opens the window.
   *
   * Run lifecycle callbacks (`onRunInitialized`, `onRunFinalized`,
   * `onRunFailed`) always fire immediately — they are never throttled.
   *
   * Every callback is wrapped with error protection so a throwing or
   * rejecting callback cannot corrupt the agent's notification loop.
   *
   * Only high-level notification and lifecycle callbacks are accepted.
   * AG-UI event handlers (e.g. `onEvent`, `onToolCallStartEvent`) are
   * excluded because `subscribeToAgent` is designed for observation, not
   * event mutation. Event handlers participate in the agent's event
   * processing pipeline and may return `AgentStateMutation` with
   * `stopPropagation` — semantics that the throttle and error-protection
   * wrappers cannot safely mediate. Use `agent.subscribe()` directly
   * when event mutation semantics are needed.
   *
   * The returned `unsubscribe()` clears any pending trailing timer.
   */
  subscribeToAgent(
    agent: AbstractAgent,
    subscriber: SubscribeToAgentSubscriber,
    options?: SubscribeToAgentOptions,
  ): CopilotKitCoreSubscription {
    const resolved = options?.throttleMs ?? this._defaultThrottleMs ?? 0;

    let effectiveMs = 0;
    if (!Number.isFinite(resolved) || resolved < 0) {
      const source =
        options?.throttleMs !== undefined ? "throttleMs" : "defaultThrottleMs";
      console.error(
        `CopilotKitCore.subscribeToAgent: ${source} must be a non-negative finite number, ` +
          `got ${resolved}. Falling back to unthrottled.`,
      );
    } else {
      effectiveMs = resolved;
    }

    const agentLabel = agent.agentId || "(unknown agent)";

    // Invoke a subscriber callback safely: catches synchronous throws and
    // attaches a .catch() for async (MaybePromise) rejections.
    const safeCall = (
      label: string,
      fn: (...args: any[]) => any,
      ...args: any[]
    ): any => {
      try {
        const result = fn(...args);
        if (result != null && typeof (result as any).then === "function") {
          return (result as Promise<any>).catch((err: unknown) => {
            console.error(
              `CopilotKitCore.subscribeToAgent[${agentLabel}]: ${label} callback rejected:`,
              err,
            );
          });
        }
        return result;
      } catch (err) {
        console.error(
          `CopilotKitCore.subscribeToAgent[${agentLabel}]: ${label} callback threw:`,
          err,
        );
      }
    };

    // Keys accepted by subscribeToAgent — used by guardAll to filter out
    // any extra properties that slip through at runtime (e.g. from JS
    // consumers or `as any` casts), ensuring unsupported event handlers
    // are dropped rather than wrapped with a potentially-lossy layer.
    const ALLOWED_KEYS: ReadonlySet<keyof SubscribeToAgentSubscriber> = new Set(
      [
        "onMessagesChanged",
        "onStateChanged",
        "onRunInitialized",
        "onRunFinalized",
        "onRunFailed",
      ] as const satisfies readonly (keyof SubscribeToAgentSubscriber)[],
    );

    // Wrap every allowed callback in the subscriber with safeCall so errors
    // in any callback cannot corrupt the agent's notification loop.
    const guardAll = (
      sub: SubscribeToAgentSubscriber,
    ): SubscribeToAgentSubscriber => {
      const guarded: SubscribeToAgentSubscriber = {};
      for (const [key, value] of Object.entries(sub)) {
        if (
          typeof value === "function" &&
          ALLOWED_KEYS.has(key as keyof SubscribeToAgentSubscriber)
        ) {
          (guarded as any)[key] = (...args: any[]) =>
            safeCall(key, value as (...a: any[]) => any, ...args);
        }
      }
      return guarded;
    };

    if (effectiveMs <= 0) {
      const subscription = agent.subscribe(guardAll(subscriber));
      return { unsubscribe: () => subscription.unsubscribe() };
    }

    // Build a wrapper that throttles onMessagesChanged and onStateChanged
    // behind a shared leading+trailing gate, so rapid bursts of messages
    // and/or state changes coalesce into fewer consumer notifications.
    // All other callbacks are guarded but fire immediately.
    let active = true;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let throttleActive = false;
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

    const scheduleOrFlush = () => {
      if (!active) return;
      if (!throttleActive) {
        // Leading edge — fire immediately and start the throttle window
        throttleActive = true;
        flushPending();
        timerId = setTimeout(function trailingEdge() {
          timerId = null;
          if (
            active &&
            (latestMessagesParams !== null || latestStateParams !== null)
          ) {
            flushPending();
            timerId = setTimeout(trailingEdge, effectiveMs);
          } else {
            throttleActive = false;
          }
        }, effectiveMs);
      }
      // else: within the window, pending params are already set by the caller
    };

    // Only wrap lifecycle callbacks with guardAll — onMessagesChanged and
    // onStateChanged are handled by the throttle path which calls safeCall
    // directly on the original subscriber callbacks when flushing.
    const lifecycleOnly: SubscribeToAgentSubscriber = {};
    if (subscriber.onRunInitialized)
      lifecycleOnly.onRunInitialized = subscriber.onRunInitialized;
    if (subscriber.onRunFinalized)
      lifecycleOnly.onRunFinalized = subscriber.onRunFinalized;
    if (subscriber.onRunFailed)
      lifecycleOnly.onRunFailed = subscriber.onRunFailed;

    const wrappedSubscriber: SubscribeToAgentSubscriber =
      guardAll(lifecycleOnly);

    if (subscriber.onMessagesChanged) {
      wrappedSubscriber.onMessagesChanged = (params) => {
        latestMessagesParams = params;
        scheduleOrFlush();
      };
    }

    if (subscriber.onStateChanged) {
      wrappedSubscriber.onStateChanged = (params) => {
        latestStateParams = params;
        scheduleOrFlush();
      };
    }

    const subscription = agent.subscribe(wrappedSubscriber);

    return {
      unsubscribe: () => {
        active = false;
        if (timerId !== null) {
          clearTimeout(timerId);
          timerId = null;
        }
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

  subscribeAgentToStateManager(agent: AbstractAgent): void {
    // isClone: true — use composite agentId:threadId key, keeping the clone's
    // subscription independent of the registry agent's bare-agentId subscription.
    this.stateManager.subscribeToAgent(agent, { isClone: true });
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
