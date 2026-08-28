import type { AbstractAgent } from "@ag-ui/client";
import { HttpAgent } from "@ag-ui/client";
import type {
  RuntimeInfo,
  RuntimeMode,
  RuntimeLicenseStatus,
  IntelligenceRuntimeInfo,
  InspectorMetadataV1,
  ThreadEndpointRuntimeInfo,
} from "@copilotkit/shared";
import {
  logger,
  parseInspectorMetadataV1,
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
import {
  isRuntimeInfoRequestError,
  runtimeInfoError,
} from "../utils/runtime-info-error";
import { isAbortError } from "../utils/abort-error";
import type { RuntimeRequestMeta } from "../utils/runtime-request";
import {
  RUNTIME_REQUEST_WATCHDOG_MS,
  runtimeRequestMeta,
} from "../utils/runtime-request";

type ResolvedCopilotRuntimeTransport = Exclude<CopilotRuntimeTransport, "auto">;

type RuntimeInfoFetchResult = {
  runtimeInfo: RuntimeInfo;
  resolvedTransport: ResolvedCopilotRuntimeTransport;
};

/** Maximum wait for optional Inspector metadata before degrading to absence. */
const INSPECTOR_METADATA_REQUEST_TIMEOUT_MS = 5_000;

/**
 * Per-request bound for `/info` probes and recovery re-syncs. Exported for
 * tests. `ɵ`-prefixed because this module is re-exported from the package index.
 */
export const ɵRUNTIME_PROBE_TIMEOUT_MS = 5_000;

/**
 * What the instrumented fetch observed about one runtime-bound request.
 *
 * Only `ok` and `failed` carry information about the runtime. `aborted` is a
 * cancellation (Stop pressed, component unmounted) and `ignored` is a failure
 * the caller declared harmless — see {@link RuntimeRequestMeta}.
 */
type RuntimeRequestOutcome = "ok" | "failed" | "aborted" | "ignored";

/**
 * Classify a rejected runtime request. Stop/unmount is `aborted`. A caller
 * timeout is `failed` because it is marked `timedOut`.
 */
function classifyRuntimeRequestFailure(
  error: unknown,
  meta: RuntimeRequestMeta | undefined,
): RuntimeRequestOutcome {
  if (meta?.nonCritical) {
    return "ignored";
  }
  if (isAbortError(error) && !meta?.timedOut) {
    return "aborted";
  }
  return "failed";
}

/** How one runtime connection attempt should behave. */
interface RuntimeConnectionOptions {
  /** Keep remote agents and capabilities if this attempt fails. */
  preserveOnFailure?: boolean;
  /**
   * Recovery re-sync: reconcile the agent set, and do not paint Error over a
   * success that landed after this attempt started.
   */
  recovery?: boolean;
}

/** Build case-insensitive JSON headers without mutating the Core snapshot. */
function withJsonContentType(headers: Record<string, string>): Headers {
  const requestHeaders = new Headers(headers);
  if (!requestHeaders.has("content-type")) {
    requestHeaders.set("content-type", "application/json");
  }
  return requestHeaders;
}

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

  /**
   * Thread id each remote agent was minted with. `AbstractAgent` always assigns
   * one, so presence is not a signal — a different value means a binding
   * resolved a thread onto the agent.
   */
  private readonly mintedThreadIds = new WeakMap<AbstractAgent, string>();

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
  private _inspectorMetadata?: InspectorMetadataV1;
  private _inspectorMetadataSupported: boolean = false;
  private inspectorMetadataRefreshReady: boolean = false;
  private inspectorMetadataConnectionGeneration: number = 0;
  private inspectorMetadataGeneration: number = 0;
  private inspectorMetadataHeadersGeneration: number = 0;
  private inspectorMetadataCredentialsGeneration: number = 0;
  private inspectorMetadataAbortController?: AbortController;
  private inspectorMetadataNotificationQueue: Promise<void> = Promise.resolve();
  private _a2uiEnabled: boolean = false;
  private _a2uiAgents?: string[];
  private _openGenerativeUIEnabled: boolean = false;
  private _licenseStatus?: RuntimeLicenseStatus;
  private _telemetryDisabled: boolean = false;

  // --- Runtime connection health (OSS-904) -------------------------------
  /** Memoized instrumented fetch, so re-applying it to an agent is a no-op. */
  private runtimeFetch?: typeof fetch;
  /** A reachability probe is running; further failures must not start another. */
  private runtimeProbeInFlight: boolean = false;
  /**
   * Identifies the probe that owns {@link runtimeProbeInFlight}. An abandoned
   * probe (a runtime url or transport change happened while it was in flight)
   * must not clear a latch that now belongs to a newer one.
   */
  private runtimeProbeToken: number = 0;
  /** Aborts the in-flight probe's `/info` request when it is abandoned. */
  private runtimeProbeAbortController?: AbortController;
  /**
   * A recovery re-sync is running. Guards against the window in which the
   * re-sync has already set the status back to `Error` but is still notifying
   * subscribers and emitting its error: a success landing there would collapse
   * onto that already-dying attempt and be lost.
   */
  private runtimeRecoveryRunning: boolean = false;
  /**
   * A successful runtime request arrived while a recovery re-sync was running,
   * so the running one cannot be the last word. Consumed by the loop in
   * {@link recoverRuntimeConnection}; each success sets it at most once, so
   * this is driven purely by observed traffic and is not a retry loop.
   */
  private runtimeRecoveryPending: boolean = false;
  /**
   * Ordering guard for reachability probes. Bumped on every runtime connection
   * status transition AND on every observed successful runtime request — both
   * make an older, still-in-flight probe's verdict stale. A probe captures the
   * value before it starts and only applies an "unreachable" verdict when the
   * value is unchanged, so a late verdict can never override a success that
   * happened after it started. Mirrors
   * `inspectorMetadataConnectionGeneration`.
   */
  private runtimeHealthGeneration: number = 0;

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

  get inspectorMetadata(): InspectorMetadataV1 | undefined {
    return this._inspectorMetadata;
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
    this.applyRuntimeFetchToAgents(this.localAgents);
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

    this.invalidateInspectorMetadataConnection();
    this.abandonRuntimeHealthProbe();
    this._runtimeUrl = normalizedRuntimeUrl;

    // Deferred construction (see CopilotKitCore.connect / #5801): record the URL
    // so getters/hooks see it synchronously, but do NOT start the `/info` fetch
    // here. The host starts it from a commit-phase effect via `connect()`, so
    // renders discarded before commit never issue a request.
    if (options?.deferConnection) {
      return;
    }

    void this.updateRuntimeConnection({
      preserveOnFailure: this.hasLiveRuntimeKnowledgeToProtect(),
    });
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

    this.invalidateInspectorMetadataConnection();
    this.abandonRuntimeHealthProbe();
    this._requestedTransport = runtimeTransport;
    this._runtimeTransport = runtimeTransport;
    void this.updateRuntimeConnection({
      preserveOnFailure: this.hasLiveRuntimeKnowledgeToProtect(),
    });
  }

  /**
   * True when a failed reconnect would destroy a live conversation.
   * Guard on remote agents and `!== Connected`, not `=== Error`: recovery
   * passes through Connecting, and pinning to Error would wipe agents there.
   */
  private hasLiveRuntimeKnowledgeToProtect(): boolean {
    if (Object.keys(this.remoteAgents).length === 0) {
      return false;
    }
    return (
      this._runtimeConnectionStatus !==
      CopilotKitCoreRuntimeConnectionStatus.Connected
    );
  }

  /**
   * Merge a recovery `/info` report with the live set. Drop an unreported
   * agent only when the report is non-empty and that agent has no conversation
   * state. An empty list is a runtime that has not finished registering.
   */
  private reconcileRecoveredAgents(
    reported: Record<string, AbstractAgent>,
  ): Record<string, AbstractAgent> {
    const merged = { ...this.remoteAgents, ...reported };
    if (Object.keys(reported).length === 0) {
      return merged;
    }
    for (const [id, agent] of Object.entries(merged)) {
      if (Object.prototype.hasOwnProperty.call(reported, id)) {
        continue;
      }
      if (this.carriesConversationState(agent)) {
        continue;
      }
      delete merged[id];
    }
    return merged;
  }

  /**
   * True when this agent backs something on screen: messages, or a threadId
   * that moved off the minted value. Unknown agents are kept.
   */
  private carriesConversationState(agent: AbstractAgent): boolean {
    if (agent.messages.length > 0) {
      return true;
    }
    const mintedThreadId = this.mintedThreadIds.get(agent);
    return mintedThreadId === undefined || agent.threadId !== mintedThreadId;
  }

  /**
   * Give up on the in-flight reachability probe: it belongs to a runtime this
   * application is no longer talking to.
   *
   * Bumping the token means the abandoned probe's `finally` will not clear a
   * latch that by then belongs to a newer probe, and bumping the health
   * generation means its verdict can no longer be applied.
   */
  private abandonRuntimeHealthProbe(): void {
    this.runtimeProbeToken += 1;
    this.runtimeProbeInFlight = false;
    this.runtimeHealthGeneration += 1;
    this.runtimeProbeAbortController?.abort();
    this.runtimeProbeAbortController = undefined;
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
    this.applyRuntimeFetchToAgents(this._agents);
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
    this.applyRuntimeFetchToAgent(agent);
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
    this.applyRuntimeFetchToAgent(agent);

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
   * Pass-through fetch that reports each runtime-bound request into the
   * connection status. Memoized so re-applying it is a no-op.
   */
  createRuntimeFetch(): typeof fetch {
    if (!this.runtimeFetch) {
      this.runtimeFetch = (async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> => {
        // Read on settle, not here: a caller may still be filling this in (a
        // timeout it has not hit yet). See `RuntimeRequestMeta`.
        const meta = () => runtimeRequestMeta(init);
        const watchdog = this.armRuntimeRequestWatchdog(meta());
        try {
          const response = await fetch(input, init);
          watchdog.clear();
          this.handleRuntimeRequestOutcome(
            response.ok ? "ok" : meta()?.nonCritical ? "ignored" : "failed",
            watchdog.checked,
          );
          return response;
        } catch (error) {
          watchdog.clear();
          this.handleRuntimeRequestOutcome(
            classifyRuntimeRequestFailure(error, meta()),
            watchdog.checked,
          );
          throw error;
        }
      }) as typeof fetch;
    }
    return this.runtimeFetch;
  }

  /**
   * Report silence after {@link RUNTIME_REQUEST_WATCHDOG_MS} without aborting
   * the request. Skip non-critical and self-bounded requests. `checked` is
   * true only when that report actually started a probe.
   */
  private armRuntimeRequestWatchdog(meta: RuntimeRequestMeta | undefined): {
    clear: () => void;
    checked: () => boolean;
  } {
    if (
      typeof window === "undefined" ||
      meta?.nonCritical ||
      meta?.selfBounded
    ) {
      return { clear: () => {}, checked: () => false };
    }
    let checked = false;
    const timeoutId = setTimeout(() => {
      checked = this.handleRuntimeRequestOutcome("failed");
    }, RUNTIME_REQUEST_WATCHDOG_MS);
    return {
      clear: () => clearTimeout(timeoutId),
      checked: () => checked,
    };
  }

  /**
   * Route a registry-minted proxied agent's HTTP through the instrumented
   * fetch. Customer-owned agents are left on global fetch.
   */
  applyRuntimeFetchToAgent(agent: AbstractAgent): void {
    if (agent instanceof ProxiedCopilotRuntimeAgent) {
      agent.fetch = this.createRuntimeFetch();
    }
  }

  /** Apply the instrumented fetch to all agents. */
  applyRuntimeFetchToAgents(agents: Record<string, AbstractAgent>): void {
    Object.values(agents).forEach((agent) => {
      this.applyRuntimeFetchToAgent(agent);
    });
  }

  /** Refresh metadata after the Core header snapshot changes. */
  handleHeadersChanged(): void {
    this.inspectorMetadataHeadersGeneration += 1;
    this.setInspectorMetadata(undefined);
    void this.refreshInspectorMetadata();
  }

  /** Refresh metadata after the Core credentials mode changes. */
  handleCredentialsChanged(): void {
    this.inspectorMetadataCredentialsGeneration += 1;
    this.setInspectorMetadata(undefined);
    void this.refreshInspectorMetadata();
  }

  /**
   * Fetch trusted inspector metadata independently from runtime discovery.
   * Optional-route failures degrade to absent metadata and never affect the
   * runtime connection state.
   */
  async refreshInspectorMetadata(): Promise<void> {
    const generation = ++this.inspectorMetadataGeneration;
    this.inspectorMetadataAbortController?.abort();
    this.inspectorMetadataAbortController = undefined;

    if (
      !this._inspectorMetadataSupported ||
      !this.inspectorMetadataRefreshReady ||
      !this.runtimeUrl ||
      this._runtimeConnectionStatus !==
        CopilotKitCoreRuntimeConnectionStatus.Connected
    ) {
      this.setInspectorMetadata(undefined);
      return;
    }

    const runtimeUrl = this.runtimeUrl;
    const requestedTransport = this._requestedTransport;
    const resolvedTransport = this._runtimeTransport;
    const headersGeneration = this.inspectorMetadataHeadersGeneration;
    const credentialsGeneration = this.inspectorMetadataCredentialsGeneration;
    const friends = this.core as unknown as CopilotKitCoreFriendsAccess;
    const headers = { ...friends.headers };
    const credentials = friends.credentials;
    const abortController = new AbortController();
    this.inspectorMetadataAbortController = abortController;

    let timedOut = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let rejectForAbort: ((reason: Error) => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectForAbort = reject;
    });
    const handleAbort = () => {
      rejectForAbort?.(new Error("Inspector metadata request aborted"));
    };
    abortController.signal.addEventListener("abort", handleAbort, {
      once: true,
    });
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        reject(new Error("Inspector metadata request timed out"));
        abortController.abort();
      }, INSPECTOR_METADATA_REQUEST_TIMEOUT_MS);
    });

    let nextMetadata: InspectorMetadataV1 | undefined;
    try {
      const request = (async () => {
        const response =
          resolvedTransport === "single"
            ? await this.fetchInspectorMetadataSingle({
                runtimeUrl,
                headers,
                credentials,
                signal: abortController.signal,
              })
            : await this.fetchInspectorMetadataRest({
                runtimeUrl,
                headers,
                credentials,
                signal: abortController.signal,
              });

        if (response.status === 204 || !response.ok) {
          return undefined;
        }
        return parseInspectorMetadataV1(await response.json());
      })();
      nextMetadata = await Promise.race([request, aborted, timeout]);
    } catch {
      nextMetadata = undefined;
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
      abortController.signal.removeEventListener("abort", handleAbort);
    }

    if (
      !this.isInspectorMetadataRequestCurrent({
        generation,
        runtimeUrl,
        requestedTransport,
        resolvedTransport,
        headersGeneration,
        credentialsGeneration,
        signal: abortController.signal,
        allowAbortedSignal: timedOut,
      })
    ) {
      return;
    }

    this.inspectorMetadataAbortController = undefined;
    this.setInspectorMetadata(nextMetadata);
  }

  private async fetchInspectorMetadataRest({
    runtimeUrl,
    headers,
    credentials,
    signal,
  }: {
    runtimeUrl: string;
    headers: Record<string, string>;
    credentials: RequestCredentials | undefined;
    signal: AbortSignal;
  }): Promise<Response> {
    return fetch(`${runtimeUrl}/inspector-metadata`, {
      method: "GET",
      headers,
      ...(credentials ? { credentials } : {}),
      signal,
    });
  }

  private async fetchInspectorMetadataSingle({
    runtimeUrl,
    headers,
    credentials,
    signal,
  }: {
    runtimeUrl: string;
    headers: Record<string, string>;
    credentials: RequestCredentials | undefined;
    signal: AbortSignal;
  }): Promise<Response> {
    return fetch(runtimeUrl, {
      method: "POST",
      headers: withJsonContentType(headers),
      body: JSON.stringify({ method: "inspector/metadata" }),
      ...(credentials ? { credentials } : {}),
      signal,
    });
  }

  private isInspectorMetadataRequestCurrent({
    generation,
    runtimeUrl,
    requestedTransport,
    resolvedTransport,
    headersGeneration,
    credentialsGeneration,
    signal,
    allowAbortedSignal = false,
  }: {
    generation: number;
    runtimeUrl: string;
    requestedTransport: CopilotRuntimeTransport;
    resolvedTransport: CopilotRuntimeTransport;
    headersGeneration: number;
    credentialsGeneration: number;
    signal: AbortSignal;
    allowAbortedSignal?: boolean;
  }): boolean {
    return (
      (allowAbortedSignal || !signal.aborted) &&
      generation === this.inspectorMetadataGeneration &&
      runtimeUrl === this.runtimeUrl &&
      requestedTransport === this._requestedTransport &&
      resolvedTransport === this._runtimeTransport &&
      headersGeneration === this.inspectorMetadataHeadersGeneration &&
      credentialsGeneration === this.inspectorMetadataCredentialsGeneration &&
      this._inspectorMetadataSupported &&
      this.inspectorMetadataRefreshReady &&
      this._runtimeConnectionStatus ===
        CopilotKitCoreRuntimeConnectionStatus.Connected
    );
  }

  private invalidateInspectorMetadataConnection(): void {
    this._inspectorMetadataSupported = false;
    this.inspectorMetadataRefreshReady = false;
    this.inspectorMetadataConnectionGeneration += 1;
    this.inspectorMetadataGeneration += 1;
    this.inspectorMetadataAbortController?.abort();
    this.inspectorMetadataAbortController = undefined;
    this.setInspectorMetadata(undefined);
  }

  /**
   * Publish one state transition without making refreshes wait on subscribers.
   * Each queued callback closes over its readonly snapshot so reentrant changes
   * cannot replace the value that an older publication is still delivering.
   */
  private setInspectorMetadata(
    inspectorMetadata: InspectorMetadataV1 | undefined,
  ): void {
    if (
      JSON.stringify(this._inspectorMetadata) ===
      JSON.stringify(inspectorMetadata)
    ) {
      return;
    }

    this._inspectorMetadata = inspectorMetadata;
    const snapshot = inspectorMetadata;
    this.inspectorMetadataNotificationQueue =
      this.inspectorMetadataNotificationQueue
        .then(() => this.notifyInspectorMetadataChanged(snapshot))
        .catch((error: unknown) => {
          console.error(
            "Subscriber onInspectorMetadataChanged queue error:",
            error,
          );
        });
  }

  /**
   * The single write path for the runtime connection status. Every transition
   * bumps `runtimeHealthGeneration` so a reachability probe that started
   * earlier can tell that its verdict is stale (OSS-904).
   */
  private setRuntimeConnectionStatus(
    status: CopilotKitCoreRuntimeConnectionStatus,
  ): void {
    this._runtimeConnectionStatus = status;
    this.runtimeHealthGeneration += 1;
  }

  /**
   * Route one runtime-bound request outcome into the connection status.
   * `alreadyChecked` is true only when this request's watchdog actually
   * started a probe — a later success still counts.
   */
  private handleRuntimeRequestOutcome(
    outcome: RuntimeRequestOutcome,
    alreadyChecked: () => boolean = () => false,
  ): boolean {
    // A cancelled request is the user pressing Stop (or a component
    // unmounting), not a connectivity problem. `ignored` is a failure the
    // caller declared harmless — see `RuntimeRequestMeta`.
    if (outcome === "aborted" || outcome === "ignored") {
      return false;
    }
    if (outcome === "failed" && alreadyChecked()) {
      return false;
    }
    // Never run during server rendering — same guard as `connectRuntime`.
    if (typeof window === "undefined") {
      return false;
    }
    if (!this._runtimeUrl) {
      return false;
    }

    if (outcome === "ok") {
      // The runtime answered, which makes any in-flight probe's verdict — and
      // any in-flight re-sync's — stale: a success that lands after one started
      // must win over it.
      this.runtimeHealthGeneration += 1;
      if (this.runtimeRecoveryRunning) {
        // A re-sync is already running and this success is newer than it. Its
        // answer, whatever it turns out to be, is about a moment that has
        // passed, so queue another rather than letting this success be the one
        // that is lost.
        this.runtimeRecoveryPending = true;
      }
      if (
        this._runtimeConnectionStatus ===
        CopilotKitCoreRuntimeConnectionStatus.Error
      ) {
        // Only way out of Error: agents must stay so Send can fire this.
        void this.recoverRuntimeConnection();
      }
      return false;
    }

    if (
      this._runtimeConnectionStatus !==
      CopilotKitCoreRuntimeConnectionStatus.Connected
    ) {
      return false;
    }
    if (this.runtimeProbeInFlight) {
      return false;
    }
    void this.probeRuntimeReachability();
    return true;
  }

  /**
   * Fetch `/info` and give up after {@link ɵRUNTIME_PROBE_TIMEOUT_MS}.
   * Attach `.catch` on the request before the race so a late AbortError is
   * not unhandled.
   */
  private async fetchRuntimeInfoWithTimeout(
    abortController: AbortController,
  ): Promise<RuntimeInfoFetchResult> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const request = this.fetchRuntimeInfo(abortController.signal);
    void request.catch(() => {});
    try {
      const timedOut = new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          abortController.abort();
          reject(
            new Error(
              `Runtime did not answer within ${ɵRUNTIME_PROBE_TIMEOUT_MS}ms`,
            ),
          );
        }, ɵRUNTIME_PROBE_TIMEOUT_MS);
      });
      return await Promise.race([request, timedOut]);
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  }

  private async probeRuntimeReachability(): Promise<void> {
    const generation = this.runtimeHealthGeneration;
    const token = ++this.runtimeProbeToken;
    this.runtimeProbeInFlight = true;
    const abortController = new AbortController();
    this.runtimeProbeAbortController = abortController;
    try {
      await this.fetchRuntimeInfoWithTimeout(abortController);
    } catch (error) {
      if (generation !== this.runtimeHealthGeneration) {
        return;
      }
      await this.markRuntimeUnreachable(
        error instanceof Error ? error : new Error(String(error)),
      );
    } finally {
      if (this.runtimeProbeAbortController === abortController) {
        this.runtimeProbeAbortController = undefined;
      }
      if (this.runtimeProbeToken === token) {
        this.runtimeProbeInFlight = false;
      }
    }
  }

  /**
   * Mid-session loss of contact: set Error, notify, emit. Do not clear agents
   * — Send is the only way back to Connected.
   */
  private async markRuntimeUnreachable(error: Error): Promise<void> {
    this.setRuntimeConnectionStatus(
      CopilotKitCoreRuntimeConnectionStatus.Error,
    );
    await this.notifyRuntimeStatusChanged(
      CopilotKitCoreRuntimeConnectionStatus.Error,
    );

    // "Did not answer" and "answered, but refused" are the SAME status and
    // different diagnoses. An expired token, a denied authorisation or an
    // internal error all mean the application cannot work, so red is correct
    // and matches the startup path, which classifies the same way. But telling
    // the reader a runtime that answered is "unreachable" sends them to check
    // addresses, ports and containers while the real cause is a credential.
    const runtimeStatus = isRuntimeInfoRequestError(error)
      ? error.runtimeInfoStatus
      : undefined;
    logger.warn(
      runtimeStatus === undefined
        ? `Runtime did not answer the identification request (${this._runtimeUrl}/info): ${error.message}. The runtime appears to be unreachable.`
        : `Runtime answered the identification request with status ${runtimeStatus} (${this._runtimeUrl}/info): ${error.message}. The runtime is reachable but refused the request — check credentials and authorisation before addresses and ports.`,
    );
    // The same code the startup handshake emits: a customer already handling
    // startup wiring failures picks up the mid-session case without changing a
    // line, and the operation that failed genuinely is a runtime info request.
    await (this.core as unknown as CopilotKitCoreFriendsAccess).emitError({
      error,
      code: CopilotKitCoreErrorCode.RUNTIME_INFO_FETCH_FAILED,
      context: {
        runtimeUrl: this._runtimeUrl,
        // Additive diagnostic context, not a new status or code: the
        // distinction is worth telling a handler about, and neither meaning
        // needs a reader to be taught a new value.
        reason: runtimeStatus === undefined ? "no-answer" : "answered",
        ...(runtimeStatus === undefined ? {} : { runtimeStatus }),
      },
    });
  }

  /**
   * Re-run `/info` after a successful request ends an outage. Preserve agents
   * on failure. Queue one follow-up if another success lands while this runs.
   */
  private async recoverRuntimeConnection(): Promise<void> {
    if (this.runtimeRecoveryRunning) {
      this.runtimeRecoveryPending = true;
      return;
    }
    this.runtimeRecoveryRunning = true;
    try {
      do {
        this.runtimeRecoveryPending = false;
        await this.updateRuntimeConnection({
          preserveOnFailure: true,
          recovery: true,
        });
      } while (
        this.runtimeRecoveryPending &&
        this._runtimeConnectionStatus !==
          CopilotKitCoreRuntimeConnectionStatus.Connected
      );
    } finally {
      this.runtimeRecoveryRunning = false;
      this.runtimeRecoveryPending = false;
    }
  }

  /**
   * Update runtime connection and fetch remote agents
   */
  private async updateRuntimeConnection(
    options?: RuntimeConnectionOptions,
  ): Promise<void> {
    // Skip fetching on the server (SSR)
    if (typeof window === "undefined") {
      return;
    }

    // In-flight guard: if a connection to the same target (runtime url +
    // requested transport) is already running, reuse it instead of starting a
    // second `/info` request. A change to a different target supersedes it. See
    // #5801.
    //
    // Collapse concurrent connects to the same target. Recovery must not
    // collapse onto a dying attempt — `recoverRuntimeConnection` queues instead.
    const key = `${this._runtimeUrl ?? ""}::${this._requestedTransport}`;
    const inFlight = this._connectionInFlight;
    if (inFlight && inFlight.key === key) {
      return inFlight.promise;
    }

    const promise = this.performRuntimeConnection(options);
    this._connectionInFlight = { key, promise };
    void promise.finally(() => {
      if (this._connectionInFlight?.promise === promise) {
        this._connectionInFlight = undefined;
      }
    });
    return promise;
  }

  private async performRuntimeConnection(
    options?: RuntimeConnectionOptions,
  ): Promise<void> {
    if (!this.runtimeUrl) {
      this.invalidateInspectorMetadataConnection();
      this.setRuntimeConnectionStatus(
        CopilotKitCoreRuntimeConnectionStatus.Disconnected,
      );
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

    const inspectorMetadataConnectionGeneration =
      this.inspectorMetadataConnectionGeneration;

    this.setRuntimeConnectionStatus(
      CopilotKitCoreRuntimeConnectionStatus.Connecting,
    );
    // Captured AFTER the transition above (which bumps it). A successful
    // runtime request landing while this attempt is in flight moves it, which
    // is the signal that this attempt's answer is about a moment that has
    // passed. `inspectorMetadataConnectionGeneration` does NOT move on a
    // successful runtime request, so it cannot express this on its own.
    const runtimeHealthGeneration = this.runtimeHealthGeneration;
    await this.notifyRuntimeStatusChanged(
      CopilotKitCoreRuntimeConnectionStatus.Connecting,
    );

    try {
      if (
        inspectorMetadataConnectionGeneration !==
        this.inspectorMetadataConnectionGeneration
      ) {
        return;
      }
      const { runtimeInfo: runtimeInfoResponse, resolvedTransport } =
        options?.recovery
          ? await this.fetchRuntimeInfoWithTimeout(new AbortController())
          : await this.fetchRuntimeInfo();
      if (
        inspectorMetadataConnectionGeneration !==
        this.inspectorMetadataConnectionGeneration
      ) {
        return;
      }

      this._runtimeTransport = resolvedTransport;
      const { version, ...runtimeInfo } = runtimeInfoResponse;

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
              this.applyRuntimeFetchToAgent(existing);
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
            this.applyRuntimeFetchToAgent(agent);
            this.mintedThreadIds.set(agent, agent.threadId);
            return [id, agent];
          },
        ),
      );

      // Ids present in `runtimeInfo.agents` are carried over (reused or freshly
      // minted above); ids no longer advertised are dropped because they are
      // absent from this rebuilt map.
      //
      // A deliberate configuration change and a fresh page load both ask the
      // question on purpose and can trust the whole answer, so they replace the
      // set outright. Recovery cannot — see `reconcileRecoveredAgents`.
      this.remoteAgents = options?.recovery
        ? this.reconcileRecoveredAgents(agents)
        : agents;
      this._agents = { ...this.localAgents, ...this.remoteAgents };
      this.setRuntimeConnectionStatus(
        CopilotKitCoreRuntimeConnectionStatus.Connected,
      );
      this._runtimeVersion = version;
      this._audioFileTranscriptionEnabled =
        runtimeInfoResponse.audioFileTranscriptionEnabled ?? false;
      this._runtimeMode = runtimeInfoResponse.mode ?? RUNTIME_MODE_SSE;
      this._intelligence = runtimeInfoResponse.intelligence;
      this._threadEndpoints = runtimeInfoResponse.threadEndpoints;
      this._suggestions = runtimeInfoResponse.suggestions;
      this._inspectorMetadataSupported =
        runtimeInfoResponse.inspectorMetadata === true;
      this.inspectorMetadataRefreshReady = false;
      if (!this._inspectorMetadataSupported) {
        this.setInspectorMetadata(undefined);
      }
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
      if (
        inspectorMetadataConnectionGeneration !==
          this.inspectorMetadataConnectionGeneration ||
        this._runtimeConnectionStatus !==
          CopilotKitCoreRuntimeConnectionStatus.Connected
      ) {
        return;
      }
      this.inspectorMetadataRefreshReady = true;
      if (this._inspectorMetadataSupported) {
        void this.refreshInspectorMetadata();
      }
    } catch (error) {
      if (
        inspectorMetadataConnectionGeneration !==
        this.inspectorMetadataConnectionGeneration
      ) {
        return;
      }
      if (options?.preserveOnFailure) {
        // Keep agents. Recovery skips painting Error if a later success
        // already moved the generation — it has a follow-up queued.
        if (
          options?.recovery &&
          runtimeHealthGeneration !== this.runtimeHealthGeneration
        ) {
          return;
        }
        this.setRuntimeConnectionStatus(
          CopilotKitCoreRuntimeConnectionStatus.Error,
        );
        await this.notifyRuntimeStatusChanged(
          CopilotKitCoreRuntimeConnectionStatus.Error,
        );
      } else {
        this.invalidateInspectorMetadataConnection();
        this.setRuntimeConnectionStatus(
          CopilotKitCoreRuntimeConnectionStatus.Error,
        );
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
      }

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

  /**
   * @param signal - Cancels the request. Supplied by the reachability probe so
   * its bound actually closes the socket rather than only giving up on the
   * answer; the startup handshake passes nothing and is unaffected.
   */
  private async fetchRuntimeInfo(
    signal?: AbortSignal,
  ): Promise<RuntimeInfoFetchResult> {
    const runtimeUrl = this.runtimeUrl;
    if (!runtimeUrl) {
      throw new Error("Runtime URL is not set");
    }

    const baseHeaders = (this.core as unknown as CopilotKitCoreFriendsAccess)
      .headers;
    const credentials = (this.core as unknown as CopilotKitCoreFriendsAccess)
      .credentials;
    const headers: Record<string, string> = {
      ...baseHeaders,
    };

    const runtimeTransport = this._runtimeTransport;
    if (runtimeTransport === "single") {
      return {
        runtimeInfo: await this.fetchRuntimeInfoSingle(
          runtimeUrl,
          headers,
          credentials,
          signal,
        ),
        resolvedTransport: "single",
      };
    }

    if (runtimeTransport === "auto") {
      return this.fetchRuntimeInfoAutoDetect(
        runtimeUrl,
        headers,
        credentials,
        signal,
      );
    }

    // REST transport
    const response = await fetch(`${runtimeUrl}/info`, {
      headers,
      ...(credentials ? { credentials } : {}),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) {
      throw await runtimeInfoError(response);
    }
    return {
      runtimeInfo: (await response.json()) as RuntimeInfo,
      resolvedTransport: "rest",
    };
  }

  private async fetchRuntimeInfoSingle(
    runtimeUrl: string,
    headers: Record<string, string>,
    credentials: RequestCredentials | undefined,
    signal?: AbortSignal,
  ): Promise<RuntimeInfo> {
    const response = await fetch(runtimeUrl, {
      method: "POST",
      headers: withJsonContentType(headers),
      body: JSON.stringify({ method: "info" }),
      ...(credentials ? { credentials } : {}),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) {
      throw await runtimeInfoError(response);
    }
    return (await response.json()) as RuntimeInfo;
  }

  /**
   * Auto-detect transport by trying REST first, then falling back to single-endpoint.
   * The caller commits the detected transport only after confirming this
   * connection attempt is still current.
   */
  private async fetchRuntimeInfoAutoDetect(
    runtimeUrl: string,
    headers: Record<string, string>,
    credentials: RequestCredentials | undefined,
    signal?: AbortSignal,
  ): Promise<RuntimeInfoFetchResult> {
    // Try REST first (GET /info)
    try {
      const response = await fetch(`${runtimeUrl}/info`, {
        headers: { ...headers },
        ...(credentials ? { credentials } : {}),
        ...(signal ? { signal } : {}),
      });
      // Only treat a successful (2xx) response as a valid REST runtime.
      // 404/405 means the endpoint doesn't exist; other non-2xx errors
      // (500, 403, etc.) should also fall through to single-endpoint.
      if (response.status >= 200 && response.status < 300) {
        return {
          runtimeInfo: (await response.json()) as RuntimeInfo,
          resolvedTransport: "rest",
        };
      }
      // Non-2xx — try single-endpoint below
    } catch {
      // REST failed (network error, etc.) — fall through to single-endpoint attempt
    }

    const runtimeInfo = await this.fetchRuntimeInfoSingle(
      runtimeUrl,
      { ...headers },
      credentials,
      signal,
    );
    return { runtimeInfo, resolvedTransport: "single" };
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

  private async notifyInspectorMetadataChanged(
    inspectorMetadata: InspectorMetadataV1 | undefined,
  ): Promise<void> {
    await (
      this.core as unknown as CopilotKitCoreFriendsAccess
    ).notifySubscribers(
      (subscriber) =>
        subscriber.onInspectorMetadataChanged?.({
          copilotkit: this.core,
          inspectorMetadata,
        }),
      "Subscriber onInspectorMetadataChanged error:",
    );
  }
}
