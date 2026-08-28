import { randomUUID } from "node:crypto";
import {
  ChannelConfigError,
  deriveChannelActivationConfig,
} from "./channel-activation-config";
import type { ChannelActivationConfig } from "./channel-activation-config";
import type { CopilotKitIntelligence } from "../intelligence-platform";
import { telemetry } from "../telemetry";
import type { AnalyticsEvents } from "../telemetry";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type {
  AgentSubscriber,
  BaseEvent,
  Message,
  RunAgentInput,
  RunAgentParameters,
  RunAgentResult,
} from "@ag-ui/client";
import { EMPTY } from "rxjs";
import { MCPMiddleware } from "@ag-ui/mcp-middleware";
import type { AgentRunner } from "../runner/agent-runner";
import {
  INTELLIGENCE_MEMORY_GRANT_HEADER,
  INTELLIGENCE_USER_ID_HEADER,
} from "../intelligence-platform/client";
// Type-only: @copilotkit/channels-core is pure-ESM, so a value import would break
// this package's CJS output (see `core/runtime.ts` and `channel-activation-config.ts`
// for the same constraint). Imported from channels-core rather than the
// @copilotkit/channels shim that re-exports it: channels is a devDependency, so
// tsdown inlines its prebuilt declarations here along with a rolldown helper
// chunk that ships no types (TS7016 for consumers, OSS-899). channels-core is a
// real dependency and stays external.
import type {
  Channel,
  ReplyContinuationOptions,
  ResolvedChannelMemory,
} from "@copilotkit/channels-core";
import type { CopilotRuntimeLearningConfig } from "./learning";
import {
  resolveLearningContainerId,
  resolveLearningContainerSelector,
} from "./learning";
import type { CopilotRuntimeUser } from "./learning";

/**
 * Lifecycle status of a single Channel activation, or of the manager overall.
 *
 * - `connecting`: activation in flight, not yet settled.
 * - `online`: activation resolved, the managed session can currently send, AND
 *   the gateway did not report the Channel as missing a managed provider. A drop
 *   moves the Channel to `reconnecting` (not `online`); a successful rejoin
 *   restores `online`.
 * - `setup_required`: the Channel is declared but has no managed provider yet —
 *   a valid degraded state, not a failure. Reached when the gateway reports the
 *   provider as unattached/disabled/undeclared on the control join reply (see
 *   {@link ChannelLegs}), or when the activation engine throws a
 *   `SETUP_REQUIRED` error.
 *
 *   NOTE: between the 2026-07-29 realtime-boundary cutover and the introduction
 *   of {@link ChannelLegs}, this state had NO producer — the engine stopped
 *   classifying it and nothing else set it, so a Channel with no Slack app at
 *   all reported `online`. Do not reintroduce a code path that describes
 *   `setup_required` without one that can actually emit it.
 * - `reconnecting`: the managed session dropped and Phoenix is retrying — not
 *   currently sendable. The manager does NOT re-activate (reconnection is
 *   delegated to the Phoenix connection layer); it only reflects the health the
 *   session reports via its `onStateChange` observer.
 * - `stopped`: {@link ChannelManager.stop} has torn the Channel down.
 * - `error`: activation rejected with a non-setup error, or a previously-online
 *   control link gave up reconnecting after its bounded reconnect window.
 *
 * A Channel may carry developer-supplied direct adapters alongside the managed
 * Intelligence adapter. The managed engine owns the shared Channel lifecycle;
 * each adapter still receives only its own ingress and sends only its own
 * provider output.
 */
export type ChannelStatus =
  | "connecting"
  | "online"
  | "setup_required"
  | "reconnecting"
  | "stopped"
  | "error";

/**
 * Managed provider attachment state for one Channel, as reported by the gateway
 * on the control join reply.
 *
 * `unknown` is this package's own value for "the gateway did not tell us" — a
 * gateway predating the provider-state contract, one whose lookup failed, or a
 * non-gateway handle. It must never be read as "no provider attached".
 */
export type ChannelProviderLeg =
  | "attached"
  | "unhealthy"
  | "not_attached"
  | "disabled"
  | "channel_not_declared"
  | "unknown";

/**
 * The two independent things that have to be true for a managed Channel to
 * work, reported separately so a caller can assert the one it cares about.
 *
 * `status` is the fold of the two and matches this Channel's entry in
 * {@link ChannelsControl.status}'s `channels` map.
 *
 * The legs exist because they are genuinely separable: the control socket can be
 * joined and sendable while no Slack/Teams app is bound to the Channel at all.
 * Before they were split, `overall: "online"` proved only the socket, and
 * onboarding guidance used it to certify end-to-end success.
 */
export interface ChannelLegs {
  /** Fold of {@link transport} and {@link provider}. */
  status: ChannelStatus;
  /** Runtime ⇄ Gateway control socket for this Channel. */
  transport: ChannelStatus;
  /** Whether a managed provider is bound to this Channel. */
  provider: ChannelProviderLeg;
}

/**
 * Recognised provider states, used to validate what crosses the seam.
 *
 * Deliberately duplicates `PROVIDER_STATES` in
 * `@copilotkit/channels-intelligence`'s `realtime-gateway.ts` rather than
 * importing it: this package must not take a static dependency on
 * channels-intelligence (it is reached only through a dynamic import), so the
 * `providerStates` seam is duck-typed as `Record<string, string>`.
 *
 * A state added there needs adding here too, plus a `case` in
 * {@link foldChannelLegs}. Until both land it fails OPEN — an unrecognised state
 * becomes `unknown` and the Channel keeps its transport-derived status, rather
 * than being wrongly certified or condemned.
 */
const PROVIDER_LEGS: ReadonlySet<string> = new Set<ChannelProviderLeg>([
  "attached",
  "unhealthy",
  "not_attached",
  "disabled",
  "channel_not_declared",
]);

/**
 * Fold a Channel's transport and provider legs into its single status.
 *
 * The transport leg dominates whenever it is not `online`: while the control
 * socket is connecting, retrying, stopped, or failed, whatever the gateway last
 * said about the provider is stale or irrelevant — the Channel cannot serve a
 * turn either way, and reporting `setup_required` for a Channel that is actually
 * mid-reconnect would hide the outage.
 *
 * Once the transport is `online` the provider leg decides, which is the whole
 * point of the split: a joined socket with no provider bound is
 * `setup_required`, not `online`.
 *
 * `unknown` keeps the transport-derived answer. That is what makes an older
 * gateway (or a gateway whose lookup failed) behave exactly as it did before
 * provider states existed, instead of turning every Channel into
 * `setup_required`.
 *
 * @param transport - Control-socket status for the Channel.
 * @param provider - Reported provider attachment state.
 * @returns The folded Channel status.
 */
export function foldChannelLegs(
  transport: ChannelStatus,
  provider: ChannelProviderLeg,
): ChannelStatus {
  if (transport !== "online") {
    return transport;
  }
  switch (provider) {
    case "attached":
    case "unknown":
      return "online";
    case "unhealthy":
      return "error";
    case "not_attached":
    case "disabled":
    case "channel_not_declared":
      return "setup_required";
  }
}

/**
 * The lifecycle control surface a Channel host uses to drive and observe
 * managed Channel activation.
 */
export interface ChannelsControl {
  /**
   * Resolve once every declared Channel has settled its ACTIVATION — that is,
   * each Channel either activated or failed to. Rejects if any Channel failed to
   * activate, or — when `timeoutMs` is given — if the whole set has not settled
   * in time.
   *
   * Readiness is about activation, NOT about provider health: a Channel whose
   * transport joined but whose provider leg is `unhealthy` folds to a status of
   * `error` (see {@link foldChannelLegs}) while its activation settled normally.
   * So `ready()` resolving and `status().overall === "error"` can both be true at
   * once, by design — provider attachment is the Gateway's answer to a question
   * asked after activation, and it can change at any later rejoin. Assert
   * end-to-end reachability with {@link ChannelsControl.status}, not here.
   */
  ready(opts?: { timeoutMs?: number }): Promise<void>;
  /**
   * Snapshot the overall status, the per-Channel status map, and the per-Channel
   * transport/provider legs.
   *
   * `overall === "online"` does NOT by itself prove a Channel can receive
   * provider traffic unless the provider leg is `attached`: read `detail` when
   * you need to assert that a Channel is genuinely reachable from Slack/Teams,
   * because a `provider` of `unknown` leaves `status` transport-derived.
   */
  status(): {
    overall: ChannelStatus;
    channels: Record<string, ChannelStatus>;
    detail: Record<string, ChannelLegs>;
  };
  /** Tear down every activated Channel. Idempotent. */
  stop(): Promise<void>;
}

interface ChannelRunErrorDetails {
  readonly category: "validation";
  readonly provider: "slack" | "teams";
  readonly operation: string;
  readonly effectKind: string;
  readonly providerCode: "invalid_arguments" | "invalid_blocks";
  readonly validationMessages: readonly string[];
  readonly retryable: false;
  readonly deliveryId: string;
}

/**
 * Signals that a declared Channel cannot be activated because no managed
 * provider exists for it yet. The engine throws this (or any error whose
 * `code === "SETUP_REQUIRED"`) to move a Channel to `setup_required` rather
 * than `error` — a declared-but-unprovisioned Channel is a valid degraded
 * state, not a failure.
 */
export class ChannelSetupRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChannelSetupRequiredError";
  }
}

/**
 * The activation engine: given a resolved {@link ChannelActivationConfig} and
 * the declared {@link Channel}, bring the Channel online and return its handle.
 * Injected in tests (a fake engine); defaults to the Realtime Gateway launcher.
 */
export type ActivateChannelEngine = (
  config: ChannelActivationConfig,
  channel: Channel,
) => Promise<ChannelsHandle>;

/**
 * Minimal structural view of the `@copilotkit/channels-intelligence`
 * `ChannelsHandle`. Declared locally (not imported) because the runtime is a
 * CJS package that must not take a static dependency on the pure-ESM
 * channels-intelligence package — the default engine reaches its launcher
 * through a dynamic `import()` instead. The manager only ever needs `stop()`.
 */
export interface ChannelsHandle {
  /** Activation metadata declared to Intelligence. Unused by the manager. */
  metadata: unknown;
  /** Stop the underlying Channel(s) and release transports. */
  stop(): Promise<void>;
  /**
   * Optional seam: register a callback the handle fires when its managed
   * session drops. Retained as a per-episode drop breadcrumb; the manager drives
   * status from {@link ChannelsHandle.onStateChange} instead. Present on the
   * Realtime Gateway launcher handle; optional for non-gateway/test handles.
   */
  onClose?(cb: () => void): void;
  /**
   * Optional seam: register a connection-health observer the handle fires as its
   * managed session moves between `online` (sendable), `reconnecting` (dropped,
   * Phoenix retrying), and `gave_up` (dead after the bounded reconnect window).
   * The manager uses this to keep {@link ChannelManager.status} honest — it does
   * NOT re-activate on a drop (reconnection is delegated to the Phoenix
   * connection layer; see {@link ChannelManager}). Optional so non-gateway or
   * test handles that do not implement it are always invoked as
   * `handle.onStateChange?.(cb)`.
   */
  onStateChange?(
    cb: (
      state: "online" | "reconnecting" | "gave_up",
      detail?: { reason?: string; code?: string },
    ) => void,
  ): void;
  /**
   * Optional seam: managed provider attachment state per declared Channel, as
   * reported on the newest gateway control join reply.
   *
   * A getter, so each read reflects the current join reply — the gateway's join
   * hooks re-fire on every auto-rejoin, so a Channel provisioned while the
   * runtime was disconnected is picked up without re-activating.
   *
   * `undefined` (or an absent method) means "not reported", NOT "no provider".
   * A gateway predating this contract, a gateway whose database read failed, and
   * a non-gateway/test handle all land here, and all must fall back to
   * transport-only status rather than claim a Channel is unprovisioned.
   */
  providerStates?(): Readonly<Record<string, string>> | undefined;
}

/** Constructor arguments for {@link ChannelManager}. */
export interface ChannelManagerArgs {
  /** The Intelligence runtime client the activation config is derived from. */
  intelligence: CopilotKitIntelligence;
  /** The declared framework Channels to activate. */
  channels: Channel[];
  /** Standard runtime AgentRunner used by managed Channel executions. */
  runner?: AgentRunner;
  /** Selects one stable Learning Container ID for each Channel run. */
  learning?: CopilotRuntimeLearningConfig;
  /** Standard thread-lock TTL forwarded to Channel AgentRunner heartbeats. */
  lockTtlSeconds?: number;
  /** Standard thread-lock heartbeat cadence used by Channel AgentRunner calls. */
  lockHeartbeatIntervalSeconds?: number;
  /** Must match web Intelligence runs so channel + HTTP share the same lock key. */
  lockKeyPrefix?: string;
  /**
   * Activation engine. Defaults to a wrapper over the channels-intelligence
   * Realtime Gateway launcher (`startChannelsOverRealtimeGateway`), reached via
   * dynamic import so this CJS package keeps no static ESM dependency.
   */
  activateChannel?: ActivateChannelEngine;
  /** Mint a runtime instance id per Channel. Defaults to `rti_{uuid-no-dashes}`. */
  mintRuntimeInstanceId?: () => string;
  /** Diagnostic sink. Forwarded to the launcher/transport when the default
   * activation engine is used, so transport-level drops surface in the managed
   * path (not just activation-level events). */
  log?: (msg: string, meta?: unknown) => void;
  /**
   * Initial delay (ms) before a "still down" log while a managed session is
   * disconnected. Later reminders back off exponentially to a 15-minute cap,
   * keeping a prolonged outage visible without flooding logs. Injectable so
   * tests can use a shorter first delay. Default 30000.
   */
  reconnectLogIntervalMs?: number;
  /** Per-handle deadline (ms) for `handle.stop()` during {@link ChannelManager.stop}
   * so a wedged stop can't hang SIGTERM shutdown. Default 5000. */
  stopHandleTimeoutMs?: number;
}

/** Per-Channel mutable activation entry tracked by the manager. */
interface ChannelEntry {
  status: ChannelStatus;
  /** Resolves on `online`/`setup_required`; rejects on `error`. Awaited by `ready`. */
  readonly settled: Promise<void>;
  handle?: ChannelsHandle;
  /**
   * Whether {@link ChannelManager.stopEntry} has already stopped `handle`. Gates
   * the single-stop guarantee: the success settle handler and `stop()` can both
   * reach the same entry in the same tick, but the handle is torn down at most
   * once.
   */
  handleStopped: boolean;
  /** Epoch ms this outage episode began; unset while the session is healthy. */
  downSince?: number;
  /** Cause of THIS outage episode, replayed on each "still down" reminder. */
  downCause?: string;
  /** Next "still down" logger for this outage; cleared on recovery/teardown. */
  reconnectLogTimer?: ReturnType<typeof setTimeout>;
  /** Delay before the next reminder; doubles after each emitted reminder. */
  reconnectLogDelayMs?: number;
  /** Next retry after a transient initial activation failure. */
  activationRetryTimer?: ReturnType<typeof setTimeout>;
  /** Delay before the next activation retry; doubles after each failed attempt. */
  activationRetryDelayMs?: number;
  /** Reject the retry wrapper when teardown cancels a pending retry. */
  cancelActivationRetry?: () => void;
}

/**
 * Runtime installs this pure-ESM package as a direct dependency, but the
 * specifier must stay non-literal so it never becomes a static dependency of
 * the runtime's CJS build. The packed-consumer contract is enforced by
 * `scripts/release/verify-runtime-package.ts`.
 */
const CHANNELS_INTELLIGENCE_SPECIFIER = "@copilotkit/channels-intelligence";

/**
 * Structural view of the `@copilotkit/channels-intelligence` module surface the
 * default engine consumes. Declared locally (not imported) for the same
 * CJS/ESM-boundary reason the {@link ChannelsHandle} view is.
 */
export interface ChannelsIntelligenceModule {
  startChannelsOverRealtimeGateway: (
    channels: Channel[],
    opts: {
      wsUrl: string;
      apiKey: string;
      scope: { projectId: number; channelName: string };
      runtimeInstanceId: string;
      /** Optional per-Channel override for managed tool-call visibility. */
      showToolStatus?: boolean;
      /** Optional per-Channel tuning for continuation messages on long replies. */
      replyContinuation?: ReplyContinuationOptions;
      /** Intelligence app-api HTTP base URL, forwarded to the transport so the
       * managed realtime path enables file/history parity (HTTP-only) — OSS-476. */
      appApiBaseUrl?: string;
      /** Diagnostic sink forwarded to the launcher/transport so transport-level
       * drop diagnostics (e.g. a version-skew missing-leaseToken outage) are not
       * silent in the managed path. */
      log?: (msg: string, meta?: unknown) => void;
      runCanonical(args: {
        agent: AbstractAgent;
        deliveryId: string;
        signal?: AbortSignal;
        threadId: string;
        runId: string;
        userId: string;
        user?: CopilotRuntimeUser | null;
        agentId: string;
        tools: readonly {
          name: string;
          description: string;
          parameters: Record<string, unknown>;
        }[];
        context: readonly { description: string; value: string }[];
        persistedInputMessages: Message[];
        execute(
          subscriber: AgentSubscriber,
          canonicalRun?: { threadId: string; runId: string },
        ): Promise<{
          iterations: number;
          interrupted: boolean;
          deliveryError?: unknown;
        }>;
      }): Promise<{
        iterations: number;
        interrupted: boolean;
        deliveryError?: unknown;
      }>;
      loadHistory(args: {
        deliveryId: string;
        threadId: string;
        appUserId: string;
      }): Promise<Message[]>;
    },
  ) => Promise<ChannelsHandle>;
}

/**
 * Default engine: wrap the channels-intelligence Realtime Gateway launcher.
 *
 * The module is reached through an injectable importer that defaults to a
 * dynamic `import()` of a non-literal specifier, so the pure-ESM
 * `@copilotkit/channels-intelligence` never becomes a static dependency of this
 * CJS package (mirrors the runtime's other channels seams). The `import`
 * seam is a parameter purely so this function's config→opts mapping and its
 * module-not-found / generic-error branches are unit-testable WITHOUT the real
 * package installed; production always uses the default importer.
 *
 * Passes NO `org`/`channelId` — the launcher's realtime scope treats them as
 * optional.
 *
 * @param config - Resolved activation config for the Channel.
 * @param channel - The Channel to activate.
 * @param importChannelsIntelligence - Test seam; loads the channels-intelligence
 *   module. Defaults to a dynamic import of the real package.
 * @param log - Optional diagnostic sink forwarded to the launcher/transport so
 *   transport-level drop diagnostics are not silent in the managed path.
 * @returns The launcher's {@link ChannelsHandle}.
 */
export async function defaultActivateChannel(
  config: ChannelActivationConfig,
  channel: Channel,
  importChannelsIntelligence: () => Promise<ChannelsIntelligenceModule> = () =>
    import(
      CHANNELS_INTELLIGENCE_SPECIFIER
    ) as Promise<ChannelsIntelligenceModule>,
  log?: (msg: string, meta?: unknown) => void,
  services?: {
    runner: AgentRunner;
    intelligence: CopilotKitIntelligence;
    lockTtlSeconds?: number;
    lockHeartbeatIntervalSeconds?: number;
    lockKeyPrefix?: string;
    learning?: CopilotRuntimeLearningConfig;
  },
): Promise<ChannelsHandle> {
  let mod: ChannelsIntelligenceModule;
  try {
    mod = await importChannelsIntelligence();
  } catch (err) {
    if (isModuleNotFound(err)) {
      throw new Error(
        "Managed Channels require '@copilotkit/channels-intelligence' to be installed. Add it to your app's dependencies.",
        { cause: err },
      );
    }
    throw err;
  }
  if (!services) {
    throw new Error(
      "Managed Channels require the runtime AgentRunner and Intelligence client",
    );
  }
  return mod.startChannelsOverRealtimeGateway([channel], {
    wsUrl: config.wsUrl,
    apiKey: config.apiKey,
    scope: { projectId: config.projectId, channelName: config.channelName },
    runtimeInstanceId: config.runtimeInstanceId,
    ...(config.showToolStatus !== undefined
      ? { showToolStatus: config.showToolStatus }
      : {}),
    ...(config.replyContinuation !== undefined
      ? { replyContinuation: config.replyContinuation }
      : {}),
    // Forward the app-api HTTP base URL so the transport wires file/history
    // (HTTP-only) on the NORMAL managed path — without this, Channels started by
    // the CopilotRuntime handler run with no history/file support (OSS-476).
    appApiBaseUrl: config.apiUrl,
    // Forward the manager's diagnostic sink down to the launcher/transport so a
    // transport-level drop (e.g. a version-skew missing-leaseToken outage) is
    // observable in the managed path, not just activation-level events.
    ...(log ? { log } : {}),
    runCanonical: (args) =>
      runCanonicalChannelAgent(
        services.runner,
        services.intelligence,
        services.lockTtlSeconds ?? 20,
        services.lockHeartbeatIntervalSeconds ?? 15,
        args,
        services.lockKeyPrefix,
        services.learning,
      ),
    loadHistory: async ({ deliveryId, threadId, appUserId }) => {
      const history = await services.intelligence.getThreadMessages({
        threadId,
        userId: appUserId,
        channelDeliveryId: deliveryId,
      });
      return Promise.all(
        history.messages.map((message) =>
          toAgentMessage(message, services.intelligence),
        ),
      );
    },
  });
}

interface CanonicalRunArgs {
  agent: AbstractAgent;
  deliveryId: string;
  signal?: AbortSignal;
  threadId: string;
  runId: string;
  userId: string;
  user?: CopilotRuntimeUser | null;
  memory?: ResolvedChannelMemory;
  agentId: string;
  tools: readonly {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }[];
  context: readonly { description: string; value: string }[];
  persistedInputMessages: Message[];
  execute(
    subscriber: AgentSubscriber,
    canonicalRun?: { threadId: string; runId: string },
  ): Promise<{
    iterations: number;
    interrupted: boolean;
    deliveryError?: unknown;
  }>;
}

/** Builds the AG-UI input used to select and execute one Channel run. */
function buildCanonicalChannelRunInput(args: CanonicalRunArgs): RunAgentInput {
  return {
    threadId: args.threadId,
    runId: args.runId,
    messages: args.agent.messages,
    state: args.agent.state,
    tools: [...args.tools],
    context: [...args.context],
    forwardedProps: undefined,
  };
}

/** Attach grant-scoped Intelligence Memory tools to one isolated Channel agent. */
export function attachChannelMemory(
  agent: AbstractAgent,
  intelligence: CopilotKitIntelligence,
  memory: ResolvedChannelMemory | undefined,
): void {
  if (!memory) return;
  const middlewareAgent = agent as AbstractAgent & {
    use?: (middleware: unknown) => void;
  };
  if (typeof middlewareAgent.use !== "function") {
    const error = new Error(
      "Channel Memory requires an agent with middleware support",
    ) as Error & { code?: string };
    error.name = "ChannelMemoryAgentUnsupportedError";
    error.code = "channel_memory_agent_unsupported";
    throw error;
  }
  middlewareAgent.use(
    new MCPMiddleware([
      {
        type: "http",
        url: `${intelligence.ɵgetApiUrl()}/mcp`,
        serverId: "intelligence",
        headers: {
          Authorization: `Bearer ${intelligence.ɵgetApiKey()}`,
          [INTELLIGENCE_MEMORY_GRANT_HEADER]: JSON.stringify(memory.grant),
          ...(memory.user
            ? { [INTELLIGENCE_USER_ID_HEADER]: memory.user.id }
            : {}),
        },
      },
    ]),
  );
}

/** One outer agent that lets the standard runner own the whole local tool loop. */
class ChannelOuterAgent extends AbstractAgent {
  constructor(
    private readonly inner: AbstractAgent,
    private readonly canonicalThreadId: string,
    private readonly executeLoop: CanonicalRunArgs["execute"],
  ) {
    super({
      threadId: inner.threadId,
      initialMessages: inner.messages,
      initialState: inner.state,
      ...(inner.agentId ? { agentId: inner.agentId } : {}),
    });
  }

  run(): ReturnType<AbstractAgent["run"]> {
    return EMPTY;
  }

  override async runAgent(
    parameters?: RunAgentParameters,
    subscriber?: AgentSubscriber,
  ): Promise<RunAgentResult> {
    if (!parameters?.runId) {
      throw new Error("Canonical Channel run requires a runId");
    }
    const result = await this.executeLoop(subscriber ?? {}, {
      threadId: this.canonicalThreadId,
      runId: parameters.runId,
    });
    return { result, newMessages: [] };
  }

  override abortRun(): void {
    this.inner.abortRun();
  }
}

/** Drive one public Channel run through the runtime's existing AgentRunner. */
async function runCanonicalChannelAgent(
  runner: AgentRunner,
  intelligence: CopilotKitIntelligence,
  lockTtlSeconds: number,
  lockHeartbeatIntervalSeconds: number,
  args: CanonicalRunArgs,
  lockKeyPrefix?: string,
  learning?: CopilotRuntimeLearningConfig,
): Promise<{
  iterations: number;
  interrupted: boolean;
  deliveryError?: unknown;
}> {
  const input = buildCanonicalChannelRunInput(args);
  const selector = intelligence.ɵgetLearningContainerId?.();
  const learningContainerId = selector
    ? await resolveLearningContainerSelector(selector, {
        surface: "channel",
        user: args.user ?? null,
        agentId: args.agentId,
        input,
      })
    : await resolveLearningContainerId(learning, {
        surface: "channel",
        threadId: args.threadId,
        runId: args.runId,
        agentId: args.agentId,
        userId: args.userId,
        deliveryId: args.deliveryId,
      });
  const lock = await intelligence.ɵacquireThreadLock({
    threadId: args.threadId,
    runId: args.runId,
    userId: args.userId,
    agentId: args.agentId,
    channelDeliveryId: args.deliveryId,
    ...(learningContainerId !== undefined ? { learningContainerId } : {}),
    ttlSeconds: lockTtlSeconds,
    ...(lockKeyPrefix !== undefined ? { lockKeyPrefix } : {}),
  });
  const canonicalThreadId = lock.threadId;
  const canonicalRunId = lock.runId;
  let result = { iterations: 0, interrupted: false };
  attachChannelMemory(args.agent, intelligence, args.memory);
  const outer = new ChannelOuterAgent(
    args.agent,
    canonicalThreadId,
    async (subscriber, canonicalRun) => {
      result = await args.execute(subscriber, canonicalRun);
      return result;
    },
  );
  let stopPromise: Promise<boolean | undefined> | undefined;
  let heartbeatError: unknown;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  const stopCanonicalRun = (): void => {
    stopPromise ??= Promise.resolve()
      .then(() =>
        runner.stop({
          threadId: canonicalThreadId,
          runId: canonicalRunId,
        }),
      )
      .catch(() => false);
  };
  const abortCanonicalRun = (): void => {
    try {
      args.agent.abortRun();
    } catch {
      // The exact runner stop remains the authoritative cancellation path.
    }
    stopCanonicalRun();
  };
  args.signal?.addEventListener("abort", abortCanonicalRun, { once: true });
  heartbeatTimer = setInterval(() => {
    intelligence
      .ɵrenewThreadLock({
        threadId: canonicalThreadId,
        runId: canonicalRunId,
        ttlSeconds: lockTtlSeconds,
        ...(lockKeyPrefix !== undefined ? { lockKeyPrefix } : {}),
      })
      .catch((error: unknown) => {
        if (heartbeatTimer === undefined) return;
        clearInterval(heartbeatTimer);
        heartbeatTimer = undefined;
        heartbeatError = error;
        try {
          args.agent.abortRun();
        } catch {
          // The runner stop below remains the authoritative cancellation path.
        }
        stopCanonicalRun();
      });
  }, lockHeartbeatIntervalSeconds * 1_000);
  heartbeatTimer.unref?.();

  try {
    await new Promise<void>((resolve, reject) => {
      let terminalError:
        | (Error & {
            code?: string;
            category?: string;
            provider?: string;
            operation?: string;
            effectKind?: string;
            providerCode?: string;
            validationMessages?: readonly string[];
            retryable?: boolean;
            deliveryId?: string;
            details?: unknown;
          })
        | undefined;
      const stream = runner.run({
        threadId: canonicalThreadId,
        agent: outer,
        input: {
          ...input,
          threadId: canonicalThreadId,
          runId: canonicalRunId,
        },
        persistedInputMessages: args.persistedInputMessages,
      });
      stream.subscribe({
        next: (event: BaseEvent) => {
          if (event.type !== EventType.RUN_ERROR || terminalError) return;
          const message =
            "message" in event && typeof event.message === "string"
              ? event.message
              : "Canonical Channel agent run failed";
          const details = safeChannelRunErrorDetails(event);
          terminalError = new Error(
            message,
            details ? { cause: details } : undefined,
          );
          terminalError.name = "ChannelCanonicalRunError";
          if (
            "code" in event &&
            typeof event.code === "string" &&
            event.code.length > 0
          ) {
            terminalError.code = event.code;
          }
          if (details) {
            terminalError.category = details.category;
            terminalError.provider = details.provider;
            terminalError.operation = details.operation;
            terminalError.effectKind = details.effectKind;
            terminalError.providerCode = details.providerCode;
            terminalError.validationMessages = details.validationMessages;
            terminalError.retryable = details.retryable;
            terminalError.deliveryId = details.deliveryId;
            terminalError.details = details;
          }
        },
        error: reject,
        complete: () => {
          if (terminalError) {
            reject(terminalError);
          } else {
            resolve();
          }
        },
      });
      if (args.signal?.aborted) {
        abortCanonicalRun();
      }
    });
  } finally {
    args.signal?.removeEventListener("abort", abortCanonicalRun);
    if (heartbeatTimer !== undefined) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    }
    // Always release the product thread lock from the Runtime side. Gateway
    // may also release on terminal AG-UI ingestion; cleanup is idempotent and
    // covers runner paths that never stream terminal events (or lose them).
    await intelligence
      .ɵcleanupThreadLock({
        threadId: canonicalThreadId,
        runId: canonicalRunId,
      })
      .catch(() => undefined);
  }

  if (heartbeatError !== undefined) {
    await stopPromise;
    throw heartbeatError;
  }
  return result;
}

function safeChannelRunErrorDetails(
  event: BaseEvent,
): ChannelRunErrorDetails | undefined {
  if (
    !("details" in event) ||
    typeof event.details !== "object" ||
    event.details === null ||
    Array.isArray(event.details)
  ) {
    return undefined;
  }
  const details = event.details as Record<string, unknown>;
  const allowed = new Set([
    "category",
    "provider",
    "operation",
    "effectKind",
    "providerCode",
    "validationMessages",
    "retryable",
    "deliveryId",
  ]);
  if (
    !Object.keys(details).every((field) => allowed.has(field)) ||
    details.category !== "validation" ||
    (details.provider !== "slack" && details.provider !== "teams") ||
    !boundedString(details.operation, 80) ||
    !boundedString(details.effectKind, 80) ||
    (details.providerCode !== "invalid_arguments" &&
      details.providerCode !== "invalid_blocks") ||
    details.retryable !== false ||
    !boundedString(details.deliveryId, 512) ||
    !Array.isArray(details.validationMessages) ||
    details.validationMessages.length > 5 ||
    !details.validationMessages.every(
      (validationMessage) =>
        typeof validationMessage === "string" &&
        validationMessage.length <= 256 &&
        validationMessage.startsWith("invalid field at /"),
    )
  ) {
    return undefined;
  }
  return details as unknown as ChannelRunErrorDetails;
}

function boundedString(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= maxLength
  );
}

/** Convert canonical Intelligence history into AG-UI messages. */
async function toAgentMessage(
  message: {
    id: string;
    role: string;
    activityType?: string;
    content?: unknown;
    toolCalls?: Array<{ id: string; name: string; args: string }>;
    toolCallId?: string;
  },
  intelligence: CopilotKitIntelligence,
): Promise<Message> {
  const content = await hydrateManagedContent(message.content, intelligence);
  return {
    id: message.id,
    role: message.role as Message["role"],
    content: content ?? "",
    ...(message.activityType ? { activityType: message.activityType } : {}),
    ...(message.toolCalls
      ? {
          toolCalls: message.toolCalls.map((call) => ({
            id: call.id,
            type: "function" as const,
            function: { name: call.name, arguments: call.args },
          })),
        }
      : {}),
    ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
  } as Message;
}

/** Resolves managed asset references only at the authorized Runtime boundary. */
async function hydrateManagedContent(
  content: unknown,
  intelligence: CopilotKitIntelligence,
): Promise<unknown> {
  if (Array.isArray(content)) {
    return Promise.all(
      content.map(async (part) => {
        if (
          typeof part !== "object" ||
          part === null ||
          !("source" in part) ||
          typeof part.source !== "object" ||
          part.source === null ||
          !("value" in part.source) ||
          typeof part.source.value !== "string" ||
          !part.source.value.startsWith("cpki-asset://")
        ) {
          return part;
        }
        const assetId = part.source.value.slice("cpki-asset://".length);
        const asset = await intelligence.ɵgetManagedChannelAsset(assetId);
        return {
          ...part,
          source: {
            type: "data",
            value: Buffer.from(asset.bytes).toString("base64"),
            mimeType:
              asset.mimeType ??
              ("mimeType" in part.source &&
              typeof part.source.mimeType === "string"
                ? part.source.mimeType
                : "application/octet-stream"),
          },
        };
      }),
    );
  }

  if (
    typeof content === "object" &&
    content !== null &&
    "assetId" in content &&
    typeof content.assetId === "string"
  ) {
    const asset = await intelligence.ɵgetManagedChannelAsset(content.assetId);
    return {
      ...content,
      source: {
        type: "data",
        value: Buffer.from(asset.bytes).toString("base64"),
        mimeType:
          asset.mimeType ??
          ("mimeType" in content && typeof content.mimeType === "string"
            ? content.mimeType
            : "application/octet-stream"),
      },
    };
  }

  return content;
}

/** Whether `err` signals a missing managed provider rather than a hard failure. */
function isSetupRequired(err: unknown): boolean {
  return (
    err instanceof ChannelSetupRequiredError ||
    (typeof err === "object" &&
      err !== null &&
      (err as { code?: unknown }).code === "SETUP_REQUIRED")
  );
}

/** Whether a failed initial activation can recover without new configuration. */
function isRetryableActivationError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) {
    return false;
  }
  const value = err as { code?: unknown; retryable?: unknown };
  return (
    (value.code === "GATEWAY_UNREACHABLE" ||
      value.code === "GATEWAY_JOIN_FAILED") &&
    value.retryable === true
  );
}

/**
 * Whether `err` is a Node/runtime module-resolution failure — i.e. the error
 * a dynamic `import()` throws when the target package is not installed.
 * Exported so the friendly-error path in {@link defaultActivateChannel} can be
 * unit-tested without forcing a real failing import.
 */
export function isModuleNotFound(err: unknown): boolean {
  if (typeof err !== "object" || err === null) {
    return false;
  }
  const code = (err as { code?: unknown }).code;
  return code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND";
}

/** Default deadline (ms) for a single `handle.stop()` during teardown. */
const DEFAULT_STOP_HANDLE_TIMEOUT_MS = 5_000;

/** First delay (ms) before logging that a dropped session is still down. */
const DEFAULT_RECONNECT_LOG_INTERVAL_MS = 30_000;

/** Longest delay (ms) between reminders during one continuous outage. */
const DEFAULT_RECONNECT_LOG_MAX_INTERVAL_MS = 15 * 60_000;

/** First delay (ms) before retrying a transient initial activation failure. */
const DEFAULT_ACTIVATION_RETRY_DELAY_MS = 1_000;

/** Longest delay (ms) between transient initial activation attempts. */
const DEFAULT_ACTIVATION_RETRY_MAX_DELAY_MS = 30_000;

/**
 * Reject with `timeoutMessage` after `timeoutMs` if `inner` has not settled,
 * otherwise pass `inner` through. When `timeoutMs` is undefined, `inner` is
 * returned unchanged. The timer is `unref`'d so a pending deadline never keeps
 * the process alive, and `inner` always has a settle handler attached, so a
 * timed-out promise that later settles never surfaces as unhandled.
 */
function withTimeout<T>(
  inner: Promise<T>,
  timeoutMs: number | undefined,
  timeoutMessage: string,
): Promise<T> {
  if (timeoutMs === undefined) {
    return inner;
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(timeoutMessage)),
      timeoutMs,
    );
    (timer as unknown as { unref?: () => void }).unref?.();
    inner.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Drives Channel activation for an Intelligence runtime: lazily activates each
 * declared Channel through the managed engine, tracks per-Channel lifecycle
 * status, exposes readiness, and tears everything down. Existing direct
 * adapters remain on the Channel; the launcher attaches the one managed
 * adapter before starting the combined adapter array.
 *
 * Activation is lazy and idempotent — constructing the manager does nothing;
 * {@link activate} starts it and a second call is a no-op. Activation throws
 * SYNCHRONOUSLY (a {@link ChannelConfigError}) only for a misconfiguration it
 * can detect up front — a duplicate or missing Channel name. Every OTHER
 * permanent activation failure is recorded as the Channel's status (`error`,
 * or `setup_required` for a missing provider) and surfaced through
 * {@link status} and {@link ready} rather than thrown. A retryable initial
 * gateway outage stays unsettled and retries until it connects or the manager
 * stops.
 *
 * Established-session reconnection is delegated to the Phoenix connection
 * layer that backs the launcher. When a managed control socket drops, Phoenix's
 * `Socket` reconnects and rejoins with the same Runtime declaration. The manager
 * never re-activates an already-started Channel. It does retry a transient
 * INITIAL gateway activation failure: that happens before the launcher adds or
 * starts the managed adapter, so a later attempt is safe.
 *
 * It DOES, however, reflect real connection health through the session's
 * `onStateChange` observer so {@link ChannelManager.status} stays honest rather
 * than reporting `online` forever after a drop: a drop moves the Channel to
 * `reconnecting`, a successful rejoin restores `online`, and a bounded give-up
 * (Phoenix would otherwise retry forever) moves it to `error`.
 */
export class ChannelManager implements ChannelsControl {
  private readonly intelligence: CopilotKitIntelligence;
  private readonly runner?: AgentRunner;
  private readonly learning?: CopilotRuntimeLearningConfig;
  private readonly lockTtlSeconds: number;
  private readonly lockHeartbeatIntervalSeconds: number;
  private readonly lockKeyPrefix?: string;
  private readonly channels: Channel[];
  private readonly activateChannel: ActivateChannelEngine;
  private readonly mintRuntimeInstanceId: () => string;
  private readonly log?: (msg: string, meta?: unknown) => void;
  private readonly stopHandleTimeoutMs: number;
  private readonly reconnectLogIntervalMs: number;

  private readonly entries = new Map<string, ChannelEntry>();
  private activated = false;
  private stopped = false;

  /** @param args - See {@link ChannelManagerArgs}. */
  constructor(args: ChannelManagerArgs) {
    this.intelligence = args.intelligence;
    this.runner = args.runner;
    this.learning = args.learning;
    this.lockTtlSeconds = args.lockTtlSeconds ?? 20;
    this.lockHeartbeatIntervalSeconds = args.lockHeartbeatIntervalSeconds ?? 15;
    this.lockKeyPrefix = args.lockKeyPrefix;
    this.channels = args.channels;
    this.log = args.log;
    // When using the default engine, forward the manager's log DOWN to the
    // launcher/transport (via defaultActivateChannel's log param) so a
    // transport-level drop is observable in the managed path. `this.log` is read
    // lazily at activation time, so this closure always sees the assigned sink.
    this.activateChannel =
      args.activateChannel ??
      ((config, channel) =>
        defaultActivateChannel(
          config,
          channel,
          undefined,
          this.log,
          this.runner
            ? {
                runner: this.runner,
                intelligence: this.intelligence,
                ...(this.learning !== undefined
                  ? { learning: this.learning }
                  : {}),
                lockTtlSeconds: this.lockTtlSeconds,
                lockHeartbeatIntervalSeconds: this.lockHeartbeatIntervalSeconds,
                ...(this.lockKeyPrefix !== undefined
                  ? { lockKeyPrefix: this.lockKeyPrefix }
                  : {}),
              }
            : undefined,
        ));
    this.mintRuntimeInstanceId =
      args.mintRuntimeInstanceId ??
      (() => `rti_${randomUUID().replace(/-/g, "")}`);
    this.stopHandleTimeoutMs =
      args.stopHandleTimeoutMs ?? DEFAULT_STOP_HANDLE_TIMEOUT_MS;
    this.reconnectLogIntervalMs =
      args.reconnectLogIntervalMs ?? DEFAULT_RECONNECT_LOG_INTERVAL_MS;
  }

  /**
   * Start activation of every declared Channel (lazy + idempotent). Mints a
   * distinct runtime instance id per Channel, derives its activation config,
   * and calls the engine. Transient gateway failures retry with exponential
   * backoff; other outcomes transition to `online`/`setup_required`/`error`.
   */
  activate(): void {
    // Short-circuit on BOTH latches: `activated` makes activation idempotent,
    // and `stopped` prevents a post-`stop()` activate() from opening transports
    // on a dead manager. (A late activation self-heals via the post-settle guard,
    // but never starting it is cheaper and clearer.)
    if (this.activated || this.stopped) {
      return;
    }
    // Reject duplicate Channel names BEFORE kicking off any engine call. The
    // manager keys `entries` by name, so a duplicate would let the second
    // activation's entry silently overwrite the first — leaking the first
    // Channel's control link out of status()/ready()/stop(). Fail loud here so
    // nothing is ever activated in that state.
    this.assertUniqueChannelNames();
    this.activated = true;

    // Every declared Channel gets the managed adapter. Any developer-supplied
    // direct adapters stay in the same adapter array and are started by the
    // launcher's single `channel.ɵruntime.start()` call.
    for (const channel of this.channels) {
      channel.ɵruntime.enableIntelligenceMemory();
      const name = channel.name!;
      const runtimeInstanceId = this.mintRuntimeInstanceId();

      let resolveSettled!: () => void;
      let rejectSettled!: (err: unknown) => void;
      const settled = new Promise<void>((resolve, reject) => {
        resolveSettled = resolve;
        rejectSettled = reject;
      });
      // ready() awaits `settled`; if nothing ever handles a rejection there,
      // Node reports an unhandled rejection. Attach a no-op catch so the
      // promise is always considered handled — ready() still sees the reason.
      settled.catch(() => {});

      // The deferred activation callbacks capture `entry` and run only after
      // the literal has fully initialized, so referencing it there is safe.
      const entry: ChannelEntry = {
        status: "connecting",
        handle: undefined,
        handleStopped: false,
        settled,
      };

      // Invoke the engine synchronously so activation is observably started the
      // moment activate() returns. Only a typed transient gateway failure is
      // retried; config errors stay on the existing terminal path.
      let activation: Promise<ChannelsHandle>;
      try {
        const config = deriveChannelActivationConfig({
          intelligence: this.intelligence,
          channel,
          runtimeInstanceId,
        });
        activation = this.activateWithRetry(config, channel, name, entry);
      } catch (err) {
        activation = Promise.reject(err);
      }

      // Anchor the settle handlers. Both branches route every teardown through
      // the idempotent `stopEntry`, so a late settle can never resurrect a
      // `stopped` entry and a handle is torn down at most once. The handlers
      // only mutate state (never throw), so the trailing no-op catch just keeps
      // the chain from surfacing as an unhandled rejection.
      activation
        .then(
          async (handle) => {
            entry.handle = handle;
            if (this.stopped) {
              // stop() ran before this activation settled, so it could not tear
              // down a handle that did not exist yet. Release it now (idempotent)
              // and keep the Channel `stopped`.
              await this.stopEntry(entry);
              resolveSettled();
              return;
            }
            entry.status = "online";
            this.registerConnectionObserver(name, entry);
            resolveSettled();
          },
          async (err: unknown) => {
            if (this.stopped) {
              // A rejection that arrives AFTER stop() must NOT resurrect the
              // entry into `error`/`setup_required`: the Channel is already
              // being torn down. Keep it `stopped` and resolve `settled` so a
              // subsequent ready() does not reject on a stopped Channel.
              await this.stopEntry(entry);
              resolveSettled();
              return;
            }
            if (isSetupRequired(err)) {
              const hasDirectAdapter = channel.adapters.some(
                (adapter) => !adapter.__intelligenceChannel,
              );
              if (hasDirectAdapter) {
                try {
                  // Managed setup may be incomplete while a developer-owned
                  // transport is fully configured. Keep that transport alive;
                  // a later runtime restart can attach the managed adapter once
                  // Intelligence setup is complete.
                  await channel.ɵruntime.start();
                  entry.handle = {
                    metadata: {},
                    stop: () => channel.ɵruntime.stop(),
                  };
                  if (this.stopped) {
                    await this.stopEntry(entry);
                    resolveSettled();
                    return;
                  }
                } catch (directError) {
                  if (this.stopped) {
                    await this.stopEntry(entry);
                    resolveSettled();
                    return;
                  }
                  entry.status = "error";
                  this.log?.(
                    `channel "${name}" failed to start its direct adapters while managed setup is incomplete`,
                    directError,
                  );
                  rejectSettled(directError);
                  return;
                }
              }
              entry.status = "setup_required";
              this.log?.(`channel "${name}" requires setup`, err);
              resolveSettled();
            } else {
              entry.status = "error";
              this.log?.(`channel "${name}" failed to activate`, err);
              rejectSettled(err);
            }
          },
        )
        .catch(() => {});

      this.entries.set(name, entry);
    }
  }

  /**
   * Retry only transient failures from the pre-adapter gateway connection.
   * Permanent errors reject on the first attempt; teardown cancels a pending
   * timer while preserving the existing late-settle handling for in-flight work.
   */
  private activateWithRetry(
    config: ChannelActivationConfig,
    channel: Channel,
    name: string,
    entry: ChannelEntry,
  ): Promise<ChannelsHandle> {
    return new Promise<ChannelsHandle>((resolve, reject) => {
      const attempt = (): void => {
        let activation: Promise<ChannelsHandle>;
        try {
          activation = this.activateChannel(config, channel);
        } catch (err) {
          activation = Promise.reject(err);
        }
        activation.then(
          (handle) => {
            this.clearActivationRetry(entry);
            resolve(handle);
          },
          (err: unknown) => {
            if (this.stopped || !isRetryableActivationError(err)) {
              this.clearActivationRetry(entry);
              reject(err);
              return;
            }

            const delayMs =
              entry.activationRetryDelayMs ?? DEFAULT_ACTIVATION_RETRY_DELAY_MS;
            entry.status = "reconnecting";
            entry.activationRetryDelayMs = Math.min(
              delayMs * 2,
              DEFAULT_ACTIVATION_RETRY_MAX_DELAY_MS,
            );
            this.log?.(
              `channel "${name}" failed to activate; retrying in ${delayMs}ms`,
              err,
            );
            const timer = setTimeout(() => {
              entry.activationRetryTimer = undefined;
              entry.cancelActivationRetry = undefined;
              if (this.stopped || entry.status === "stopped") {
                reject(err);
                return;
              }
              entry.status = "connecting";
              attempt();
            }, delayMs);
            (timer as unknown as { unref?: () => void }).unref?.();
            entry.activationRetryTimer = timer;
            entry.cancelActivationRetry = () => {
              this.clearActivationRetry(entry);
              reject(err);
            };
          },
        );
      };

      attempt();
    });
  }

  /**
   * Throw if two declared Channels share a `name`. `entries` is keyed by name,
   * so a duplicate would overwrite the first Channel's entry and leak its live
   * session. Called at the very start of {@link activate}, before any engine
   * call, so a misconfiguration fails loud instead of silently.
   *
   * @throws {ChannelConfigError} If any Channel is missing a name, or if any
   *   name appears more than once.
   */
  private assertUniqueChannelNames(): void {
    const seen = new Set<string>();
    for (const channel of this.channels) {
      const name = channel.name;
      // Check for a missing/empty name FIRST: `channel.name!` on a nameless
      // Channel keys as the string "undefined", which would otherwise report a
      // spurious duplicate for two nameless Channels before the accurate
      // missing-name error. Fail with the precise error instead.
      if (!name) {
        throw new ChannelConfigError(
          "A managed Channel is missing a `name` — every declared Channel must " +
            "have a unique, non-empty name (pass createChannel({ name })).",
        );
      }
      if (seen.has(name)) {
        throw new ChannelConfigError(
          `Duplicate managed Channel name "${name}" — every declared Channel ` +
            `must have a unique name.`,
        );
      }
      seen.add(name);
    }
  }

  /**
   * Resolve when every declared Channel has settled to
   * `online`/`setup_required` through its managed activation.
   *
   * Activates lazily if not already started — so a first call rejects with the
   * same {@link ChannelConfigError} as the synchronous throw from
   * {@link activate} for an up-front misconfiguration (duplicate/missing Channel
   * names). Once activation has been kicked off, all OTHER failures are surfaced
   * here instead: this rejects with an `AggregateError` if any Channel settled
   * to `error` OR — when `timeoutMs` is given — did not settle in time. The
   * `timeoutMs` deadline is applied PER CHANNEL, so the aggregate carries each
   * failed Channel's real reason AND a named timeout for each Channel still
   * hanging: a genuine activation error is never masked by a sibling that hangs
   * (a pre-fix set-wide timeout discarded the real reason in that case).
   *
   * A STOPPED manager short-circuits and resolves: a Channel that settled to
   * `error` BEFORE {@link stop} already rejected its `settled` promise, so
   * awaiting it here would throw an `AggregateError` even though
   * {@link status}.overall is `"stopped"` — inconsistent with the case where the
   * Channel was still online at stop() (which resolves). A stopped manager has
   * nothing left to be ready for, so resolve uniformly.
   *
   * `ready()` is ONE-SHOT: it settles on the INITIAL activation outcome. Later
   * connection-health transitions (a live Channel dropping to `reconnecting`, or
   * giving up to `error`) are reported through {@link status} — where `online`
   * means currently-sendable — but do NOT re-arm or re-reject an already-settled
   * `ready()`.
   */
  async ready(opts?: { timeoutMs?: number }): Promise<void> {
    if (this.stopped) {
      return;
    }
    this.activate();
    const entries = [...this.entries.entries()];
    // Apply `timeoutMs` PER CHANNEL rather than to the whole set. A single
    // set-wide timeout wrapping `allSettled` would, when one channel settles to
    // `error` while a sibling hangs, reject with only a generic timeout and
    // DISCARD the erroring channel's real reason. Timing out each channel's
    // `settled` independently lets `allSettled` collect BOTH a hung channel's
    // named timeout AND a failed channel's real error into one AggregateError.
    const results = await Promise.allSettled(
      entries.map(([name, e]) =>
        withTimeout(
          e.settled,
          opts?.timeoutMs,
          `channel "${name}" did not settle within ${opts?.timeoutMs}ms`,
        ),
      ),
    );
    const errors = results
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map((r) => r.reason);
    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        `ChannelManager.ready: ${errors.length} channel(s) failed to activate or settle in time`,
      );
    }
  }

  /**
   * Snapshot status. Every declared Channel appears keyed by name in
   * `channels` after its combined adapter lifecycle starts.
   *
   * Each Channel's entry is the fold of its transport and provider legs (see
   * {@link foldChannelLegs}), and `detail` reports those legs separately so a
   * caller can assert the one it cares about.
   *
   * `overall` is folded over ALL declared Channels (see {@link computeOverall}),
   * by precedence `error` > `reconnecting` > `setup_required` > `connecting` >
   * `online`. `online` means every Channel can currently send AND none was
   * reported as missing its managed provider. `reconnecting` outranks
   * `setup_required` because a dropped-but-retrying Channel is an active outage,
   * louder than a steadily-degraded unprovisioned one. With no declared Channels
   * at all, `overall` is `online` (nothing is degraded); once every Channel has
   * been stopped, `overall` is `stopped`.
   *
   * `overall === "online"` is only end-to-end proof when every Channel's
   * `provider` leg is `attached`. A gateway that reports no provider state leaves
   * the legs `unknown` and `overall` transport-derived, exactly as before this
   * contract existed — so a caller that must be certain checks `detail`.
   */
  status(): {
    overall: ChannelStatus;
    channels: Record<string, ChannelStatus>;
    detail: Record<string, ChannelLegs>;
  } {
    const channels: Record<string, ChannelStatus> = {};
    const detail: Record<string, ChannelLegs> = {};
    for (const [name, entry] of this.entries) {
      // KNOWN LIMITATION, dead today: the legacy `ChannelSetupRequiredError` /
      // `code === "SETUP_REQUIRED"` path writes `setup_required` into
      // `entry.status`, which is reported verbatim as the transport leg — so such
      // a Channel reads `transport: "setup_required", provider: "unknown"`, a
      // provider condition parked on the transport leg. Nothing emits it (the
      // activation engine stopped throwing it at the 2026-07-29
      // realtime-boundary cutover) and the folded `status` is right either way,
      // so this is cosmetic. A future producer should report provider attachment
      // through the `providerStates` seam rather than `entry.status`.
      const transport = entry.status;
      const provider = this.providerLeg(name, entry);
      const status = foldChannelLegs(transport, provider);
      channels[name] = status;
      detail[name] = { status, transport, provider };
    }
    // A stopped manager is `stopped` regardless of whether it was ever activated.
    // stop() before activate() (e.g. SIGTERM during startup) leaves `entries`
    // empty, and the empty-set fold below returns `online` — a torn-down manager
    // must never read healthy. Short-circuit before that fold. (After a normal
    // activate→stop, every entry is already `stopped` and the fold agrees, so
    // this is also consistent with the populated case.)
    if (this.stopped) {
      return { overall: "stopped", channels, detail };
    }
    // Before activate() has run, `entries` is empty. Folding an empty set gives
    // `online` — correct for a manager that declares NO channels (nothing is
    // degraded), but a LIE for one that declares channels and simply has not
    // opened its socket yet: activation is lazy (deferred to the first
    // `ready()`), so a not-yet-activated manager must never read `online`.
    // Report `connecting` ("not started") for that case so `status()` is honest
    // before any `ready()`.
    if (!this.activated && this.channels.length > 0) {
      return { overall: "connecting", channels, detail };
    }
    return {
      overall: this.computeOverall(Object.values(channels)),
      channels,
      detail,
    };
  }

  /**
   * Read one Channel's provider leg from its handle.
   *
   * Defensive on every axis, because a wrong answer here silently changes what
   * `status()` certifies: a handle without the seam, a gateway that reported
   * nothing, a name the gateway did not mention, an unrecognised value, or a
   * throwing getter all yield `unknown` — which {@link foldChannelLegs} treats as
   * "keep the transport-derived status", i.e. pre-provider-state behaviour.
   *
   * @param name - The Channel name (map key).
   * @param entry - The Channel's activation entry.
   * @returns The provider leg, or `"unknown"` when it cannot be established.
   */
  private providerLeg(name: string, entry: ChannelEntry): ChannelProviderLeg {
    let states: Readonly<Record<string, string>> | undefined;
    try {
      states = entry.handle?.providerStates?.();
    } catch {
      // A misbehaving handle must never break a status snapshot.
      return "unknown";
    }
    const reported = states?.[name];
    return reported !== undefined && PROVIDER_LEGS.has(reported)
      ? (reported as ChannelProviderLeg)
      : "unknown";
  }

  /**
   * Fold per-Channel statuses into a single overall status (see {@link status}).
   *
   * Every declared Channel participates. Statuses are ranked
   * `error` > `reconnecting` > `setup_required` > `connecting` > `online`, so a
   * genuine failure still dominates a healthy sibling.
   * The empty-input case (no declared Channels at all) stays `online` (nothing is
   * degraded).
   */
  private computeOverall(values: ChannelStatus[]): ChannelStatus {
    if (values.length === 0) {
      return "online";
    }
    if (values.every((v) => v === "stopped")) {
      return "stopped";
    }
    if (values.includes("error")) {
      return "error";
    }
    if (values.includes("reconnecting")) {
      return "reconnecting";
    }
    if (values.includes("setup_required")) {
      return "setup_required";
    }
    if (values.includes("connecting")) {
      return "connecting";
    }
    return "online";
  }

  /**
   * Wire the Channel's connection-health observer (if the handle exposes the
   * optional `onStateChange` seam) so {@link ChannelManager.status} reflects real
   * health instead of reporting `online` forever after a drop:
   *
   * - `reconnecting` → status `reconnecting` (dropped, Phoenix retrying);
   * - `online` → status `online` (rejoined, sendable again);
   * - `gave_up` → status `error` (dead after the bounded reconnect window).
   *
   * Makes NO re-activation — reconnection is delegated to the Phoenix connection
   * layer (see {@link ChannelManager}), which auto-rejoins under the persistent
   * adapter. A STOPPED manager (or an already-stopped entry) ignores late
   * connection events, so a drop that fires after {@link ChannelManager.stop}
   * never resurrects the Channel out of `stopped`.
   *
   * @param name - The Channel name (map key).
   * @param entry - The Channel's activation entry.
   */
  private registerConnectionObserver(name: string, entry: ChannelEntry): void {
    entry.handle?.onStateChange?.((state, detail) => {
      // A stopped manager (or a stopped entry) ignores late connection events.
      if (this.stopped || entry.status === "stopped") {
        return;
      }
      const cause = detail?.reason ?? detail?.code;
      const because = cause !== undefined ? ` — ${cause}` : "";
      if (state === "reconnecting") {
        entry.status = "reconnecting";
        entry.downSince ??= Date.now();
        // Remembered for the repeat line below: an operator reading a reminder
        // hours into an outage should not have to find the first line to learn
        // the cause.
        if (cause !== undefined) entry.downCause = cause;
        this.log?.(
          `channel "${name}" managed session dropped; reconnecting (Phoenix auto-rejoin)${because}`,
        );
        this.captureChannelTelemetry("oss.runtime.channel_session_dropped", {
          ...(detail?.reason !== undefined ? { reason: detail.reason } : {}),
          ...(detail?.code !== undefined ? { code: detail.code } : {}),
        });
        this.startReconnectLog(name, entry);
      } else if (state === "online") {
        entry.status = "online";
        this.clearReconnectLog(entry);
        // Read BEFORE clearing `downSince`, and only when an outage was
        // actually in progress — a session may report `online` with no
        // preceding drop, which is not a recovery.
        const downSince = entry.downSince;
        entry.downSince = undefined;
        entry.downCause = undefined;
        this.log?.(`channel "${name}" managed session back online`);
        if (downSince !== undefined) {
          this.captureChannelTelemetry(
            "oss.runtime.channel_session_recovered",
            { downForMs: Date.now() - downSince },
          );
        }
      } else if (state === "gave_up") {
        // `error` here means "not sendable", NOT "dead": Phoenix keeps retrying
        // underneath and a successful rejoin restores `online`. Say so, or the
        // line reads as terminal (OSS-670). The repeat keeps running.
        entry.status = "error";
        this.log?.(
          `channel "${name}" managed session gave up reconnecting after ${this.downFor(entry)}; ` +
            `marking error (still retrying — a successful rejoin restores online)${because}`,
        );
      }
    });
  }

  /**
   * Report a Channel connection event. A managed session that drops is
   * otherwise invisible outside the host process — the `log` seam reaches only
   * whoever reads that process's stdout, which for a self-hosted runtime is
   * nobody who can act on it.
   *
   * Fire-and-forget, and failures are swallowed: telemetry must never break a
   * live session. Same contract as `fireInstanceCreatedTelemetry`. The `try`
   * also covers a `capture` that throws synchronously or returns no promise.
   */
  private captureChannelTelemetry<
    K extends
      | "oss.runtime.channel_session_dropped"
      | "oss.runtime.channel_session_recovered",
  >(event: K, props: AnalyticsEvents[K]): void {
    try {
      void telemetry.capture(event, props).catch(() => {});
    } catch {
      // Swallow — a telemetry transport must not take the session with it.
    }
  }

  /** Rendered downtime for this outage episode (`"45s"`), or `"unknown"`. */
  private downFor(entry: ChannelEntry): string {
    return entry.downSince === undefined
      ? "unknown"
      : `${Math.round((Date.now() - entry.downSince) / 1000)}s`;
  }

  /**
   * Repeat a "still down" line for as long as this outage lasts, with an
   * exponential delay capped at 15 minutes. Runs THROUGH `gave_up` on purpose:
   * that transition is where the old behavior went quiet, and an operator
   * watching a silent process cannot tell a dead bot from an idle one.
   */
  private startReconnectLog(name: string, entry: ChannelEntry): void {
    if (entry.reconnectLogTimer !== undefined) return;

    const delayMs = entry.reconnectLogDelayMs ?? this.reconnectLogIntervalMs;
    const timer = setTimeout(() => {
      entry.reconnectLogTimer = undefined;
      if (this.stopped || entry.status === "stopped") {
        this.clearReconnectLog(entry);
        return;
      }
      this.log?.(
        `channel "${name}" managed session still down after ${this.downFor(entry)}; Phoenix is retrying` +
          (entry.downCause !== undefined ? ` — ${entry.downCause}` : ""),
      );
      entry.reconnectLogDelayMs = Math.min(
        delayMs * 2,
        Math.max(
          this.reconnectLogIntervalMs,
          DEFAULT_RECONNECT_LOG_MAX_INTERVAL_MS,
        ),
      );
      this.startReconnectLog(name, entry);
    }, delayMs);
    (timer as unknown as { unref?: () => void }).unref?.();
    entry.reconnectLogTimer = timer;
  }

  /** Stop this entry's "still down" repeat, if one is running. */
  private clearReconnectLog(entry: ChannelEntry): void {
    if (entry.reconnectLogTimer !== undefined) {
      clearTimeout(entry.reconnectLogTimer);
      entry.reconnectLogTimer = undefined;
    }
    entry.reconnectLogDelayMs = undefined;
  }

  /** Cancel a pending transient activation retry and reset its backoff. */
  private clearActivationRetry(entry: ChannelEntry): void {
    if (entry.activationRetryTimer !== undefined) {
      clearTimeout(entry.activationRetryTimer);
      entry.activationRetryTimer = undefined;
    }
    entry.activationRetryDelayMs = undefined;
    entry.cancelActivationRetry = undefined;
  }

  /** Cancel a scheduled activation retry and settle its wrapper. */
  private cancelActivationRetry(entry: ChannelEntry): void {
    const cancel = entry.cancelActivationRetry;
    if (cancel) {
      cancel();
    } else {
      this.clearActivationRetry(entry);
    }
  }

  /**
   * Drive a single entry to its terminal `stopped` state, tearing down its
   * handle AT MOST ONCE. Idempotent: it always sets `status = "stopped"`, and
   * only calls `handle.stop()` on the first invocation that sees a live,
   * not-yet-stopped handle (gated by {@link ChannelEntry.handleStopped}).
   *
   * This is the ONE guarded teardown path shared by both `stop()` and the
   * post-settle guard in {@link activate}. Because the
   * guard is per-entry and idempotent, a handle assigned in the same tick as
   * `stop()` is stopped exactly once even when both callers reach the entry, and a
   * late settle can never resurrect a `stopped` entry. The activation handle
   * releases the gateway session and stops the Channel's combined adapter array.
   *
   * `handle.stop()` failures are logged (via {@link ChannelManager.log}) but NOT
   * rethrown: the real launcher's `stop()` rethrows after `session.disconnect()`,
   * and teardown must still complete for every other entry. The call is wrapped
   * in `Promise.resolve().then(...)` so a foreign/injected handle whose `stop()`
   * throws SYNCHRONOUSLY (before any promise is created) is caught by the same
   * `.catch` — otherwise the sync throw would escape, skip `resolveSettled()` in
   * the fulfilled-then-stopped branch of {@link activate}, and hang `settled`.
   *
   * An entry with no handle yet (a still-`connecting` Channel whose transport has
   * not come up) is only marked `stopped`: there is nothing to tear down, and the
   * post-settle guard releases the transport if it arrives after `stop()`.
   *
   * A WEDGED `handle.stop()` (one that never settles) is bounded by
   * {@link ChannelManagerArgs.stopHandleTimeoutMs}: after the deadline the call
   * is logged and abandoned so it can't hang `stop()` — and thus SIGTERM
   * shutdown — forever.
   *
   * @param entry - The Channel entry to stop.
   */
  private async stopEntry(entry: ChannelEntry): Promise<void> {
    entry.status = "stopped";
    // An unref'd interval would not hold the process open, but a stopped
    // manager must not keep logging about a session it no longer owns.
    this.clearReconnectLog(entry);
    this.cancelActivationRetry(entry);
    if (entry.handle && !entry.handleStopped) {
      entry.handleStopped = true;
      const handle = entry.handle;
      // Bound handle.stop(): a wedged stop() (e.g. a socket.disconnect that
      // never returns) must not hang teardown — and thus SIGTERM shutdown —
      // forever. On timeout, log and abandon it (the call keeps running with a
      // settle handler attached inside withTimeout, so it never surfaces as an
      // unhandled rejection) so every OTHER entry still reaches `stopped`. The
      // `Promise.resolve().then(...)` wrap also routes a SYNCHRONOUS throw from
      // a foreign handle through the same timeout+catch.
      await withTimeout(
        Promise.resolve().then(() => handle.stop()),
        this.stopHandleTimeoutMs,
        `channel handle stop() timed out after ${this.stopHandleTimeoutMs}ms during teardown`,
      ).catch((err: unknown) =>
        this.log?.("channel handle stop() failed during teardown", err),
      );
    }
  }

  /**
   * Stop every activated Channel exactly once and mark all statuses `stopped`.
   * Idempotent — a second call is a no-op.
   *
   * Resolves promptly: {@link stopEntry} stops only the handles that already
   * exist and never blocks on activations that have not settled. A hung connect
   * (which `ready({ timeoutMs })` tolerates) has no handle to stop yet, and
   * awaiting it here would hang teardown — and thus SIGTERM shutdown — forever.
   * Any handle that arrives after this point is torn down by the post-settle
   * guard in {@link activate}, which routes through the same idempotent
   * {@link stopEntry}, so nothing leaks and nothing double-stops.
   *
   * Teardown is resilient to a throwing `handle.stop()`: `Promise.allSettled`
   * over the per-entry `stopEntry` calls guarantees one rejection can't abort
   * the rest, so every entry reaches `stopped` and `stop()` always resolves.
   * It is equally resilient to a WEDGED `handle.stop()` that never settles: each
   * is bounded by {@link ChannelManagerArgs.stopHandleTimeoutMs} inside
   * {@link stopEntry}, so a single hung handle can't hang SIGTERM shutdown.
   */
  async stop(): Promise<void> {
    if (this.stopped) {
      return;
    }
    this.stopped = true;

    const entries = [...this.entries.values()];
    await Promise.allSettled(entries.map((entry) => this.stopEntry(entry)));
  }
}
