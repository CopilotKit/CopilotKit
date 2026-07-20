import { randomUUID } from "node:crypto";
import {
  ChannelConfigError,
  deriveChannelActivationConfig,
} from "./channel-activation-config";
import type { ChannelActivationConfig } from "./channel-activation-config";
import type { CopilotKitIntelligence } from "../intelligence-platform";
// Type-only: @copilotkit/channels is pure-ESM, so a value import would break this
// package's CJS output (see `core/runtime.ts` and `channel-activation-config.ts`
// for the same constraint).
import type { Channel } from "@copilotkit/channels";

/**
 * Lifecycle status of a single Channel activation, or of the manager overall.
 *
 * - `connecting`: activation in flight, not yet settled.
 * - `online`: activation resolved AND the managed session can currently send.
 *   A drop moves the Channel to `reconnecting` (not `online`); a successful
 *   rejoin restores `online`.
 * - `setup_required`: the Channel is declared but has no managed provider yet —
 *   a valid degraded state, not a failure.
 * - `reconnecting`: the managed session dropped and Phoenix is retrying — not
 *   currently sendable. The manager does NOT re-activate (reconnection is
 *   delegated to the Phoenix connection layer); it only reflects the health the
 *   session reports via its `onStateChange` observer.
 * - `stopped`: {@link ChannelManager.stop} has torn the Channel down.
 * - `unmanaged`: the Channel carries a developer-supplied direct adapter, so this
 *   handler does NOT own its lifecycle — the developer starts it via
 *   `channel.start()`. The manager records the Channel with this status purely so
 *   its presence is observable and never misreported as `online`. It is neither
 *   activated, awaited, nor stopped here. Real routing of direct channels is
 *   deferred (tracked in OSS-486).
 * - `error`: activation rejected with a non-setup error, OR a previously-online
 *   session gave up reconnecting after its bounded reconnect window.
 */
export type ChannelStatus =
  | "connecting"
  | "online"
  | "setup_required"
  | "reconnecting"
  | "stopped"
  | "unmanaged"
  | "error";

/**
 * The lifecycle control surface a Channel host uses to drive and observe
 * managed Channel activation.
 */
export interface ChannelsControl {
  /**
   * Resolve once every declared Channel has settled to a terminal, non-connecting
   * state (`online` or `setup_required`). Rejects if any Channel is in `error`,
   * or — when `timeoutMs` is given — if the whole set has not settled in time.
   */
  ready(opts?: { timeoutMs?: number }): Promise<void>;
  /** Snapshot the overall status and the per-Channel status map. */
  status(): { overall: ChannelStatus; channels: Record<string, ChannelStatus> };
  /** Tear down every activated Channel. Idempotent. */
  stop(): Promise<void>;
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
    cb: (state: "online" | "reconnecting" | "gave_up") => void,
  ): void;
}

/** Constructor arguments for {@link ChannelManager}. */
export interface ChannelManagerArgs {
  /** The Intelligence runtime client the activation config is derived from. */
  intelligence: CopilotKitIntelligence;
  /** The declared framework Channels to activate. */
  channels: Channel[];
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
      adapter?: string;
      /** Intelligence app-api HTTP base URL, forwarded to the transport so the
       * managed realtime path enables file/history parity (HTTP-only) — OSS-476. */
      appApiBaseUrl?: string;
      /** Diagnostic sink forwarded to the launcher/transport so transport-level
       * drop diagnostics (e.g. a version-skew missing-leaseToken outage) are not
       * silent in the managed path. */
      log?: (msg: string, meta?: unknown) => void;
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
  return mod.startChannelsOverRealtimeGateway([channel], {
    wsUrl: config.wsUrl,
    apiKey: config.apiKey,
    scope: { projectId: config.projectId, channelName: config.channelName },
    runtimeInstanceId: config.runtimeInstanceId,
    adapter: config.adapter,
    // Forward the app-api HTTP base URL so the transport wires file/history
    // (HTTP-only) on the NORMAL managed path — without this, Channels started by
    // the CopilotRuntime handler run with no history/file support (OSS-476).
    appApiBaseUrl: config.apiUrl,
    // Forward the manager's diagnostic sink down to the launcher/transport so a
    // transport-level drop (e.g. a version-skew missing-leaseToken outage) is
    // observable in the managed path, not just activation-level events.
    ...(log ? { log } : {}),
  });
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
 * Drives managed Channel activation for an Intelligence runtime: lazily
 * activates each declared Channel through an engine, tracks per-Channel
 * lifecycle status, exposes readiness, and tears everything down.
 *
 * Activation is lazy and idempotent — constructing the manager does nothing;
 * {@link activate} starts it and a second call is a no-op. Activation throws
 * SYNCHRONOUSLY (a {@link ChannelConfigError}) only for a misconfiguration it
 * can detect up front — a duplicate or missing Channel name. Every OTHER
 * activation failure is recorded as the Channel's status (`error`, or
 * `setup_required` for a missing provider) and surfaced through {@link status}
 * and {@link ready} rather than thrown.
 *
 * Reconnection is NOT handled here — it is delegated to the Phoenix connection
 * layer that backs the launcher. When a managed socket drops, Phoenix's `Socket`
 * auto-reconnects and auto-rejoins, re-sending the channel's join declaration;
 * the Intelligence gateway's `join/3` re-runs `record_heartbeat` (re-registering
 * the runtime's listener) and its `terminate/2` releases the dead socket's
 * leases (verified against Intelligence #511 `sdk_channel.ex`). So the transport
 * self-heals under the persistent adapter and a re-activation here would be both
 * redundant AND broken: re-invoking the engine on an already-started `Channel`
 * throws in `channel.addAdapter` (started=true). The manager therefore never
 * re-activates on a drop.
 *
 * It DOES, however, reflect real connection health through the session's
 * `onStateChange` observer so {@link ChannelManager.status} stays honest rather
 * than reporting `online` forever after a drop: a drop moves the Channel to
 * `reconnecting`, a successful rejoin restores `online`, and a bounded give-up
 * (Phoenix would otherwise retry forever) moves it to `error`.
 */
export class ChannelManager implements ChannelsControl {
  private readonly intelligence: CopilotKitIntelligence;
  private readonly channels: Channel[];
  private readonly activateChannel: ActivateChannelEngine;
  private readonly mintRuntimeInstanceId: () => string;
  private readonly log?: (msg: string, meta?: unknown) => void;
  private readonly stopHandleTimeoutMs: number;

  private readonly entries = new Map<string, ChannelEntry>();
  private activated = false;
  private stopped = false;

  /** @param args - See {@link ChannelManagerArgs}. */
  constructor(args: ChannelManagerArgs) {
    this.intelligence = args.intelligence;
    this.channels = args.channels;
    this.log = args.log;
    // When using the default engine, forward the manager's log DOWN to the
    // launcher/transport (via defaultActivateChannel's log param) so a
    // transport-level drop is observable in the managed path. `this.log` is read
    // lazily at activation time, so this closure always sees the assigned sink.
    this.activateChannel =
      args.activateChannel ??
      ((config, channel) =>
        defaultActivateChannel(config, channel, undefined, this.log));
    this.mintRuntimeInstanceId =
      args.mintRuntimeInstanceId ??
      (() => `rti_${randomUUID().replace(/-/g, "")}`);
    this.stopHandleTimeoutMs =
      args.stopHandleTimeoutMs ?? DEFAULT_STOP_HANDLE_TIMEOUT_MS;
  }

  /**
   * Start activation of every declared Channel (lazy + idempotent). Mints a
   * distinct runtime instance id per Channel, derives its activation config,
   * and calls the engine. Records each Channel as `connecting`, transitioning
   * to `online`/`setup_required`/`error` as its activation settles.
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
    // Channel's live session out of status()/ready()/stop(). Fail loud here so
    // nothing is ever activated in that state.
    this.assertUniqueChannelNames();
    this.activated = true;

    // Partition declared Channels by transport. A Channel carrying ANY adapter
    // that is NOT the Intelligence managed adapter (a developer-supplied
    // slack/discord/... adapter, which lacks `__intelligenceChannel`) is a
    // DIRECT channel: it is started by the developer via `channel.start()`, not
    // managed-activated here. The skip is EXCLUSIVE PER CHANNEL, not per platform
    // — a Channel served by a direct adapter is not also managed: ANY direct
    // adapter makes the WHOLE Channel `unmanaged` and skips managed activation,
    // regardless of platform. Attaching the managed adapter alongside a direct
    // one would double-deliver every turn (and trip the SDK's `assertExclusive`
    // guard, moving the Channel to `error`). Per the SoT rule, never infer
    // managed intent from a local direct adapter — a managed-eligible Channel has
    // an empty `adapters` at declaration time. Managed+direct coexistence on the
    // same Channel is NOT supported today; it is deferred (OSS-484), as is real
    // routing of direct channels (OSS-486).
    for (const channel of this.channels) {
      const isDirect = channel.adapters.some((a) => !a.__intelligenceChannel);
      if (isDirect) {
        this.log?.(
          `channel "${channel.name!}" carries a direct adapter — recording status "unmanaged" and skipping managed activation (this handler does not own its lifecycle; start it via channel.start(); exclusive per Channel: a Channel served by a direct adapter is not also managed, regardless of platform — managed+direct coexistence deferred (OSS-484); routing of direct channels deferred (OSS-486))`,
        );
        // Record an EXPLICIT `unmanaged` entry rather than skipping silently.
        // A skipped Channel with no entry vanishes from status()/computeOverall,
        // so a runtime whose only Channel is direct would falsely read `online`
        // and ready() would imply a health this handler never established. The
        // entry keeps the Channel observable and truthful: it is never
        // activated, its `settled` is already resolved (nothing on the managed
        // path to wait for), and stopEntry leaves it untouched (see stopEntry).
        this.entries.set(channel.name!, {
          status: "unmanaged",
          handle: undefined,
          handleStopped: false,
          settled: Promise.resolve(),
        });
        continue;
      }
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

      // Invoke the engine synchronously so activation is observably started the
      // moment activate() returns (callers assert the engine was called and see
      // `connecting` before awaiting ready). A synchronous config/engine throw is
      // turned into a rejected activation so it becomes this channel's status
      // rather than throwing out of activate().
      let activation: Promise<ChannelsHandle>;
      let config: ChannelActivationConfig | undefined;
      try {
        config = deriveChannelActivationConfig({
          intelligence: this.intelligence,
          channel,
          runtimeInstanceId,
        });
        activation = this.activateChannel(config, channel);
      } catch (err) {
        activation = Promise.reject(err);
      }

      // The deferred `.then` callbacks capture `entry` and run only after the
      // literal has fully initialized, so referencing it here is safe.
      const entry: ChannelEntry = {
        status: "connecting",
        handle: undefined,
        handleStopped: false,
        settled,
      };

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
   * Resolve when every managed Channel has settled to `online`/`setup_required`.
   *
   * A direct-adapter (`unmanaged`) Channel has an already-resolved `settled` and
   * so never blocks — but its resolution implies NO health: this handler does not
   * own it. Truthfulness about direct Channels lives in {@link status} (they read
   * `unmanaged`, never `online`), not in `ready()` resolving.
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
   * Snapshot status. Every declared Channel — managed OR direct/`unmanaged` —
   * appears keyed by name in `channels`; a direct-adapter Channel this handler
   * does not own is always surfaced as `unmanaged`, never `online`.
   *
   * `overall` is folded over the MANAGED Channels only (see {@link computeOverall}),
   * by precedence `error` > `reconnecting` > `setup_required` > `connecting` >
   * `online`. `online` means every managed Channel can currently send.
   * `reconnecting` outranks `setup_required` because a dropped-but-retrying
   * Channel is an active outage, louder than a steadily-degraded unprovisioned
   * one. `unmanaged` Channels are EXCLUDED from that fold — they carry no health
   * this handler established — so a healthy managed Channel alongside an
   * `unmanaged` one still reports `overall: "online"` while the `unmanaged` one
   * stays visible per-Channel. When every declared Channel is `unmanaged`,
   * `overall` is `unmanaged` (NOT `online`). With no declared Channels at all,
   * `overall` is `online` (nothing is degraded); once every managed Channel has
   * been stopped, `overall` is `stopped`.
   */
  status(): {
    overall: ChannelStatus;
    channels: Record<string, ChannelStatus>;
  } {
    const channels: Record<string, ChannelStatus> = {};
    for (const [name, entry] of this.entries) {
      channels[name] = entry.status;
    }
    // A stopped manager is `stopped` regardless of whether it was ever activated.
    // stop() before activate() (e.g. SIGTERM during startup) leaves `entries`
    // empty, and the empty-set fold below returns `online` — a torn-down manager
    // must never read healthy. Short-circuit before that fold. (After a normal
    // activate→stop, every entry is already `stopped` and the fold agrees, so
    // this is also consistent with the populated case.)
    if (this.stopped) {
      return { overall: "stopped", channels };
    }
    // Before activate() has run, `entries` is empty. Folding an empty set gives
    // `online` — correct for a manager that declares NO channels (nothing is
    // degraded), but a LIE for one that declares channels and simply has not
    // opened its socket yet: activation is lazy (deferred to the first
    // `ready()`), so a not-yet-activated manager must never read `online`.
    // Report `connecting` ("not started") for that case so `status()` is honest
    // before any `ready()`.
    if (!this.activated && this.channels.length > 0) {
      return { overall: "connecting", channels };
    }
    return { overall: this.computeOverall(Object.values(channels)), channels };
  }

  /**
   * Fold per-Channel statuses into a single overall status (see {@link status}).
   *
   * `unmanaged` Channels are folded out FIRST: they carry no lifecycle this
   * handler owns, so they must neither count as `online` nor mask a real managed
   * outage. The remaining MANAGED statuses are ranked
   * `error` > `reconnecting` > `setup_required` > `connecting` > `online`, so a
   * genuine managed failure still dominates while a healthy managed Channel
   * beside an `unmanaged` one reads `online`. If NO managed Channels remain (every
   * declared Channel is direct/`unmanaged`) the result is `unmanaged` — never the
   * false-healthy `online`. The empty-input case (no declared Channels at all)
   * stays `online` (nothing is degraded).
   */
  private computeOverall(values: ChannelStatus[]): ChannelStatus {
    if (values.length === 0) {
      return "online";
    }
    const managed = values.filter((v) => v !== "unmanaged");
    if (managed.length === 0) {
      return "unmanaged";
    }
    if (managed.every((v) => v === "stopped")) {
      return "stopped";
    }
    if (managed.includes("error")) {
      return "error";
    }
    if (managed.includes("reconnecting")) {
      return "reconnecting";
    }
    if (managed.includes("setup_required")) {
      return "setup_required";
    }
    if (managed.includes("connecting")) {
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
    entry.handle?.onStateChange?.((state) => {
      // A stopped manager (or a stopped entry) ignores late connection events.
      if (this.stopped || entry.status === "stopped") {
        return;
      }
      if (state === "reconnecting") {
        entry.status = "reconnecting";
        this.log?.(
          `channel "${name}" managed session dropped; reconnecting (Phoenix auto-rejoin)`,
        );
      } else if (state === "online") {
        entry.status = "online";
        this.log?.(`channel "${name}" managed session back online`);
      } else {
        entry.status = "error";
        this.log?.(
          `channel "${name}" managed session gave up reconnecting; marking error`,
        );
      }
    });
  }

  /**
   * Drive a single entry to its terminal `stopped` state, tearing down its
   * handle AT MOST ONCE. Idempotent: it always sets `status = "stopped"`, and
   * only calls `handle.stop()` on the first invocation that sees a live,
   * not-yet-stopped handle (gated by {@link ChannelEntry.handleStopped}).
   *
   * This is the ONE guarded teardown path shared by both `stop()` and the
   * post-settle guard in {@link activate}. Because the guard is per-entry and
   * idempotent, a handle assigned in the same tick as `stop()` is stopped
   * exactly once even when both callers reach the entry, and a late settle can
   * never resurrect a `stopped` entry.
   *
   * `handle.stop()` failures are logged (via {@link ChannelManager.log}) but NOT
   * rethrown: the real launcher's `stop()` rethrows after `session.disconnect()`,
   * and teardown must still complete for every other entry. The call is wrapped
   * in `Promise.resolve().then(...)` so a foreign/injected handle whose `stop()`
   * throws SYNCHRONOUSLY (before any promise is created) is caught by the same
   * `.catch` — otherwise the sync throw would escape, skip `resolveSettled()` in
   * the fulfilled-then-stopped branch of {@link activate}, and hang `settled`.
   *
   * An `unmanaged` entry (a direct-adapter Channel this handler never activated)
   * is left untouched: the manager owns no handle and no lifecycle for it, so
   * claiming to have `stopped` it would be as untruthful as calling it `online`.
   * The developer's `channel.start()`/stop path is unaffected by manager
   * teardown.
   *
   * A WEDGED `handle.stop()` (one that never settles) is bounded by
   * {@link ChannelManagerArgs.stopHandleTimeoutMs}: after the deadline the call
   * is logged and abandoned so it can't hang `stop()` — and thus SIGTERM
   * shutdown — forever.
   *
   * @param entry - The Channel entry to stop.
   */
  private async stopEntry(entry: ChannelEntry): Promise<void> {
    if (entry.status === "unmanaged") {
      return;
    }
    entry.status = "stopped";
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
