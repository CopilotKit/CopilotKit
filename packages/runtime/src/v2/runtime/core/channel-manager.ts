import { randomUUID } from "node:crypto";
import { deriveChannelActivationConfig } from "./channel-activation-config";
import type { ChannelActivationConfig } from "./channel-activation-config";
import type { CopilotKitIntelligence } from "../intelligence-platform";
// Type-only: @copilotkit/channels is pure-ESM, so a value import would break this
// package's CJS output (see `core/runtime.ts` and `channel-activation-config.ts`
// for the same constraint).
import type { Channel } from "@copilotkit/channels";

/**
 * Initial reconnect backoff, in milliseconds. The delay doubles after each
 * failed re-activation up to {@link RECONNECT_MAX_DELAY_MS}.
 */
export const RECONNECT_BASE_DELAY_MS = 500;

/** Upper bound on the reconnect backoff, in milliseconds. */
export const RECONNECT_MAX_DELAY_MS = 30_000;

/**
 * Maximum number of re-activation attempts before a reconnecting Channel is
 * given up as `error`. Bounds the loop so a permanently-down provider cannot
 * spin forever.
 */
export const RECONNECT_MAX_ATTEMPTS = 10;

/**
 * Lifecycle status of a single Channel activation, or of the manager overall.
 *
 * - `connecting`: activation in flight, not yet settled.
 * - `online`: activation resolved; the Channel is live.
 * - `setup_required`: the Channel is declared but has no managed provider yet —
 *   a valid degraded state, not a failure.
 * - `reconnecting`: the Channel's managed session dropped and the manager is
 *   running a bounded-backoff reconnect loop for it (see {@link RECONNECT_BASE_DELAY_MS}).
 * - `stopped`: {@link ChannelManager.stop} has torn the Channel down.
 * - `error`: activation rejected with a non-setup error.
 */
export type ChannelStatus =
  | "connecting"
  | "online"
  | "setup_required"
  | "reconnecting"
  | "stopped"
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
export class ChannelSetupRequiredError extends Error {}

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
   * session drops, so the manager can begin a supervised reconnect. The real
   * Realtime Gateway launcher handle has NO reconnect today — supervised
   * reconnect is net-new here, and the launcher handle will grow this method in
   * a sibling task. The manager must work whether or not it is present, so it is
   * always invoked as `handle.onClose?.(cb)`.
   */
  onClose?(cb: () => void): void;
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
  /** Delivery adapter; forwarded to the config deriver (defaults to `"slack"`). */
  adapter?: string;
  /**
   * Delay primitive used to drive reconnect backoff. Injectable so tests stay
   * deterministic without real timers. Defaults to a `setTimeout`-based sleep.
   */
  sleep?: (ms: number) => Promise<void>;
  /** Diagnostic sink. */
  log?: (msg: string, meta?: unknown) => void;
}

/** Per-Channel mutable activation entry tracked by the manager. */
interface ChannelEntry {
  status: ChannelStatus;
  /** Never rejects — catches internally and records status. Used to await handles. */
  promise: Promise<void>;
  /** Resolves on `online`/`setup_required`; rejects on `error`. Awaited by `ready`. */
  readonly settled: Promise<void>;
  handle?: ChannelsHandle;
  /** The declared Channel, retained for re-activation on reconnect. */
  readonly channel: Channel;
  /** The resolved activation config, retained for re-activation on reconnect. */
  config?: ChannelActivationConfig;
}

/**
 * Default engine: wrap the channels-intelligence Realtime Gateway launcher.
 *
 * Reached through a dynamic `import()` with a non-literal specifier so the
 * pure-ESM `@copilotkit/channels-intelligence` never becomes a static
 * dependency of this CJS package (mirrors the runtime's other channels seams).
 * Passes NO `org`/`channelId` — the launcher's realtime scope treats them as
 * optional.
 *
 * @param config - Resolved activation config for the Channel.
 * @param channel - The Channel to activate.
 * @returns The launcher's {@link ChannelsHandle}.
 */
async function defaultActivateChannel(
  config: ChannelActivationConfig,
  channel: Channel,
): Promise<ChannelsHandle> {
  const specifier = "@copilotkit/channels-intelligence";
  const mod = (await import(specifier)) as {
    startChannelsOverRealtimeGateway: (
      channels: Channel[],
      opts: {
        wsUrl: string;
        apiKey: string;
        scope: { projectId: number; channelName: string };
        runtimeInstanceId: string;
        adapter?: string;
      },
    ) => Promise<ChannelsHandle>;
  };
  return mod.startChannelsOverRealtimeGateway([channel], {
    wsUrl: config.wsUrl,
    apiKey: config.apiKey,
    scope: { projectId: config.projectId, channelName: config.channelName },
    runtimeInstanceId: config.runtimeInstanceId,
    adapter: config.adapter,
  });
}

/** Real timer-based sleep; the default reconnect backoff primitive. */
function defaultSleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
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
 * Reject after `timeoutMs` if `inner` has not settled, otherwise pass `inner`
 * through. When `timeoutMs` is undefined, `inner` is returned unchanged.
 */
function withTimeout<T>(inner: Promise<T>, timeoutMs?: number): Promise<T> {
  if (timeoutMs === undefined) {
    return inner;
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `ChannelManager.ready timed out after ${timeoutMs}ms waiting for all channels to settle`,
        ),
      );
    }, timeoutMs);
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
 * {@link activate} starts it and a second call is a no-op. Activation never
 * throws: a failure is recorded as the Channel's status (`error`, or
 * `setup_required` for a missing provider) and surfaced through {@link status}
 * and {@link ready}.
 */
export class ChannelManager implements ChannelsControl {
  private readonly intelligence: CopilotKitIntelligence;
  private readonly channels: Channel[];
  private readonly activateChannel: ActivateChannelEngine;
  private readonly mintRuntimeInstanceId: () => string;
  private readonly adapter?: string;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log?: (msg: string, meta?: unknown) => void;

  private readonly entries = new Map<string, ChannelEntry>();
  /** In-flight reconnect loops keyed by Channel name (at most one per Channel). */
  private readonly reconnectLoops = new Map<string, Promise<void>>();
  private activated = false;
  private stopped = false;
  /**
   * Resolves when {@link stop} is called, so a reconnect loop parked on
   * `sleep(backoff)` wakes immediately instead of hanging on the full delay.
   */
  private readonly stoppedSignal: Promise<void>;
  private resolveStopped!: () => void;

  /** @param args - See {@link ChannelManagerArgs}. */
  constructor(args: ChannelManagerArgs) {
    this.intelligence = args.intelligence;
    this.channels = args.channels;
    this.activateChannel = args.activateChannel ?? defaultActivateChannel;
    this.mintRuntimeInstanceId =
      args.mintRuntimeInstanceId ??
      (() => `rti_${randomUUID().replace(/-/g, "")}`);
    this.adapter = args.adapter;
    this.sleep = args.sleep ?? defaultSleep;
    this.log = args.log;
    this.stoppedSignal = new Promise<void>((resolve) => {
      this.resolveStopped = resolve;
    });
  }

  /**
   * Start activation of every declared Channel (lazy + idempotent). Mints a
   * distinct runtime instance id per Channel, derives its activation config,
   * and calls the engine. Records each Channel as `connecting`, transitioning
   * to `online`/`setup_required`/`error` as its activation settles.
   */
  activate(): void {
    if (this.activated) {
      return;
    }
    this.activated = true;

    for (const channel of this.channels) {
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
          ...(this.adapter !== undefined ? { adapter: this.adapter } : {}),
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
        settled,
        channel,
        config,
        promise: activation.then(
          (handle) => {
            entry.handle = handle;
            entry.status = "online";
            this.registerOnClose(name, entry);
            resolveSettled();
          },
          (err: unknown) => {
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
        ),
      };

      this.entries.set(name, entry);
    }
  }

  /**
   * Resolve when every Channel has settled to `online`/`setup_required`; reject
   * with an aggregate error if any Channel is in `error`, or if `timeoutMs`
   * elapses before all Channels settle. Activates lazily if not already started.
   */
  async ready(opts?: { timeoutMs?: number }): Promise<void> {
    this.activate();
    const entries = [...this.entries.values()];
    const all = Promise.allSettled(entries.map((e) => e.settled));
    const results = await withTimeout(all, opts?.timeoutMs);
    const errors = results
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map((r) => r.reason);
    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        `ChannelManager.ready: ${errors.length} channel(s) failed to activate`,
      );
    }
  }

  /**
   * Snapshot status. `overall` precedence:
   * `error` > `setup_required` > `reconnecting` > `connecting` > `online`.
   * With no declared Channels, `overall` is `online` (nothing is degraded);
   * once every Channel has been stopped, `overall` is `stopped`.
   */
  status(): {
    overall: ChannelStatus;
    channels: Record<string, ChannelStatus>;
  } {
    const channels: Record<string, ChannelStatus> = {};
    for (const [name, entry] of this.entries) {
      channels[name] = entry.status;
    }
    return { overall: this.computeOverall(Object.values(channels)), channels };
  }

  /** Fold per-Channel statuses into a single overall status (see {@link status}). */
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
    if (values.includes("setup_required")) {
      return "setup_required";
    }
    if (values.includes("reconnecting")) {
      return "reconnecting";
    }
    if (values.includes("connecting")) {
      return "connecting";
    }
    return "online";
  }

  /**
   * Register the drop-notification callback on a Channel's current handle, if
   * the handle exposes the optional `onClose` seam. Re-invoked on every fresh
   * handle so repeated drops keep triggering reconnection.
   *
   * @param name - The Channel name (map key).
   * @param entry - The Channel's activation entry.
   */
  private registerOnClose(name: string, entry: ChannelEntry): void {
    entry.handle?.onClose?.(() => this.onChannelClosed(name, entry));
  }

  /**
   * React to a dropped managed session: mark the Channel `reconnecting` and kick
   * off a single supervised reconnect loop for it. No-op once stopped, for a
   * Channel that is not currently `online`, or when a loop is already running.
   *
   * @param name - The Channel name (map key).
   * @param entry - The Channel's activation entry.
   */
  private onChannelClosed(name: string, entry: ChannelEntry): void {
    if (this.stopped || entry.status !== "online") {
      return;
    }
    entry.status = "reconnecting";
    this.log?.(`channel "${name}" dropped; reconnecting`);
    if (this.reconnectLoops.has(name)) {
      return;
    }
    // The loop records its own outcome as status; nothing awaits its rejection.
    const loop = this.runReconnect(name, entry);
    this.reconnectLoops.set(name, loop);
    loop.catch(() => {});
  }

  /**
   * Supervised reconnect loop for one Channel: sleep the current backoff, then
   * re-invoke the activation engine. On success, store the new handle, re-arm
   * its `onClose`, and return the Channel to `online`. On failure, grow the
   * backoff (capped at {@link RECONNECT_MAX_DELAY_MS}) and retry, giving up to
   * `error` after {@link RECONNECT_MAX_ATTEMPTS}. Exits promptly once
   * {@link stop} is called — the backoff wait races {@link stoppedSignal} so a
   * pending sleep never blocks teardown, and no re-activation runs after stop.
   *
   * @param name - The Channel name (map key).
   * @param entry - The Channel's activation entry (must carry `config`).
   */
  private async runReconnect(name: string, entry: ChannelEntry): Promise<void> {
    let delay = RECONNECT_BASE_DELAY_MS;
    for (let attempt = 1; attempt <= RECONNECT_MAX_ATTEMPTS; attempt++) {
      // Wake on stop rather than blocking on the full backoff.
      await Promise.race([this.sleep(delay), this.stoppedSignal]);
      if (this.stopped || entry.config === undefined) {
        return;
      }
      try {
        const handle = await this.activateChannel(entry.config, entry.channel);
        if (this.stopped) {
          // Torn down mid-flight: release the fresh handle we just opened.
          await handle.stop().catch(() => {});
          return;
        }
        entry.handle = handle;
        entry.status = "online";
        this.registerOnClose(name, entry);
        this.reconnectLoops.delete(name);
        this.log?.(`channel "${name}" reconnected`);
        return;
      } catch (err) {
        this.log?.(
          `channel "${name}" reconnect attempt ${attempt} failed`,
          err,
        );
        delay = Math.min(delay * 2, RECONNECT_MAX_DELAY_MS);
      }
    }
    if (!this.stopped) {
      entry.status = "error";
      this.log?.(
        `channel "${name}" gave up reconnecting after ${RECONNECT_MAX_ATTEMPTS} attempts`,
      );
    }
    this.reconnectLoops.delete(name);
  }

  /**
   * Stop every activated Channel exactly once and mark all statuses `stopped`.
   * Idempotent — a second call is a no-op. Waits for in-flight activations to
   * settle first so their handles exist, and skips Channels that never produced
   * a handle (`setup_required`/`error`).
   */
  async stop(): Promise<void> {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    // Wake any reconnect loop parked on a backoff so it exits without running a
    // further re-activation; stop() never waits on the remaining backoff.
    this.resolveStopped();

    const entries = [...this.entries.values()];
    // Let in-flight activations settle so any handle is assigned before we stop.
    await Promise.allSettled(entries.map((e) => e.promise));

    const handles = entries
      .map((e) => e.handle)
      .filter((h): h is ChannelsHandle => h !== undefined);
    await Promise.all(handles.map((h) => h.stop()));

    for (const entry of entries) {
      entry.status = "stopped";
    }
  }
}
