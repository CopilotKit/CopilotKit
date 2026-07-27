import type { AbstractAgent } from "@ag-ui/client";
import { HttpAgent } from "@ag-ui/client";
import type {
  RuntimeInfo,
  AgentDescription,
  RuntimeMode,
  RuntimeLicenseStatus,
  IntelligenceRuntimeInfo,
  ThreadEndpointRuntimeInfo,
} from "@copilotkit/shared";
import {
  logger,
  RUNTIME_MODE_SSE,
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
  // Tracks an in-flight `/info` connection so concurrent calls targeting the
  // same runtime (url + requested transport) collapse to a single request
  // instead of each firing their own. See #5801.
  private _connectionInFlight?: { key: string; promise: Promise<void> };
  private _runtimeVersion?: string;
  private _runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus =
    CopilotKitCoreRuntimeConnectionStatus.Disconnected;
  private _runtimeTransport: CopilotRuntimeTransport = "auto";
  // The transport MODE last requested via `setRuntimeTransport` (e.g. "auto").
  // Distinct from `_runtimeTransport`, which auto-detect overwrites with the
  // RESOLVED value ("rest"/"single"). The idempotency guard compares against
  // this so re-applying the same mode (the provider effect re-applies "auto"
  // on every render) is a no-op instead of re-running the /info handshake.
  private _requestedTransport: CopilotRuntimeTransport = "auto";
  private _audioFileTranscriptionEnabled: boolean = false;
  private _runtimeMode: RuntimeMode = RUNTIME_MODE_SSE;
  private _intelligence?: IntelligenceRuntimeInfo;
  private _threadEndpoints?: ThreadEndpointRuntimeInfo;
  private _suggestions?: boolean;
  private _a2uiEnabled: boolean = false;
  private _a2uiAgents?: string[];
  private _openGenerativeUIEnabled: boolean = false;
  private _licenseStatus?: RuntimeLicenseStatus;
  private _telemetryDisabled: boolean = false;

  /**
   * The headers each HttpAgent was constructed with, captured on the first
   * `applyHeadersToAgent` call for that agent (which, for agents the registry
   * owns, happens at registration before any core headers are applied). Core
   * headers are merged ON TOP of this baseline so that headers configured
   * directly on an agent (e.g. an `Authorization` for a self-hosted backend)
   * survive registration instead of being silently replaced. The baseline is
   * captured once and never re-captured, so a later direct mutation of
   * `agent.headers` is not folded into it. See #5635.
   */
  private agentOwnHeaders = new WeakMap<HttpAgent, Record<string, string>>();

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

  get threadEndpoints(): ThreadEndpointRuntimeInfo | undefined {
    return this._threadEndpoints;
  }

  get suggestions(): boolean | undefined {
    return this._suggestions;
  }

  get a2uiEnabled(): boolean {
    return this._a2uiEnabled;
  }

  /**
   * Agent ids the runtime applies A2UI to (#5369). `undefined` means A2UI
   * applies to every agent — or is disabled entirely; check `a2uiEnabled`.
   */
  get a2uiAgents(): string[] | undefined {
    return this._a2uiAgents;
  }

  get openGenerativeUIEnabled(): boolean {
    return this._openGenerativeUIEnabled;
  }

  get licenseStatus(): RuntimeLicenseStatus | undefined {
    return this._licenseStatus;
  }

  get telemetryDisabled(): boolean {
    return this._telemetryDisabled;
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
  setRuntimeUrl(
    runtimeUrl: string | undefined,
    options?: { deferConnection?: boolean },
  ): void {
    const normalizedRuntimeUrl = runtimeUrl
      ? runtimeUrl.replace(/\/$/, "")
      : undefined;

    if (this._runtimeUrl === normalizedRuntimeUrl) {
      return;
    }

    this._runtimeUrl = normalizedRuntimeUrl;

    // Deferred construction (see CopilotKitCore.connect / #5801): record the URL
    // so getters/hooks see it synchronously, but do NOT start the `/info` fetch
    // here. The host starts it from a commit-phase effect via `connect()`, so
    // renders discarded before commit never issue a request.
    if (options?.deferConnection) {
      return;
    }

    void this.updateRuntimeConnection();
  }

  /**
   * Start the initial runtime connection if it has not been started yet.
   *
   * Backs {@link CopilotKitCore.connect}. Idempotent: it only kicks off a fetch
   * when a `runtimeUrl` is set and the connection is still `Disconnected` (its
   * state before any connect attempt). `updateRuntimeConnection` flips the
   * status to `Connecting` synchronously, so a second call — e.g. React
   * StrictMode double-invoking the mount effect — bails here. A genuine config
   * change still reconnects through `setRuntimeUrl`/`setRuntimeTransport`. See
   * #5801.
   */
  connectRuntime(): void {
    if (typeof window === "undefined") {
      return;
    }
    if (!this._runtimeUrl) {
      return;
    }
    if (
      this._runtimeConnectionStatus !==
      CopilotKitCoreRuntimeConnectionStatus.Disconnected
    ) {
      return;
    }
    void this.updateRuntimeConnection();
  }

  setRuntimeTransport(runtimeTransport: CopilotRuntimeTransport): void {
    // Guard on the requested MODE, not the resolved value: after auto-detect
    // writes `_runtimeTransport = "rest"`, re-applying the same requested
    // "auto" must not be treated as a change (otherwise every provider
    // re-render re-runs the /info handshake and rebuilds agents).
    if (this._requestedTransport === runtimeTransport) {
      return;
    }

    this._requestedTransport = runtimeTransport;
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
   * Apply current core headers to an agent, merged ON TOP of the agent's own
   * construction-time headers (the per-agent baseline in `agentOwnHeaders`).
   * Core wins on a key conflict. Non-`HttpAgent` agents are left untouched
   * because only `HttpAgent` carries a `headers` field. See #5635.
   */
  applyHeadersToAgent(agent: AbstractAgent): void {
    if (agent instanceof HttpAgent) {
      // Capture the agent's construction-time headers once, before any core
      // headers overwrite them. On every subsequent apply we rebuild from this
      // baseline so re-applying core headers (e.g. via setHeaders) never loses
      // the agent's own headers.
      if (!this.agentOwnHeaders.has(agent)) {
        this.agentOwnHeaders.set(agent, { ...agent.headers });
      }
      agent.headers = {
        ...this.agentOwnHeaders.get(agent),
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

    // In-flight guard: if a connection to the same target (runtime url +
    // requested transport) is already running, reuse it instead of starting a
    // second `/info` request. A change to a different target supersedes it. See
    // #5801.
    const key = `${this._runtimeUrl ?? ""}::${this._requestedTransport}`;
    const inFlight = this._connectionInFlight;
    if (inFlight && inFlight.key === key) {
      return inFlight.promise;
    }

    const promise = this.performRuntimeConnection();
    this._connectionInFlight = { key, promise };
    void promise.finally(() => {
      if (this._connectionInFlight?.promise === promise) {
        this._connectionInFlight = undefined;
      }
    });
    return promise;
  }

  private async performRuntimeConnection(): Promise<void> {
    if (!this.runtimeUrl) {
      this._runtimeConnectionStatus =
        CopilotKitCoreRuntimeConnectionStatus.Disconnected;
      this._runtimeVersion = undefined;
      this._audioFileTranscriptionEnabled = false;
      this._runtimeMode = RUNTIME_MODE_SSE;
      this._intelligence = undefined;
      this._threadEndpoints = undefined;
      this._suggestions = undefined;
      this._a2uiEnabled = false;
      this._a2uiAgents = undefined;
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
        threadEndpoints?: ThreadEndpointRuntimeInfo;
        suggestions?: boolean;
      } = runtimeInfoResponse;

      const credentials = (this.core as unknown as CopilotKitCoreFriendsAccess)
        .credentials;
      const rawDebug = (this.core as unknown as CopilotKitCoreFriendsAccess)
        .debug;
      const agents: Record<string, AbstractAgent> = Object.fromEntries(
        Object.entries(runtimeInfo.agents).map(
          ([id, { description, capabilities }]) => {
            // Reuse the already-registered instance for ids that are still
            // present. A re-connection (an /info re-settle, a header/config or
            // transport change) re-runs this method, but the runtime agent for
            // a given id is the SAME logical agent — minting a fresh instance
            // would discard its accumulated `messages`/`threadId` and its live
            // subscriptions. Downstream (e.g. the `use-agent` memo) keys on the
            // instance identity returned by `getAgent(id)`, so replacing it
            // unmounts an already-rendered conversation. Only re-apply what the
            // registry owns (headers + credentials) in place; the proxy
            // re-resolves its own runtime mode/intelligence via `/info`.
            const existing = Object.prototype.hasOwnProperty.call(
              this.remoteAgents,
              id,
            )
              ? this.remoteAgents[id]
              : undefined;
            if (existing instanceof ProxiedCopilotRuntimeAgent) {
              this.applyHeadersToAgent(existing);
              this.applyCredentialsToAgent(existing);
              return [id, existing];
            }
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

      // Reassign the full set: ids present in `runtimeInfo.agents` are carried
      // over (reused or freshly minted above); ids no longer advertised are
      // dropped because they are absent from this rebuilt map.
      this.remoteAgents = agents;
      this._agents = { ...this.localAgents, ...this.remoteAgents };
      this._runtimeConnectionStatus =
        CopilotKitCoreRuntimeConnectionStatus.Connected;
      this._runtimeVersion = version;
      this._audioFileTranscriptionEnabled =
        runtimeInfoResponse.audioFileTranscriptionEnabled ?? false;
      this._runtimeMode = runtimeInfoResponse.mode ?? RUNTIME_MODE_SSE;
      this._intelligence = runtimeInfoResponse.intelligence;
      this._threadEndpoints = runtimeInfoResponse.threadEndpoints;
      this._suggestions = runtimeInfoResponse.suggestions;
      const a2uiInfo = runtimeInfoResponse.a2ui;
      this._a2uiEnabled =
        a2uiInfo?.enabled ?? runtimeInfoResponse.a2uiEnabled ?? false;
      this._a2uiAgents = a2uiInfo?.enabled ? a2uiInfo.agents : undefined;
      this._openGenerativeUIEnabled =
        runtimeInfoResponse.openGenerativeUIEnabled ?? false;
      this._licenseStatus = runtimeInfoResponse.licenseStatus;
      this._telemetryDisabled = runtimeInfoResponse.telemetryDisabled ?? false;

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
      this._threadEndpoints = undefined;
      this._suggestions = undefined;
      this._a2uiEnabled = false;
      this._a2uiAgents = undefined;
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
