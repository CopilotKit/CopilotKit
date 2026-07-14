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
 * - `online`: activation resolved; the Channel is live. A transient socket drop
 *   does NOT leave this state — Phoenix self-heals under the persistent adapter
 *   (see {@link ChannelManager}), so an activated Channel stays `online`.
 * - `setup_required`: the Channel is declared but has no managed provider yet —
 *   a valid degraded state, not a failure.
 * - `reconnecting`: reserved. Reconnection is delegated to the Phoenix
 *   connection layer, so the manager never assigns this value; it is retained
 *   in the union to avoid churning the public type.
 * - `stopped`: {@link ChannelManager.stop} has torn the Channel down.
 * - `error`: activation rejected with a non-setup error.
 */
export type ChannelStatus =
  | "connecting"
  | "online"
  | "setup_required"
  | "reconnecting" // reserved (see doc above)
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
   * session drops. The manager uses this only for a LOG-ONLY breadcrumb — it
   * does NOT re-activate on a drop, because reconnection is delegated to the
   * Phoenix connection layer (see {@link ChannelManager}). The Realtime Gateway
   * launcher handle provides `onClose` (it delegates to the session's
   * `onClose`); this stays optional only for non-gateway or test handles that do
   * not implement it, so the manager always invokes it as `handle.onClose?.(cb)`.
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
  let mod: {
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
  try {
    mod = await import(specifier);
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
 * re-activates on a drop; it only registers a log-only `onClose` breadcrumb.
 */
export class ChannelManager implements ChannelsControl {
  private readonly intelligence: CopilotKitIntelligence;
  private readonly channels: Channel[];
  private readonly activateChannel: ActivateChannelEngine;
  private readonly mintRuntimeInstanceId: () => string;
  private readonly adapter?: string;
  private readonly log?: (msg: string, meta?: unknown) => void;

  private readonly entries = new Map<string, ChannelEntry>();
  private activated = false;
  private stopped = false;

  /** @param args - See {@link ChannelManagerArgs}. */
  constructor(args: ChannelManagerArgs) {
    this.intelligence = args.intelligence;
    this.channels = args.channels;
    this.activateChannel = args.activateChannel ?? defaultActivateChannel;
    this.mintRuntimeInstanceId =
      args.mintRuntimeInstanceId ??
      (() => `rti_${randomUUID().replace(/-/g, "")}`);
    this.adapter = args.adapter;
    this.log = args.log;
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
    // Reject duplicate Channel names BEFORE kicking off any engine call. The
    // manager keys `entries` by name, so a duplicate would let the second
    // activation's entry silently overwrite the first — leaking the first
    // Channel's live session out of status()/ready()/stop(). Fail loud here so
    // nothing is ever activated in that state.
    this.assertUniqueChannelNames();
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
        promise: activation.then(
          async (handle) => {
            entry.handle = handle;
            if (this.stopped) {
              // stop() ran before this activation settled, so it could not tear
              // down a handle that did not exist yet. Release it now and keep the
              // Channel `stopped`.
              entry.status = "stopped";
              resolveSettled();
              await handle.stop().catch(() => {});
              return;
            }
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
   * Throw if two declared Channels share a `name`. `entries` is keyed by name,
   * so a duplicate would overwrite the first Channel's entry and leak its live
   * session. Called at the very start of {@link activate}, before any engine
   * call, so a misconfiguration fails loud instead of silently.
   *
   * @throws {ChannelConfigError} If any Channel name appears more than once.
   */
  private assertUniqueChannelNames(): void {
    const seen = new Set<string>();
    for (const channel of this.channels) {
      const name = channel.name!;
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
   * `error` > `setup_required` > `connecting` > `online`.
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
    if (values.includes("connecting")) {
      return "connecting";
    }
    return "online";
  }

  /**
   * Register a LOG-ONLY drop breadcrumb on a Channel's current handle, if the
   * handle exposes the optional `onClose` seam. The callback records a log line
   * and makes NO state change and NO re-activation: reconnection is delegated to
   * the Phoenix connection layer (see {@link ChannelManager}), which auto-rejoins
   * the dropped socket under the persistent adapter. Leaving `status` at `online`
   * is the honest state — the transport self-heals invisibly to the manager.
   *
   * @param name - The Channel name (map key).
   * @param entry - The Channel's activation entry.
   */
  private registerOnClose(name: string, entry: ChannelEntry): void {
    entry.handle?.onClose?.(() => {
      this.log?.(
        `channel "${name}" managed session dropped; Phoenix will auto-reconnect and rejoin`,
      );
    });
  }

  /**
   * Stop every activated Channel exactly once and mark all statuses `stopped`.
   * Idempotent — a second call is a no-op.
   *
   * Resolves promptly: it stops only the handles that already exist and never
   * blocks on activations that have not settled. A hung connect (which
   * `ready({ timeoutMs })` tolerates) has no handle to stop yet, and awaiting it
   * here would hang teardown — and thus SIGTERM shutdown — forever. Any handle
   * that arrives after this point is torn down by the post-settle guard on the
   * initial-activation path, so nothing leaks. Channels that never produced a
   * handle (`setup_required`/`error`) are skipped.
   *
   * Teardown is resilient to a throwing `handle.stop()`: the real launcher's
   * `stop()` rethrows after `session.disconnect()`, so a plain `Promise.all`
   * would reject and skip the status-marking loop — and because `stopped` is
   * already set, a retry would no-op, leaving the manager permanently
   * un-torn-down. `Promise.allSettled` lets every handle attempt teardown and
   * guarantees the status loop always runs, so `stop()` always resolves.
   */
  async stop(): Promise<void> {
    if (this.stopped) {
      return;
    }
    this.stopped = true;

    const entries = [...this.entries.values()];
    const handles = entries
      .map((e) => e.handle)
      .filter((h): h is ChannelsHandle => h !== undefined);
    await Promise.allSettled(handles.map((h) => h.stop()));

    for (const entry of entries) {
      entry.status = "stopped";
    }
  }
}
