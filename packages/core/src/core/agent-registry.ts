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
 * Maximum wait for the reachability probe's `/info` answer before the runtime
 * is treated as unreachable.
 *
 * A server fails two ways: it refuses the connection (fast) or it accepts and
 * never answers. A stopped dev server refuses; a container mid-rollout, a
 * half-switched deploy and a dropped tunnel all HANG — which is the motivating
 * list for this whole feature. Without a bound the probe never settles, its
 * in-flight latch is never released, every later failure short-circuits on that
 * latch, and the status stays green forever: the original bug, restored in full,
 * for exactly the cases the ticket names.
 *
 * Like {@link RUNTIME_REQUEST_WATCHDOG_MS} it is a per-request bound and not a
 * schedule: armed inside the handling of one request, always cleared, and it
 * starts no work of its own. Those two are the only timers this feature has —
 * see the "no polling, no retry loop" decision.
 *
 * Matches {@link INSPECTOR_METADATA_REQUEST_TIMEOUT_MS}: the same runtime, the
 * same kind of optional-at-this-moment question, and a developer watching a
 * dead runtime should not wait longer for the light to turn red than for
 * metadata to degrade to absence.
 *
 * Exported for tests, which must derive their waits from it rather than
 * hardcode a number that silently drifts away from this one.
 */
export const RUNTIME_PROBE_TIMEOUT_MS = 5_000;

/**
 * What the instrumented fetch observed about one runtime-bound request.
 *
 * Only `ok` and `failed` carry information about the runtime. `aborted` is a
 * cancellation (Stop pressed, component unmounted) and `ignored` is a failure
 * the caller declared harmless — see {@link RuntimeRequestMeta}.
 */
type RuntimeRequestOutcome = "ok" | "failed" | "aborted" | "ignored";

/**
 * Classify a rejected runtime request.
 *
 * A cancellation is excluded because pressing Stop is not an outage. A caller
 * that aborted on its OWN timeout is not a cancellation, though it arrives as
 * the same `AbortError`: nothing came back, which is the very thing the status
 * reports. Distinguishing them by the caller's own marker rather than by
 * inspecting the abort reason keeps genuine stop/unmount exclusion working
 * exactly as it does today, and does not depend on `AbortSignal.reason`
 * support.
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
  /**
   * Keep every piece of runtime knowledge if this attempt FAILS.
   *
   * Set by recovery, and by a configuration change made from a mid-session
   * error state — see `hasLiveRuntimeKnowledgeToProtect`.
   */
  preserveOnFailure?: boolean;
  /**
   * This attempt IS the recovery re-sync. Two things follow:
   *
   * - it never drops an agent its `/info` does not report (add and update, but
   *   do not remove);
   * - a success that landed after it started overtakes its failure verdict
   *   rather than being painted over.
   *
   * The second is safe ONLY here, because `recoverRuntimeConnection` has a
   * follow-up attempt queued for that success. A configuration change has no
   * such follow-up, so declining to paint would leave the status at
   * `connecting` with nothing to settle it.
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
   * Whether a failed connection attempt starting from HERE would destroy
   * something a live session is using (OSS-904).
   *
   * The PRD's safety argument names three interlocking sites — preserving
   * runtime knowledge on the way into the error state, preserving it again if
   * the recovery re-sync fails, and keeping the submission gate open
   * throughout. A configuration change made while contact is lost is a fourth,
   * and it is a plausible one: a developer fiddles with configuration precisely
   * when the indicator is red. Reaching the destructive path from there wipes
   * the agents, empties the conversation, closes the submission gate — and
   * because `connectRuntime()` only fires from `Disconnected` and only a
   * successful request restores the status, the application is stuck red for
   * the rest of the page's life.
   *
   * The question is deliberately asked about the KNOWLEDGE and not about a
   * status value. Two conditions, and each is load-bearing:
   *
   * - Remote agents exist. They are the thing being protected: the conversation
   *   lives on the agent instance and the submission gate is open exactly while
   *   one is bound. With none, there is nothing a failure could destroy, and
   *   preserving would only leave a stale version and stale capabilities behind
   *   — an invisible wrong state, which is the harder bug.
   * - Contact is not currently established. From `Connected` a failed
   *   deliberate change keeps the existing destructive behaviour, and correctly
   *   so: the developer who just changed the configuration can change it again,
   *   which is a way out that does not run through the agents.
   *
   * Phrasing it as `!== Connected` rather than `=== Error` is the whole point.
   * Recovery passes through `Connecting` by design, so a guard pinned to
   * `Error` leaves a window — open for as long as a re-sync's `/info` takes,
   * against a runtime that is often only part-way back — in which a
   * configuration change takes the destructive path and strands the
   * application. `Disconnected` never carries remote agents, so the first
   * condition covers it.
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
   * The instrumented `fetch` every runtime-bound request should go through —
   * the single point at which the outcome of a request to the runtime can be
   * observed (OSS-904).
   *
   * The connection status is a report of the last actual contact with the
   * runtime, and this is where "actual contact" is observed: a response that
   * came back (`ok`), a request that did not (`failed`), or a cancellation
   * (`aborted`, ignored — pressing Stop is not an outage).
   *
   * It is a pass-through: the original `Response` is returned and the original
   * error re-thrown, unchanged and un-swallowed. Callers cannot tell it apart
   * from `fetch` except that the status now tracks what happened.
   *
   * The rule is expressed by destination, not by call site: anything routed
   * through this fetch is runtime traffic, so a runtime route added later
   * inherits the behaviour without anyone remembering to update a list.
   *
   * A request that never SETTLES is observed too, by
   * {@link armRuntimeRequestWatchdog} — see {@link RUNTIME_REQUEST_WATCHDOG_MS}
   * for why an outcome-only seam has a hole exactly where this feature's
   * motivating failures live.
   *
   * The returned function is memoized so re-applying it to an agent (headers
   * change, re-connection) is idempotent.
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
            watchdog.reported,
          );
          return response;
        } catch (error) {
          watchdog.clear();
          this.handleRuntimeRequestOutcome(
            classifyRuntimeRequestFailure(error, meta()),
            watchdog.reported,
          );
          throw error;
        }
      }) as typeof fetch;
    }
    return this.runtimeFetch;
  }

  /**
   * Watch ONE runtime request for silence (OSS-904).
   *
   * If no response head arrives within {@link RUNTIME_REQUEST_WATCHDOG_MS} the
   * request's silence is reported as the same "suspected outage" a failure
   * reports, which runs the ordinary confirmation probe. The request is left
   * strictly alone: not aborted, not cancelled, not raced. A runtime that is
   * only slow still finishes the user's run and still reports its own outcome
   * afterwards.
   *
   * Two requests never arm it:
   *
   * - one the caller declared non-critical, consistent with every other rule
   *   keyed on that marker: a request the code itself treats as harmless must
   *   not be able to trigger anything;
   * - one the caller already bounds with its own timeout (the thread routes).
   *   Such a request cannot fail to produce an outcome, which is the ONLY gap
   *   this exists to fill, and a shorter bound of ours would quietly override
   *   the budget the caller chose.
   *
   * Guarded on `window` like every other side effect here: this package also
   * runs in React Native and during server rendering, and nothing new may run
   * on the server.
   *
   * The timer is always cleared when the request settles. The package has no
   * disposal path, so an uncleared timer has no owner to collect it — and would
   * fire a probe ten seconds after a perfectly good run. It is a `setTimeout`
   * and must stay one: a repeating timer here would be exactly the recurring
   * background traffic this design rejects by name, firing a fresh probe every
   * interval for as long as one request hangs.
   *
   * `reported` records whether the watchdog's report actually CAUSED a check,
   * not whether the timer fired. The report is discarded outright when a probe
   * is already in flight, when the status is not `Connected`, or when there is
   * no runtime url — and a flag claiming otherwise makes the request's own
   * later failure short-circuit on a check that never happened, leaving the
   * status green against a dead runtime.
   */
  private armRuntimeRequestWatchdog(meta: RuntimeRequestMeta | undefined): {
    clear: () => void;
    reported: () => boolean;
  } {
    if (
      typeof window === "undefined" ||
      meta?.nonCritical ||
      meta?.selfBounded
    ) {
      return { clear: () => {}, reported: () => false };
    }
    let checked = false;
    const timeoutId = setTimeout(() => {
      checked = this.handleRuntimeRequestOutcome("failed");
    }, RUNTIME_REQUEST_WATCHDOG_MS);
    return {
      clear: () => clearTimeout(timeoutId),
      reported: () => checked,
    };
  }

  /**
   * Route an agent's outbound HTTP through the instrumented fetch. Applied
   * everywhere `applyHeadersToAgent` is, so that "the registry handed you this
   * agent" and "this agent's runtime traffic is observed" cannot drift apart.
   *
   * `HttpAgent.fetch` backs both the single-endpoint transport (called
   * directly) and the REST transport (via `super.run`), so one assignment
   * covers both, and `ProxiedCopilotRuntimeAgent` also uses it for the `/info`
   * request it issues to re-resolve its own runtime mode.
   *
   * Agents pointing at a customer's own server are not
   * `ProxiedCopilotRuntimeAgent`s and are deliberately left alone: their
   * failures say nothing about our runtime, and one of them failing must not
   * make a shared status red while other agents are working. That is also why
   * this is applied by TYPE rather than to every agent in the record.
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
   * React to one runtime-bound request's outcome (OSS-904).
   *
   * Detection is reactive in both directions and there is no timer: a failed
   * runtime request can move the status to error, a successful one can move it
   * back, and nothing else moves it. Deliberate consequence: while the
   * application is idle nothing is detected in either direction.
   *
   * @param alreadyChecked - This request's watchdog already reported its
   * silence and that report actually STARTED a check. The failure now arriving
   * is the same fact about the same request, not a second incident, so it must
   * not buy a second probe. A SUCCESS still counts: the runtime answered after
   * all, and that is the evidence that ends an outage. Neither the in-flight
   * latch nor the "only probe while Connected" guard covers this on its own — a
   * probe that came back healthy releases both, and the request can fail long
   * after.
   *
   * It is deliberately "did a check happen" and not "did the timer fire". A
   * report that found the latch held, the status already red, or no runtime url
   * changed nothing; suppressing the request's real failure on the strength of
   * it would swallow the only evidence there is. A failure arriving after a
   * check came back healthy is new information, not part of that burst.
   *
   * @returns whether this call started a confirmation check.
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
        // LOAD-BEARING: this is the ONLY way out of the error state. It can
        // only ever fire because the error state left the user able to send —
        // which is true only because the transition into it preserved the
        // agents (see `markRuntimeUnreachable`) and a failed recovery re-sync
        // preserves them too (see `preserveOnFailure` in
        // `performRuntimeConnection`). Submission in the chat view is gated on
        // a real agent being bound; discard the agents at either of those two
        // sites and that gate closes, no successful request can be issued, and
        // the application is stuck red for the rest of the page's life.
        // Anyone removing any one of the three must replace this recovery
        // mechanism first.
        void this.recoverRuntimeConnection();
      }
      return false;
    }

    // A failure only means something while we believed we were connected.
    // While `Error` there is nothing to confirm (and issuing traffic would be
    // the retry loop this design rejects — one probe and one duplicate error
    // emission per retry, driven by a user hammering Send at a red indicator);
    // while `Connecting`/`Disconnected` the connection attempt itself owns the
    // status.
    if (
      this._runtimeConnectionStatus !==
      CopilotKitCoreRuntimeConnectionStatus.Connected
    ) {
      return false;
    }
    // Burst collapsing is the in-flight latch's job and only the latch's:
    // several simultaneous failures against one dead runtime cost exactly one
    // probe. There is deliberately no window after a probe has SETTLED in which
    // failures are absorbed. Such a window only ever suppressed a runtime
    // flapping error -> connected -> failing again inside it, and for that case
    // it is the window itself that does the damage: the second outage leaves no
    // trace and the status reads connected while nothing works.
    if (this.runtimeProbeInFlight) {
      return false;
    }
    void this.probeRuntimeReachability();
    return true;
  }

  /**
   * Ask the runtime once, directly, whether it is there.
   *
   * This is what makes the deliberately generous failure trigger safe: from
   * inside the browser a server error raised by the runtime is
   * indistinguishable from one raised by a proxy in front of it, so the trigger
   * does not have to be right — only cheap. A wrong guess costs exactly one
   * request and changes nothing.
   *
   * It reuses `fetchRuntimeInfo` (the same question asked at startup, on
   * whichever transport is in use) but deliberately NOT
   * `updateRuntimeConnection`, whose failure branch discards runtime knowledge.
   *
   * It is BOUNDED. A runtime that accepts the connection and never answers is
   * the second way a server dies and the one this feature's own motivating list
   * is made of; an unbounded probe against it never settles, never releases its
   * latch, and restores the original bug in full. See
   * {@link RUNTIME_PROBE_TIMEOUT_MS}.
   */
  private async probeRuntimeReachability(): Promise<void> {
    const generation = this.runtimeHealthGeneration;
    const token = ++this.runtimeProbeToken;
    this.runtimeProbeInFlight = true;
    const abortController = new AbortController();
    this.runtimeProbeAbortController = abortController;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const timedOut = new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          // Cancel the real request too: a bound that leaves the socket open
          // is only half a bound.
          abortController.abort();
          reject(
            new Error(
              `Runtime did not answer within ${RUNTIME_PROBE_TIMEOUT_MS}ms`,
            ),
          );
        }, RUNTIME_PROBE_TIMEOUT_MS);
      });
      // `Promise.race` attaches a rejection handler to the loser as well, so a
      // late failure from the abandoned request cannot surface as unhandled.
      await Promise.race([
        this.fetchRuntimeInfo(abortController.signal),
        timedOut,
      ]);
      // The runtime answered: the failure was a blip, not an outage.
    } catch (error) {
      // Ordering: only apply the verdict if nothing has moved since. A status
      // transition, a successful runtime request, or a configuration change in
      // the meantime means this answer is about a moment that has passed.
      if (generation !== this.runtimeHealthGeneration) {
        return;
      }
      // Confirmed unreachable.
      await this.markRuntimeUnreachable(
        error instanceof Error ? error : new Error(String(error)),
      );
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
      if (this.runtimeProbeAbortController === abortController) {
        this.runtimeProbeAbortController = undefined;
      }
      // Never clear a latch that now belongs to a newer probe.
      if (this.runtimeProbeToken === token) {
        this.runtimeProbeInFlight = false;
      }
    }
  }

  /**
   * Mid-session loss of contact: set the status, notify, emit the error, and
   * touch NOTHING else.
   *
   * NARROW ON PURPOSE. The startup failure path (see the catch in
   * `performRuntimeConnection`) also clears the agent list, the version and
   * every capability, which is correct at startup — none of it was ever
   * obtained — and destructive mid-session: conversation state lives on the
   * agent instance, so clearing `remoteAgents` makes the binding mint an empty
   * stand-in and the user's open conversation leaves the screen. It would also
   * close the submission gate, and submission is the only thing that restores
   * the status (see the recovery comment in `handleRuntimeRequestOutcome`) —
   * i.e. it would produce an error state the user can never leave.
   *
   * "Error with agents present" is a working state, not a new one: every
   * binding resolves the agent first and consults the status only when no agent
   * is found. That ordering is what makes preserving the agents safe.
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
   * The runtime answered again after an outage: re-run the full startup contact
   * rather than only repainting the status.
   *
   * Keeping stale knowledge during the outage is defensible only because it is
   * temporary — flipping the status alone would make it permanent, so a dev
   * server restarted with a new agent, a removed agent or a new version would
   * present the pre-outage picture until a page reload. The success branch of
   * `updateRuntimeConnection` reuses existing agent instances, so an open
   * conversation survives the re-sync.
   *
   * `preserveOnFailure` is what makes it safe to run at the moment the network
   * is least reliable (a container mid-rollout, a tunnel re-establishing), and
   * `recovery` is what stops a runtime that is only PART-WAY
   * back — alive, and listing few or no agents — from destroying the
   * conversation through the success branch.
   *
   * The loop is not a retry loop. It turns exactly once per successful runtime
   * request that arrived while an earlier re-sync was still running, so it is
   * driven by observed traffic and stops the moment traffic does. It exists
   * because such a success would otherwise be dropped two ways: collapsed onto
   * an attempt that is already settling into `Error`, or overtaken by that
   * attempt's stale verdict.
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
    // The key deliberately ignores the options: collapsing onto an in-flight
    // attempt is preferable to issuing a second `/info`.
    //
    // The two CAN overlap, contrary to what this comment used to claim. A
    // recovery starts while the status is `Error`, and a failing attempt sets
    // the status back to `Error` synchronously and then awaits its subscriber
    // notification and error emission while still holding this key — so a
    // success landing in that window is handed an attempt that is already
    // dying, issues no `/info`, and the recovery is lost while the chat
    // visibly works. `recoverRuntimeConnection` closes that window by queueing
    // instead of collapsing; this guard is left as it is so ordinary
    // concurrent connects still collapse.
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
        await this.fetchRuntimeInfo();
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
            return [id, agent];
          },
        ),
      );

      // Ids present in `runtimeInfo.agents` are carried over (reused or freshly
      // minted above); ids no longer advertised are dropped because they are
      // absent from this rebuilt map.
      //
      // EXCEPT on recovery. A runtime that is only part-way back answers
      // truthfully that it is alive while listing few or no agents, and
      // believing that report drops the agents, empties the conversation and
      // closes the submission gate — with the status reading `connected` and no
      // error emitted, i.e. the exact damage this design exists to prevent,
      // reached through the success branch instead of the failure branch.
      // Removal stays correct on a deliberate configuration change and on a
      // fresh page load, where the report can be trusted.
      this.remoteAgents = options?.recovery
        ? { ...this.remoteAgents, ...agents }
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
      // Recovery announces its agent set like every other connection attempt.
      //
      // This used to be skipped for an unchanged set, because core re-subscribes
      // the state manager per agent on every `onAgentsChanged` and that revoked
      // the subscription an in-flight run was still reporting through — and the
      // re-sync runs while that run's stream is open, since the response
      // arriving is what triggered it. Suppressing the announcement was the
      // wrong lever: it only helped when the set happened to be unchanged, so a
      // developer who restarted the runtime BECAUSE they added an agent
      // (the reason for restarting it) still lost the recovering run's state,
      // and an unchanged-set check that stopped working would silently swallow a
      // genuinely new agent. `state-manager.ts` now leaves a live subscription
      // alone when it is handed the same agent instance, which fixes both
      // directions at the source and for every caller, not just this one.
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
        // RECOVERY RE-SYNC FAILED — and this branch is why recovery is allowed
        // to run at all.
        //
        // The destructive branch below is correct at startup, where a failed
        // first contact means no runtime knowledge was ever obtained. Here the
        // knowledge exists and belongs to a live conversation, and this attempt
        // runs in the window where a runtime is often only part-way back (a
        // container mid-rollout, a tunnel re-establishing) — so it is MORE
        // exposed than the inbound transition, not less. Dropping the agents
        // here would empty the user's chat and close the submission gate, and
        // because only a successful request restores the status (see
        // `handleRuntimeRequestOutcome`), the application would be stuck red
        // for the rest of the page's life.
        //
        // So: set the status, notify, emit below — and preserve everything
        // else, exactly as though the outage had never appeared to end. That
        // deliberately includes NOT invalidating the inspector metadata
        // connection and NOT emitting `onAgentsChanged`: the agent set did not
        // change.
        //
        // ORDERING. A success that landed after this attempt started has
        // already demonstrated the runtime is there, so this answer describes a
        // moment that has passed and must not paint the status red over it —
        // the same rule the reachability probe applies.
        //
        // Recovery only, because recovery is the only caller with a follow-up
        // attempt queued for that success (see `recoverRuntimeConnection`). A
        // configuration change reaching this branch has nothing queued, so
        // declining to paint would leave the status at `connecting` forever.
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
