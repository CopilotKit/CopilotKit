import type { AbstractAgent } from "@ag-ui/client";
import { HttpAgent } from "@ag-ui/client";
import type {
  RuntimeInfo,
  AgentDescription,
  RuntimeMode,
  RuntimeLicenseStatus,
  IntelligenceRuntimeInfo,
} from "@copilotkit/shared";
import {
  logger,
  RUNTIME_MODE_SSE,
  RUNTIME_MODE_INTELLIGENCE,
  resolveDebugConfig,
} from "@copilotkit/shared";
import { ProxiedCopilotRuntimeAgent } from "../agent";
import type { CopilotKitCore, CopilotKitCoreFriendsAccess } from "./core";
import {
  CopilotKitCoreErrorCode,
  CopilotKitCoreRuntimeConnectionStatus,
} from "./core";
import type { CopilotRuntimeTransport } from "../types";

export interface CopilotKitCoreAddAgentParams {
  id: string;
  agent: AbstractAgent;
}

/**
 * Parameters for registering a proxied agent against an existing runtime agent.
 */
export interface CopilotKitCoreRegisterProxiedAgentParams {
  /**
   * The local registry id under which the proxy is registered. Used by
   * `useAgent`, state-manager subscriptions, and all subscriber bookkeeping.
   * Must not collide with any existing local or runtime-discovered agent id.
   */
  agentId: string;
  /**
   * The id of the runtime agent that this proxy routes outbound HTTP requests
   * to. Invisible to subscribers — only affects URL paths and single-route
   * envelopes.
   */
  runtimeAgentId: string;
}

export interface CopilotKitCoreRegisterProxiedAgentResult {
  agent: ProxiedCopilotRuntimeAgent;
  unregister: () => void;
}

/**
 * Manages agent registration, lifecycle, and runtime connectivity for CopilotKitCore.
 * Handles both local development agents and remote runtime agents.
 */
export class AgentRegistry {
  private _agents: Record<string, AbstractAgent> = {};
  private localAgents: Record<string, AbstractAgent> = {};
  private remoteAgents: Record<string, AbstractAgent> = {};

  private _runtimeUrl?: string;
  private _runtimeVersion?: string;
  private _runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus =
    CopilotKitCoreRuntimeConnectionStatus.Disconnected;
  private _runtimeTransport: CopilotRuntimeTransport = "auto";
  private _audioFileTranscriptionEnabled: boolean = false;
  private _runtimeMode: RuntimeMode = RUNTIME_MODE_SSE;
  private _intelligence?: IntelligenceRuntimeInfo;
  private _a2uiEnabled: boolean = false;
  private _openGenerativeUIEnabled: boolean = false;
  private _licenseStatus?: RuntimeLicenseStatus;

  constructor(private core: CopilotKitCore) {}

  /**
   * Get all agents as a readonly record
   */
  get agents(): Readonly<Record<string, AbstractAgent>> {
    return this._agents;
  }

  get runtimeUrl(): string | undefined {
    return this._runtimeUrl;
  }

  get runtimeVersion(): string | undefined {
    return this._runtimeVersion;
  }

  get runtimeConnectionStatus(): CopilotKitCoreRuntimeConnectionStatus {
    return this._runtimeConnectionStatus;
  }

  get runtimeTransport(): CopilotRuntimeTransport {
    return this._runtimeTransport;
  }

  get audioFileTranscriptionEnabled(): boolean {
    return this._audioFileTranscriptionEnabled;
  }

  get runtimeMode(): RuntimeMode {
    return this._runtimeMode;
  }

  get intelligence(): IntelligenceRuntimeInfo | undefined {
    return this._intelligence;
  }

  get a2uiEnabled(): boolean {
    return this._a2uiEnabled;
  }

  get openGenerativeUIEnabled(): boolean {
    return this._openGenerativeUIEnabled;
  }

  get licenseStatus(): RuntimeLicenseStatus | undefined {
    return this._licenseStatus;
  }

  /**
   * Initialize agents from configuration
   */
  initialize(agents: Record<string, AbstractAgent>): void {
    this.localAgents = this.assignAgentIds(agents);
    this.applyHeadersToAgents(this.localAgents);
    this.applyCredentialsToAgents(this.localAgents);
    this._agents = this.localAgents;
  }

  /**
   * Set the runtime URL and update connection
   */
  setRuntimeUrl(runtimeUrl: string | undefined): void {
    const normalizedRuntimeUrl = runtimeUrl
      ? runtimeUrl.replace(/\/$/, "")
      : undefined;

    if (this._runtimeUrl === normalizedRuntimeUrl) {
      return;
    }

    this._runtimeUrl = normalizedRuntimeUrl;
    void this.updateRuntimeConnection();
  }

  setRuntimeTransport(runtimeTransport: CopilotRuntimeTransport): void {
    if (this._runtimeTransport === runtimeTransport) {
      return;
    }

    this._runtimeTransport = runtimeTransport;
    void this.updateRuntimeConnection();
  }

  /**
   * Set all agents at once (for development use)
   */
  setAgents__unsafe_dev_only(agents: Record<string, AbstractAgent>): void {
    // Validate all agents before making any changes
    Object.entries(agents).forEach(([id, agent]) => {
      if (agent) {
        this.validateAndAssignAgentId(id, agent);
      }
    });
    this.localAgents = agents;
    this._agents = { ...this.localAgents, ...this.remoteAgents };
    this.applyHeadersToAgents(this._agents);
    this.applyCredentialsToAgents(this._agents);
    void this.notifyAgentsChanged();
  }

  /**
   * Add a single agent (for development use)
   */
  addAgent__unsafe_dev_only({ id, agent }: CopilotKitCoreAddAgentParams): void {
    this.validateAndAssignAgentId(id, agent);
    this.localAgents[id] = agent;
    this.applyHeadersToAgent(agent);
    this.applyCredentialsToAgent(agent);
    this._agents = { ...this.localAgents, ...this.remoteAgents };
    void this.notifyAgentsChanged();
  }

  /**
   * Remove an agent by ID (for development use)
   */
  removeAgent__unsafe_dev_only(id: string): void {
    delete this.localAgents[id];
    this._agents = { ...this.localAgents, ...this.remoteAgents };
    void this.notifyAgentsChanged();
  }

  /**
   * Register a proxied agent that routes outbound runtime requests to an
   * existing runtime agent (`runtimeAgentId`) while exposing a distinct local
   * registry id (`agentId`). Throws if `agentId` is already taken by either a
   * local or runtime-discovered agent.
   *
   * Use this to mount multiple frontend agents against a single runtime
   * agent (e.g. a chat-1 / chat-2 pair both proxying to "default") without
   * implicit per-thread cloning. The returned `unregister` removes the proxy
   * from the registry and emits `onAgentsChanged`.
   */
  registerProxiedAgent({
    agentId,
    runtimeAgentId,
  }: CopilotKitCoreRegisterProxiedAgentParams): CopilotKitCoreRegisterProxiedAgentResult {
    // Use hasOwnProperty rather than `in`: `in` walks the prototype chain,
    // so an agentId of "__proto__", "constructor", "toString" etc. would
    // falsely test as already-registered.
    if (Object.prototype.hasOwnProperty.call(this._agents, agentId)) {
      throw new Error(
        `CopilotKitCore.registerProxiedAgent: agentId "${agentId}" is already registered. ` +
          `Pick a different agentId, or unregister the existing agent first.`,
      );
    }

    const friends = this.core as unknown as CopilotKitCoreFriendsAccess;
    const debug = friends.debug;
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: this._runtimeUrl,
      agentId,
      runtimeAgentId,
      transport: this._runtimeTransport,
      credentials: friends.credentials,
      // If runtime info has already synced, mirror its mode/intelligence so
      // the proxy doesn't have to re-resolve. Otherwise stay "pending" until
      // /info lands.
      runtimeMode: this._runtimeUrl
        ? this._runtimeConnectionStatus ===
          CopilotKitCoreRuntimeConnectionStatus.Connected
          ? this._runtimeMode
          : "pending"
        : RUNTIME_MODE_SSE,
      intelligence: this._intelligence,
      debug: debug ? resolveDebugConfig(debug) : undefined,
    });
    this.applyHeadersToAgent(agent);

    this.localAgents[agentId] = agent;
    this._agents = { ...this.localAgents, ...this.remoteAgents };
    void this.notifyAgentsChanged();

    return {
      agent,
      unregister: () => {
        // Only unregister if the same instance is still in place — guards
        // against double-unregister or against unregistering after a
        // subsequent register replaced the slot.
        if (this.localAgents[agentId] === agent) {
          delete this.localAgents[agentId];
          this._agents = { ...this.localAgents, ...this.remoteAgents };
          void this.notifyAgentsChanged();
        }
      },
    };
  }

  /**
   * Get an agent by ID
   */
  getAgent(id: string): AbstractAgent | undefined {
    if (id in this._agents) {
      return this._agents[id] as AbstractAgent;
    }

    // Silently return undefined if we're still loading runtime agents
    if (
      this.runtimeUrl !== undefined &&
      (this.runtimeConnectionStatus ===
        CopilotKitCoreRuntimeConnectionStatus.Disconnected ||
        this.runtimeConnectionStatus ===
          CopilotKitCoreRuntimeConnectionStatus.Connecting)
    ) {
      return undefined;
    }

    console.warn(`Agent ${id} not found`);
    return undefined;
  }

  /**
   * Apply current headers to an agent
   */
  applyHeadersToAgent(agent: AbstractAgent): void {
    if (agent instanceof HttpAgent) {
      agent.headers = {
        ...(this.core as unknown as CopilotKitCoreFriendsAccess).headers,
      };
    }
  }

  /**
   * Apply current headers to all agents
   */
  applyHeadersToAgents(agents: Record<string, AbstractAgent>): void {
    Object.values(agents).forEach((agent) => {
      this.applyHeadersToAgent(agent);
    });
  }

  /**
   * Apply current credentials to an agent
   */
  applyCredentialsToAgent(agent: AbstractAgent): void {
    if (agent instanceof ProxiedCopilotRuntimeAgent) {
      agent.credentials = (
        this.core as unknown as CopilotKitCoreFriendsAccess
      ).credentials;
    }
  }

  /**
   * Apply current credentials to all agents
   */
  applyCredentialsToAgents(agents: Record<string, AbstractAgent>): void {
    Object.values(agents).forEach((agent) => {
      this.applyCredentialsToAgent(agent);
    });
  }

  /**
   * Update runtime connection and fetch remote agents
   */
  private async updateRuntimeConnection(): Promise<void> {
    // Skip fetching on the server (SSR)
    if (typeof window === "undefined") {
      return;
    }

    if (!this.runtimeUrl) {
      this._runtimeConnectionStatus =
        CopilotKitCoreRuntimeConnectionStatus.Disconnected;
      this._runtimeVersion = undefined;
      this._audioFileTranscriptionEnabled = false;
      this._runtimeMode = RUNTIME_MODE_SSE;
      this._intelligence = undefined;
      this._a2uiEnabled = false;
      this._openGenerativeUIEnabled = false;
      this.remoteAgents = {};
      this._agents = this.localAgents;

      await this.notifyRuntimeStatusChanged(
        CopilotKitCoreRuntimeConnectionStatus.Disconnected,
      );
      await this.notifyAgentsChanged();
      return;
    }

    this._runtimeConnectionStatus =
      CopilotKitCoreRuntimeConnectionStatus.Connecting;
    await this.notifyRuntimeStatusChanged(
      CopilotKitCoreRuntimeConnectionStatus.Connecting,
    );

    try {
      const runtimeInfoResponse = await this.fetchRuntimeInfo();
      const {
        version,
        ...runtimeInfo
      }: {
        agents: Record<string, AgentDescription>;
        version: string;
        mode?: RuntimeMode;
        intelligence?: IntelligenceRuntimeInfo;
      } = runtimeInfoResponse;

      const credentials = (this.core as unknown as CopilotKitCoreFriendsAccess)
        .credentials;
      const rawDebug = (this.core as unknown as CopilotKitCoreFriendsAccess)
        .debug;
      const agents: Record<string, AbstractAgent> = Object.fromEntries(
        Object.entries(runtimeInfo.agents).map(
          ([id, { description, capabilities }]) => {
            const agent = new ProxiedCopilotRuntimeAgent({
              runtimeUrl: this.runtimeUrl,
              agentId: id, // Runtime agents always have their ID set correctly
              description: description,
              transport: this._runtimeTransport,
              credentials,
              runtimeMode: runtimeInfoResponse.mode ?? RUNTIME_MODE_SSE,
              intelligence: runtimeInfoResponse.intelligence,
              capabilities,
              debug: rawDebug ? resolveDebugConfig(rawDebug) : undefined,
            });
            this.applyHeadersToAgent(agent);
            return [id, agent];
          },
        ),
      );

      this.remoteAgents = agents;
      this._agents = { ...this.localAgents, ...this.remoteAgents };
      this._runtimeConnectionStatus =
        CopilotKitCoreRuntimeConnectionStatus.Connected;
      this._runtimeVersion = version;
      this._audioFileTranscriptionEnabled =
        runtimeInfoResponse.audioFileTranscriptionEnabled ?? false;
      this._runtimeMode = runtimeInfoResponse.mode ?? RUNTIME_MODE_SSE;
      this._intelligence = runtimeInfoResponse.intelligence;
      this._a2uiEnabled = runtimeInfoResponse.a2uiEnabled ?? false;
      this._openGenerativeUIEnabled =
        runtimeInfoResponse.openGenerativeUIEnabled ?? false;
      this._licenseStatus = runtimeInfoResponse.licenseStatus;

      await this.notifyRuntimeStatusChanged(
        CopilotKitCoreRuntimeConnectionStatus.Connected,
      );
      await this.notifyAgentsChanged();
    } catch (error) {
      this._runtimeConnectionStatus =
        CopilotKitCoreRuntimeConnectionStatus.Error;
      this._runtimeVersion = undefined;
      this._audioFileTranscriptionEnabled = false;
      this._runtimeMode = RUNTIME_MODE_SSE;
      this._intelligence = undefined;
      this._a2uiEnabled = false;
      this._openGenerativeUIEnabled = false;
      this.remoteAgents = {};
      this._agents = this.localAgents;

      await this.notifyRuntimeStatusChanged(
        CopilotKitCoreRuntimeConnectionStatus.Error,
      );
      await this.notifyAgentsChanged();

      const message =
        error instanceof Error ? error.message : JSON.stringify(error);
      logger.warn(
        `Failed to load runtime info (${this.runtimeUrl}/info): ${message}`,
      );
      const runtimeError =
        error instanceof Error ? error : new Error(String(error));
      await (this.core as unknown as CopilotKitCoreFriendsAccess).emitError({
        error: runtimeError,
        code: CopilotKitCoreErrorCode.RUNTIME_INFO_FETCH_FAILED,
        context: {
          runtimeUrl: this.runtimeUrl,
        },
      });
    }
  }

  private async fetchRuntimeInfo(): Promise<RuntimeInfo> {
    if (!this.runtimeUrl) {
      throw new Error("Runtime URL is not set");
    }

    const baseHeaders = (this.core as unknown as CopilotKitCoreFriendsAccess)
      .headers;
    const credentials = (this.core as unknown as CopilotKitCoreFriendsAccess)
      .credentials;
    const headers: Record<string, string> = {
      ...baseHeaders,
    };

    if (this._runtimeTransport === "single") {
      return this.fetchRuntimeInfoSingle(headers, credentials);
    }

    if (this._runtimeTransport === "auto") {
      return this.fetchRuntimeInfoAutoDetect(headers, credentials);
    }

    // REST transport
    const response = await fetch(`${this.runtimeUrl}/info`, {
      headers,
      ...(credentials ? { credentials } : {}),
    });
    if (!response.ok) {
      throw new Error(
        `Runtime info request failed with status ${response.status}`,
      );
    }
    return (await response.json()) as RuntimeInfo;
  }

  private async fetchRuntimeInfoSingle(
    headers: Record<string, string>,
    credentials: RequestCredentials | undefined,
  ): Promise<RuntimeInfo> {
    if (!headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    const response = await fetch(this.runtimeUrl!, {
      method: "POST",
      headers,
      body: JSON.stringify({ method: "info" }),
      ...(credentials ? { credentials } : {}),
    });
    if (!response.ok) {
      throw new Error(
        `Runtime info request failed with status ${response.status}`,
      );
    }
    return (await response.json()) as RuntimeInfo;
  }

  /**
   * Auto-detect transport by trying REST first, then falling back to single-endpoint.
   * Updates `_runtimeTransport` to the detected value so subsequent requests use it directly.
   */
  private async fetchRuntimeInfoAutoDetect(
    headers: Record<string, string>,
    credentials: RequestCredentials | undefined,
  ): Promise<RuntimeInfo> {
    // Try REST first (GET /info)
    try {
      const response = await fetch(`${this.runtimeUrl}/info`, {
        headers: { ...headers },
        ...(credentials ? { credentials } : {}),
      });
      // Only treat a successful (2xx) response as a valid REST runtime.
      // 404/405 means the endpoint doesn't exist; other non-2xx errors
      // (500, 403, etc.) should also fall through to single-endpoint.
      if (response.status >= 200 && response.status < 300) {
        this._runtimeTransport = "rest";
        return (await response.json()) as RuntimeInfo;
      }
      // Non-2xx — try single-endpoint below
    } catch {
      // REST failed (network error, etc.) — fall through to single-endpoint attempt
    }

    const result = await this.fetchRuntimeInfoSingle(
      { ...headers },
      credentials,
    );
    this._runtimeTransport = "single";
    return result;
  }

  /**
   * Assign agent IDs to a record of agents
   */
  private assignAgentIds(
    agents: Record<string, AbstractAgent>,
  ): Record<string, AbstractAgent> {
    Object.entries(agents).forEach(([id, agent]) => {
      if (agent) {
        this.validateAndAssignAgentId(id, agent);
      }
    });
    return agents;
  }

  /**
   * Validate and assign an agent ID
   */
  private validateAndAssignAgentId(
    registrationId: string,
    agent: AbstractAgent,
  ): void {
    if (agent.agentId && agent.agentId !== registrationId) {
      throw new Error(
        `Agent registration mismatch: Agent with ID "${agent.agentId}" cannot be registered under key "${registrationId}". ` +
          `The agent ID must match the registration key or be undefined.`,
      );
    }
    if (!agent.agentId) {
      agent.agentId = registrationId;
    }
  }

  /**
   * Notify subscribers of runtime status changes
   */
  private async notifyRuntimeStatusChanged(
    status: CopilotKitCoreRuntimeConnectionStatus,
  ): Promise<void> {
    await (
      this.core as unknown as CopilotKitCoreFriendsAccess
    ).notifySubscribers(
      (subscriber) =>
        subscriber.onRuntimeConnectionStatusChanged?.({
          copilotkit: this.core,
          status,
        }),
      "Error in CopilotKitCore subscriber (onRuntimeConnectionStatusChanged):",
    );
  }

  /**
   * Notify subscribers of agent changes
   */
  private async notifyAgentsChanged(): Promise<void> {
    await (
      this.core as unknown as CopilotKitCoreFriendsAccess
    ).notifySubscribers(
      (subscriber) =>
        subscriber.onAgentsChanged?.({
          copilotkit: this.core,
          agents: this._agents,
        }),
      "Subscriber onAgentsChanged error:",
    );
  }
}
