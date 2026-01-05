import { AbstractAgent, Context, State } from "@ag-ui/client";
import { FrontendTool, SuggestionsConfig, Suggestion, CopilotRuntimeTransport } from "../types";
import { AgentRegistry, CopilotKitCoreAddAgentParams } from "./agent-registry";
import { ContextStore } from "./context-store";
import { SuggestionEngine } from "./suggestion-engine";
import {
  RunHandler,
  CopilotKitCoreRunAgentParams,
  CopilotKitCoreConnectAgentParams,
  CopilotKitCoreGetToolParams,
} from "./run-handler";
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
  /** Properties sent as `forwardedProps` to the AG-UI agent. */
  properties?: Record<string, unknown>;
  /** Ordered collection of frontend tools available to the core. */
  tools?: FrontendTool<any>[];
  /** Suggestions config for the core. */
  suggestionsConfig?: SuggestionsConfig[];
}

export type { CopilotKitCoreAddAgentParams };
export type { CopilotKitCoreRunAgentParams, CopilotKitCoreConnectAgentParams, CopilotKitCoreGetToolParams };

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
  onSuggestionsStartedLoading?: (event: { copilotkit: CopilotKitCore; agentId: string }) => void | Promise<void>;
  onSuggestionsFinishedLoading?: (event: { copilotkit: CopilotKitCore; agentId: string }) => void | Promise<void>;
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
}

// Subscription object returned by subscribe()
export interface CopilotKitCoreSubscription {
  unsubscribe: () => void;
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

  emitError(params: { error: Error; code: CopilotKitCoreErrorCode; context?: Record<string, any> }): Promise<void>;

  // Getters for internal state
  readonly headers: Readonly<Record<string, string>>;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly context: Readonly<Record<string, Context>>;

  // Internal methods
  buildFrontendTools(agentId?: string): import("@ag-ui/client").Tool[];
  getAgent(id: string): AbstractAgent | undefined;

  // References to delegate subsystems
  readonly suggestionEngine: {
    clearSuggestions(agentId: string): void;
    reloadSuggestions(agentId: string): void;
  };
}

export class CopilotKitCore {
  private _headers: Record<string, string>;
  private _properties: Record<string, unknown>;

  private subscribers: Set<CopilotKitCoreSubscriber> = new Set();

  // Delegate classes
  private agentRegistry: AgentRegistry;
  private contextStore: ContextStore;
  private suggestionEngine: SuggestionEngine;
  private runHandler: RunHandler;
  private stateManager: StateManager;

  constructor({
    runtimeUrl,
    runtimeTransport = "rest",
    headers = {},
    properties = {},
    agents__unsafe_dev_only = {},
    tools = [],
    suggestionsConfig = [],
  }: CopilotKitCoreConfig) {
    this._headers = headers;
    this._properties = properties;

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

  get properties(): Readonly<Record<string, unknown>> {
    return this._properties;
  }

  get runtimeConnectionStatus(): CopilotKitCoreRuntimeConnectionStatus {
    return this.agentRegistry.runtimeConnectionStatus;
  }

  /**
   * Configuration updates
   */
  setHeaders(headers: Record<string, string>): void {
    this._headers = headers;
    this.agentRegistry.applyHeadersToAgents(this.agentRegistry.agents as Record<string, AbstractAgent>);
    void this.notifySubscribers(
      (subscriber) =>
        subscriber.onHeadersChanged?.({
          copilotkit: this,
          headers: this.headers,
        }),
      "Subscriber onHeadersChanged error:",
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
  addTool<T extends Record<string, unknown> = Record<string, unknown>>(tool: FrontendTool<T>): void {
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
   * Agent connectivity (delegated to RunHandler)
   */
  async connectAgent(params: CopilotKitCoreConnectAgentParams): Promise<import("@ag-ui/client").RunAgentResult> {
    return this.runHandler.connectAgent(params);
  }

  stopAgent(params: CopilotKitCoreStopAgentParams): void {
    params.agent.abortRun();
  }

  async runAgent(params: CopilotKitCoreRunAgentParams): Promise<import("@ag-ui/client").RunAgentResult> {
    return this.runHandler.runAgent(params);
  }

  /**
   * State management (delegated to StateManager)
   */
  getStateByRun(agentId: string, threadId: string, runId: string): State | undefined {
    return this.stateManager.getStateByRun(agentId, threadId, runId);
  }

  getRunIdForMessage(agentId: string, threadId: string, messageId: string): string | undefined {
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
}
