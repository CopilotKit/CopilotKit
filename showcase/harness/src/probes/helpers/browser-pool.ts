import type { Browser, BrowserContext } from "playwright";
import { sampleResourceGauges, readCgroupPids } from "./resource-gauges.js";
import type { ResourceGauges } from "./resource-gauges.js";
import { formatCvdiag } from "./cv-diag.js";

/**
 * Default delay the launch-serialization gate waits AFTER each chromium
 * launch settles before the next launch may start. Tunable on staging via
 * the `BROWSER_LAUNCH_STAGGER_MS` env var without a code change.
 *
 * WHY: the harness drives chromium launches in BURSTS — but ONLY at startup
 * (init fills the fixed browser set) and on the RARE recovery/hygiene paths
 * (crash recovery, served-context recycle). Each headless chromium spawns
 * ~50 PIDs (threads count against the container's ~1000-PID ceiling), so a
 * burst of many simultaneous `chromium.launch()` calls transiently spikes
 * PID demand far above the eventual steady state and trips
 * `pthread_create: Resource temporarily unavailable (11)` / "Zygote could
 * not fork" — every browser fails to launch and a d6 run goes 0/18.
 * Funneling every launch through a concurrency-1 gate with a stagger spaces
 * the spawns so the transient spike never exceeds the ceiling. Cold-start
 * pays a one-time warm cost; the fixed browser set warms once and
 * steady-state acquires (which only open CONTEXTS, never fork a process)
 * are instant.
 */
const DEFAULT_BROWSER_LAUNCH_STAGGER_MS = 150;

/**
 * Crash-recovery relaunch retry policy. The OUTAGE this guards: at the
 * container's PID/thread ceiling a `chromium.launch()` throws
 * `pthread_create: Resource temporarily unavailable (errno 11)`. The UNFIXED
 * recovery path treated that single throw as terminal — it evicted the entry
 * from the browser set immediately. Under a thread-exhaustion storm EVERY
 * disconnected browser's relaunch threw, so the set drained to empty and the
 * pool wedged permanently (pickLeastLoaded → undefined forever, every acquire
 * timed out). A pthread EAGAIN is TRANSIENT: kernel thread/PID pressure
 * relaxes within seconds as other launches settle. So the recovery relaunch
 * now RETRIES with backoff before giving up an entry — pacing relaunches into
 * a thread-exhausted kernel instead of hammering it, and surviving a transient
 * EAGAIN rather than cascading into total set eviction.
 *
 * Tunable on staging via env (BROWSER_POOL_RELAUNCH_* ) without a code change.
 */
const DEFAULT_RELAUNCH_MAX_RETRIES = 5;
const DEFAULT_RELAUNCH_BACKOFF_MS = 500;

/**
 * Ceiling on how many CONSECUTIVE transient serve failures (`newContext()`
 * throwing on a still-connected browser) `serveNextWaiter` will self-reschedule
 * a waiter through before leaving it enqueued for the next release/recovery
 * event. Mirrors acquire()'s "retry ONCE then enqueue" semantics so a
 * persistently-transient `newContext()` on a connected browser cannot hot-loop
 * (schedule → serve → throw → unshift → schedule) through microtasks and starve
 * the event loop until the waiter's acquire timeout fires.
 */
const MAX_TRANSIENT_SERVE_RETRIES = 1;

/**
 * Self-heal re-init policy. When the browser set EMPTIES mid-life (every entry
 * evicted because its relaunch retries were exhausted), the pool used to sit
 * permanently dead. Instead it now (a) emits a degraded alarm via the
 * `onDegraded` hook and (b) launches a background self-heal loop that keeps
 * trying to relaunch a fresh browser set — so a thread-exhaustion window that
 * later relaxes recovers WITHOUT a manual redeploy. The loop relaunches up to
 * `browserCount` browsers, retrying the whole attempt on a longer interval
 * until it succeeds (then emits `onRecovered`, reattaches handlers, drains
 * waiters) or the pool shuts down.
 */
const DEFAULT_SELF_HEAL_INTERVAL_MS = 2_000;

/**
 * Self-heal CIRCUIT-BREAKER policy. The OUTAGE this guards (verified from live
 * staging logs — the RECURRING BrowserPool collapse #5185/#5221/#5225 each
 * chipped at but never killed): after the long-lived harness container runs
 * ~hours under sustained d6 cron load, chromium enters a LAUNCH crash-loop —
 * every `chromium.launch()` throws `browserType.launch: Target page, context or
 * browser has been closed`. The set empties, `startSelfHeal()` kicks in, and its
 * loop just RELAUNCHES into the SAME wedged state over and over
 * (`self-heal-launch-failed` repeating, 28× in ~19s observed) — backing off
 * `selfHealIntervalMs` between identical attempts but NEVER doing anything
 * different to escape (the wedge is the cgroup PID/thread ceiling — a
 * platform-fixed, demand-side ceiling that an immediate relaunch only re-pins).
 * `acquire()` therefore has no contexts forever → blocks to timeout fleet-wide.
 * Only a container RESTART cleared it — reactive, not durable.
 *
 * The breaker makes the self-heal loop ESCAPE: after
 * `selfHealHardRecoveryThreshold` CONSECUTIVE self-heal launch failures, instead
 * of looping another identical relaunch the pool performs a HARD recovery — a
 * PACED cold relaunch that backs the loop off to give the thread-exhausted
 * kernel time to relax before the next cold launch (NO `/tmp` purge — the wedge
 * is the cgroup pids ceiling, mitigated demand-side, not a stale-profile-dir
 * problem). Any successful launch resets the
 * consecutive counter. If `selfHealMaxHardRecoveries` consecutive HARD
 * recoveries ALSO fail to revive a single browser, the pool surfaces a LOUD
 * `browser-pool.pool-unrecoverable` alarm (via `onUnrecoverable`) and stops the
 * heal loop rather than silently spinning forever — the operator signal that a
 * redeploy is genuinely required.
 *
 * Tunable on staging via env (BROWSER_POOL_SELF_HEAL_* ) without a code change.
 */
const DEFAULT_SELF_HEAL_HARD_RECOVERY_THRESHOLD = 4;
const DEFAULT_SELF_HEAL_MAX_HARD_RECOVERIES = 3;

/**
 * Default heartbeat interval (ms) for the periodic baseline gauge snapshot. A
 * ~45s cadence gives a baseline PID/thread trend BETWEEN lifecycle events — so
 * a slow creep toward the cgroup `pids.max` ceiling (the proven wedge) is
 * visible in the durable history even when no transition fired in the window.
 * Cheap enough at this cadence (a handful of /proc reads + two short `df`
 * execs); the hot acquire/release path uses only a cheap subset, never a full
 * sample. Tunable on staging via BROWSER_POOL_HEARTBEAT_MS; 0 disables it.
 */
const DEFAULT_HEARTBEAT_MS = 45_000;

/**
 * Resolve a STRICTLY-POSITIVE numeric tunable with explicit-arg > env > default
 * precedence, then CLAMP the result to `>= 1`. Used for the circuit-breaker
 * thresholds (`selfHealHardRecoveryThreshold` / `selfHealMaxHardRecoveries`)
 * whose guards are `> 0`: a `0` (from either source, or a config typo) would
 * silently DISABLE both the hard-recovery escape AND the give-up alarm, sending
 * the loop right back to the infinite-silent-spin this breaker exists to kill.
 * Unlike `resolveNonNegative` (where an explicit `0` legitimately disables
 * retries/backoff), a `0` here is a footgun, so it is clamped up to the minimum
 * safe value of 1 rather than honored. Mirrors `resolveNonNegative`'s
 * precedence; differs only in the floor.
 */
function resolvePositive(
  explicit: number | undefined,
  envRaw: string | undefined,
  fallback: number,
): number {
  const resolved = resolveNonNegative(explicit, envRaw, fallback);
  return resolved < 1 ? 1 : resolved;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolve a non-negative numeric tunable with explicit-arg > env > default
 * precedence. A negative or non-numeric value from EITHER source falls back to
 * the next candidate (and ultimately the default) rather than silently
 * disabling the behavior; an explicit `0` IS valid (tests rely on it to disable
 * retries/backoff). Mirrors the `launchStaggerMs` resolution semantics.
 */
function resolveNonNegative(
  explicit: number | undefined,
  envRaw: string | undefined,
  fallback: number,
): number {
  const validExplicit =
    explicit !== undefined && !Number.isNaN(explicit) && explicit >= 0
      ? explicit
      : undefined;
  const envParsed = envRaw ? parseInt(envRaw, 10) : undefined;
  const validEnv =
    envParsed !== undefined && !Number.isNaN(envParsed) && envParsed >= 0
      ? envParsed
      : undefined;
  return validExplicit ?? validEnv ?? fallback;
}

/** Options forwarded to `browser.newContext`. The pool centralizes the
 *  `X-AIMock-Strict` default header here; callers add their per-probe
 *  headers (X-AIMock-Context, X-Test-Id) via `extraHTTPHeaders`. */
export interface ContextOptions {
  extraHTTPHeaders?: Record<string, string>;
}

interface Waiter {
  resolve: (context: BrowserContext) => void;
  reject: (err: Error) => void;
  /** Context options stored so a freshly-created context for this waiter
   *  carries the headers the original acquire() requested. */
  options?: ContextOptions;
  /** Set true the instant this waiter settles via EITHER the timeout-reject
   *  wrapper OR the resolve wrapper. `serveNextWaiter` consults it AFTER its
   *  `await openContextOn` so a context opened for a waiter that timed out
   *  mid-open is closed + rolled back instead of orphaned (a leak that
   *  permanently bleeds capacity). */
  settled: boolean;
  /** Count of CONSECUTIVE transient serve failures (a `newContext()` throw on a
   *  still-connected browser) this waiter has hit while being re-driven by
   *  `serveNextWaiter`. Bounds the transient re-drive so a persistently-transient
   *  `newContext()` on a connected browser cannot hot-loop (schedule → serve →
   *  throw → unshift → schedule) through microtasks and starve the event loop:
   *  past the ceiling the waiter is left enqueued for the next release/recovery
   *  event instead of self-rescheduling. Reset on any successful serve. */
  transientServeRetries?: number;
}

export interface BrowserPoolStats {
  size: number;
  available: number;
  inUse: number;
  totalRecycles: number;
}

/**
 * The fleet WORKER's live "can I take more work?" signal, returned by
 * `budget()`. A worker only claims a new pull-queue job when it has free
 * context budget (`available > 0`) AND headroom under its cgroup pids ceiling
 * — this is what keeps each worker safely below the platform-fixed
 * `pids.max=1000` thread/PID ceiling (the PROVEN wedge). Deliberately CHEAP:
 * in-memory context counts plus the same cheap cgroup-PID-only read the hot
 * acquire/release path uses — no /proc walk, no `df` (consistent with the
 * #5234 hot-path subset). `pidsCurrent`/`pidsMax` degrade to -1 when the
 * cgroup controller is unreadable (e.g. off-Linux).
 */
export interface BrowserPoolBudget {
  /** Live contexts currently checked out across the pool. */
  inUse: number;
  /** Remaining context capacity: `max - inUse` (never negative). */
  available: number;
  /** Global context cap (`maxContexts`). */
  max: number;
  /** cgroup `pids.current` (current PID/thread count), or -1 if unreadable. */
  pidsCurrent: number;
  /** cgroup `pids.max` ceiling, or -1 if unbounded/unreadable. */
  pidsMax: number;
}

/**
 * Minimal logger surface the pool uses for lifecycle events. Matches the
 * harness-wide `Logger` interface but only the `info` method is required;
 * `warn`/`error` are OPTIONAL so existing callers (tests, legacy boot paths)
 * that inject a bare-`info` fake still type-check. The concrete harness logger
 * implements all three (warn/error route to stderr → Sentry), so capacity-loss
 * events emitted via `error` reach the alert pipeline instead of being buried
 * at info. Call the optional methods safely: `this.logger?.warn?.(...)`.
 */
interface PoolLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn?(msg: string, meta?: Record<string, unknown>): void;
  error?(msg: string, meta?: Record<string, unknown>): void;
}

/**
 * Factory that produces a fresh `Browser` for the pool. The default
 * implementation imports `playwright` and calls `chromium.launch`. Tests
 * inject a fake so the pool's lifecycle logic is exercisable without
 * spawning a real chromium process.
 */
export type LaunchBrowser = () => Promise<Browser>;

/**
 * Reads the cgroup PID controller counters (`pids.current` / `pids.max`).
 * Matches `readCgroupPids` from `resource-gauges.ts`; injectable so the fleet
 * worker's budget gate can be tested without a live cgroup filesystem. `max`
 * is -1 when the controller is absent or unbounded (cgroup's `max` sentinel).
 */
export type CgroupPidsReader = () => { current: number; max: number };

/**
 * One long-lived browser PROCESS in the fixed set. Contexts are pooled over
 * this — the hot path (`acquire`/`release`) opens and closes CONTEXTS on an
 * already-running browser and never forks a process. A browser is only
 * relaunched on the RARE recovery (crash) or hygiene (served-context
 * threshold) paths.
 */
interface BrowserEntry {
  browser: Browser;
  /** Contexts currently checked out from this browser (handed to callers,
   *  not yet released). */
  liveContexts: Set<BrowserContext>;
  /** Cumulative count of contexts served by this browser since its last
   *  (re)launch. Drives the served-context hygiene recycle. */
  servedContexts: number;
  /** True while this entry is being torn down + relaunched. acquire() skips
   *  a recycling entry so a context is never opened on a dying browser. */
  recycling: boolean;
  /** Count of `openContextOn` calls currently IN FLIGHT on this entry —
   *  incremented BEFORE the `await browser.newContext()` and decremented in
   *  BOTH the success and failure paths. This closes the window where a
   *  context has taken a cap reservation but is not yet in `liveContexts`:
   *  during that await `liveContexts.size` undercounts, so any recycle/idle
   *  decision made off `liveContexts.size` alone is blind to the in-flight
   *  open. Every idle/recycle predicate MUST consult `pendingOpens` (via
   *  `isEntryIdle`) so a hygiene recycle never tears the browser down under an
   *  in-flight open. */
  pendingOpens: number;
  /** Set true when a `release()` computed `shouldRecycle` true but DEFERRED
   *  the hygiene recycle because a waiter was just served onto the freed slot
   *  (the `!hadWaiter` guard). Under sustained saturation a waiter is queued at
   *  nearly every release, so that guard would otherwise STARVE the hygiene
   *  recycle forever. This flag carries the pending intent forward: the next
   *  release that finds the entry genuinely idle (no live contexts, no pending
   *  opens) fires the deferred recycle and clears the flag — closing the
   *  starvation without recycling out from under a just-served waiter. */
  recyclePending: boolean;
  /** Monotonic token bumped EVERY time this entry's browser is replaced (crash
   *  recovery or hygiene recycle). An `openContextOn` captures the generation at
   *  open start; the orphan/rollback guards compare against it so an open that
   *  was in flight ACROSS a recycle never decrements the FRESH generation's
   *  `pendingOpens`/reservation. The crash teardown rolls back the OLD
   *  generation's in-flight reservations exactly once; the late settle of those
   *  opens then sees a generation mismatch and rolls back nothing (no double
   *  rollback, no counter desync). */
  generation: number;
}

export interface BrowserPoolOptions {
  /** Number of long-lived browser processes in the fixed set. Default 3
   *  (env BROWSER_POOL_BROWSERS, legacy fallback BROWSER_POOL_SIZE). */
  browsers?: number;
  /** Global cap on concurrently-live contexts across all browsers. Default 24
   *  (env BROWSER_POOL_MAX_CONTEXTS). LOWERED from 40 to reduce THREAD demand
   *  against the platform-fixed cgroup `pids.max=1000` ceiling — the PROVEN
   *  wedge: each context backs a chromium renderer (~15 threads), so a d6 burst
   *  at 40 contexts (~32 concurrent) drove `pids.current` to ~850-900 and a
   *  concurrent recovery-relaunch pushed it over 1000 → pthread EAGAIN →
   *  crash-loop. 24 keeps peak demand well under the ceiling while still
   *  covering the d6 peak. Env-overridable. acquire() past this pends a
   *  waiter. */
  maxContexts?: number;
  /** Per-browser served-context hygiene threshold: once a browser has served
   *  >= recycleAfter contexts AND has no live contexts, it is recycled (its
   *  process is replaced) to bound memory/handle drift. Default 300 (env
   *  BROWSER_POOL_RECYCLE_AFTER). This is RARE — not the hot path. */
  recycleAfter?: number;
  logger?: PoolLogger;
  /** Injected launcher (tests). Defaults to the real chromium launcher. */
  launchBrowser?: LaunchBrowser;
  /** Injected cgroup PID-counter reader (tests). Powers the hot-path gauge AND
   *  the worker `budget()` gate. Defaults to the real `readCgroupPids`. */
  cgroupPidsReader?: CgroupPidsReader;
  /** Stagger between serialized launches (ms). Tests pass 0. */
  launchStaggerMs?: number;
  /** Max crash-recovery relaunch retries before an entry is evicted. Default 5
   *  (env BROWSER_POOL_RELAUNCH_MAX_RETRIES). Tests pass 0 for the fail-fast
   *  legacy behavior. A transient pthread EAGAIN at the PID ceiling is retried
   *  with backoff rather than evicting the entry on the first throw. */
  relaunchMaxRetries?: number;
  /** Base backoff (ms) between relaunch retries — multiplied by the attempt
   *  index for a linear backoff. Default 500 (env
   *  BROWSER_POOL_RELAUNCH_BACKOFF_MS). Tests pass 0. */
  relaunchBackoffMs?: number;
  /** Interval (ms) between self-heal re-init attempts once the browser set has
   *  emptied. Default 2000 (env BROWSER_POOL_SELF_HEAL_INTERVAL_MS). Tests pass
   *  a small value. */
  selfHealIntervalMs?: number;
  /** Number of CONSECUTIVE self-heal launch failures after which the loop stops
   *  retrying the identical relaunch and performs a HARD recovery (a paced cold
   *  relaunch). Default 4 (env BROWSER_POOL_SELF_HEAL_HARD_RECOVERY_THRESHOLD).
   *  Tests pass a small value to trip the breaker deterministically. */
  selfHealHardRecoveryThreshold?: number;
  /** Number of CONSECUTIVE HARD recoveries that may fail to revive any browser
   *  before the pool gives up and fires the `pool-unrecoverable` alarm (instead
   *  of spinning forever). Default 3 (env
   *  BROWSER_POOL_SELF_HEAL_MAX_HARD_RECOVERIES). */
  selfHealMaxHardRecoveries?: number;
  /**
   * Mid-life capacity-loss alarm hook. Invoked when the browser set EMPTIES
   * (every entry evicted) — the silent-outage gap the original code had, where
   * `system:browser-pool-degraded=red` was only emitted on init() failure, never
   * on mid-life death. The orchestrator wires this to the SAME degraded-signal
   * write path. Best-effort: a throwing hook is caught + logged, never crashes
   * the pool.
   */
  onDegraded?: () => void;
  /**
   * Recovery hook. Invoked when the self-heal loop successfully relaunches the
   * browser set after an `onDegraded` alarm. The orchestrator wires this to
   * clear the degraded signal back to green.
   */
  onRecovered?: () => void;
  /**
   * Unrecoverable-alarm hook. Invoked when the self-heal circuit-breaker has
   * exhausted `selfHealMaxHardRecoveries` consecutive HARD recoveries (paced
   * cold relaunches) WITHOUT reviving a single browser — i.e. the wedge survived
   * every paced relaunch, so a redeploy is genuinely required. The
   * orchestrator wires this to a LOUD operator alert (the signal the old
   * silent-spin path never sent). The breaker counters are passed so the alarm
   * can report how hard the pool tried before giving up. Best-effort: a throwing
   * hook is caught + logged, never crashes the pool.
   */
  onUnrecoverable?: (info: BrowserPoolUnrecoverableInfo) => void;
  /**
   * DURABLE forensic snapshot hook. Invoked with a FULL gauge sample + pool
   * stats + per-browser breakdown on every MEANINGFUL pool condition
   * (heartbeat + degraded/unrecoverable/launch-fail/crash transitions). The
   * orchestrator wires this to the `resource_snapshots` PB writer so the gauge
   * history survives the container RESTART that ends a wedge (Railway stdout
   * rolls off; in-memory is cleared on restart — durable PB is the only
   * post-wedge-retrievable trail). Best-effort: a throwing hook is caught +
   * logged, never crashes the pool, and the snapshot writer itself swallows PB
   * errors. Synchronous from the pool's perspective — the writer does its own
   * fire-and-forget async persistence.
   */
  onSnapshot?: (snapshot: BrowserPoolSnapshot) => void;
  /**
   * Heartbeat interval (ms) for the periodic baseline gauge sample/snapshot.
   * Default 45000 (env BROWSER_POOL_HEARTBEAT_MS). A heartbeat gives a baseline
   * trend BETWEEN transition events so a slow PID-ceiling creep is visible even
   * when no lifecycle event fires. 0 disables the heartbeat (tests). Driven by
   * a self-rescheduling loop gated on the shutdown signal — NOT a raw
   * setInterval (which would leak a timer past shutdown).
   */
  heartbeatMs?: number;
}

/**
 * Full forensic snapshot handed to `onSnapshot`. Bundles the OS gauges, the
 * pool's capacity stats, the per-browser breakdown, and the naming `event` so
 * the durable writer can persist one row without re-sampling.
 */
export interface BrowserPoolSnapshot {
  /** Pool condition that triggered the snapshot (`heartbeat`, `degraded`,
   *  `unrecoverable`, `launch-fail`, `crash`, ...). */
  event: string;
  gauges: ResourceGauges;
  stats: BrowserPoolStats;
  perBrowser: BrowserPoolPerBrowserSnapshot[];
}

/** Per-browser breakdown entry in a {@link BrowserPoolSnapshot}. Pure counters
 *  — no secrets — safe for the public-read PB collection. */
export interface BrowserPoolPerBrowserSnapshot {
  index: number;
  liveContexts: number;
  servedContexts: number;
  recycling: boolean;
}

/**
 * Breaker counters handed to the `onUnrecoverable` hook so the operator alarm
 * can describe how hard the pool tried before giving up.
 */
export interface BrowserPoolUnrecoverableInfo {
  /** Target browser-process count the pool could not revive a single one of. */
  browserCount: number;
  /** Acquire waiters still blocked at the moment of give-up. */
  waiters: number;
  /** Consecutive failed HARD recoveries that tripped the give-up. */
  maxHardRecoveries: number;
  /** cgroup `pids.current` at give-up — the PROVEN wedge signal. Naming the
   *  measured PID count (vs the `pids.max` ceiling) in the alarm payload tells
   *  the operator the wedge was PID/thread-ceiling exhaustion, not a guess. -1
   *  off-Linux / when the cgroup PID controller is unreadable. */
  cgroupPidsCurrent: number;
  /** cgroup `pids.max` ceiling at give-up (-1 = unbounded / unavailable). */
  cgroupPidsMax: number;
  /** Process-tree thread count at give-up (the demand against `pids.max`). */
  treeThreadCount: number;
}

/**
 * Pools `BrowserContext`s over a FIXED, small set of long-lived browser
 * PROCESSES. The checkout unit is a `BrowserContext`: `acquire()` opens a
 * context on the least-loaded live browser and `release()` closes it — NO
 * process fork on the hot path. Browser processes are launched only at
 * `init()` (the fixed set), on crash recovery, and on the served-context
 * hygiene recycle. This is the durable PID-ceiling fix: a steady-state run
 * forks N processes total, not one-per-recycle.
 */
export class BrowserPool {
  private readonly browserCount: number;
  private readonly maxContexts: number;
  private readonly recycleAfter: number;
  private browsers: BrowserEntry[] = [];
  private liveContextCount = 0;
  private contextToBrowser = new Map<BrowserContext, BrowserEntry>();
  private waiters: Waiter[] = [];
  private totalRecycles = 0;
  private inFlightRecycles = new Set<Promise<void>>();
  private isShutdown = false;
  // Resolves the instant `shutdown()` flips `isShutdown`. The self-heal /
  // relaunch-backoff delays RACE against this so they abort PROMPTLY on
  // shutdown instead of stalling the whole shutdown up to selfHealIntervalMs /
  // relaunchBackoffMs. Lazily-armed (a pool that never shuts down never needs
  // it) and resolved exactly once in shutdown().
  private resolveShutdownSignal?: () => void;
  private shutdownSignal: Promise<void> = new Promise<void>((resolve) => {
    this.resolveShutdownSignal = resolve;
  });
  private readonly logger?: PoolLogger;
  private readonly injectedLaunchBrowser?: LaunchBrowser;
  // cgroup PID-counter reader for the hot-path gauge AND the worker budget()
  // gate. Injectable so the budget signal is testable without a live cgroup
  // filesystem; defaults to the real readCgroupPids.
  private readonly cgroupPidsReader: CgroupPidsReader;

  // Crash-recovery relaunch backpressure (fix #1) + self-heal (fix #2) policy.
  private readonly relaunchMaxRetries: number;
  private readonly relaunchBackoffMs: number;
  private readonly selfHealIntervalMs: number;
  // Self-heal circuit-breaker (the root-cause-agnostic backstop for the
  // RECURRING wedge): trip a HARD recovery (a paced cold relaunch) after this
  // many consecutive self-heal launch failures, and give up (loud
  // `onUnrecoverable` alarm) after this many consecutive failed HARD recoveries.
  // This stops the infinite silent spin and signals "redeploy required" on ANY
  // wedge — including the PROVEN cgroup PID/thread-ceiling exhaustion.
  private readonly selfHealHardRecoveryThreshold: number;
  private readonly selfHealMaxHardRecoveries: number;
  private readonly onDegraded?: () => void;
  private readonly onRecovered?: () => void;
  private readonly onUnrecoverable?: (
    info: BrowserPoolUnrecoverableInfo,
  ) => void;
  // DURABLE forensic snapshot hook + heartbeat. The hook persists a full gauge
  // sample to PocketBase (survives the wedge→restart); the heartbeat gives a
  // baseline trend between transition events. The heartbeat is a
  // self-rescheduling loop gated on `shutdownSignal` (NOT a raw setInterval) so
  // it never leaks a timer past shutdown.
  private readonly onSnapshot?: (snapshot: BrowserPoolSnapshot) => void;
  private readonly heartbeatMs: number;
  private heartbeatRunning = false;
  // True once the set has emptied and onDegraded fired; cleared when self-heal
  // succeeds. Guards against firing the degraded alarm / spawning a second
  // self-heal loop repeatedly.
  private degraded = false;
  private selfHealing = false;

  // Launch-serialization gate. Every chromium launch — init fill, crash
  // recovery, hygiene recycle — is funneled through `launchBrowser`, which
  // chains onto `launchChain` so strictly ONE launch runs at a time and a
  // `launchStaggerMs` delay elapses after each settles before the next
  // starts.
  private readonly launchStaggerMs: number;
  private launchChain: Promise<unknown> = Promise.resolve();

  // In-flight launches. Every `launchBrowser()` registers its launch promise
  // here BEFORE awaiting `rawLaunchBrowser()` and removes it on settle. This is
  // the atomicity fix for the close-during-launch teardown race: a browser that
  // is mid-`launch()` is NOT yet in `this.browsers` and has NO disconnect
  // handler, so it is invisible to every teardown path (shutdown's close pass,
  // recycle, the disconnect handler). Under the self-heal/relaunch storm a
  // teardown therefore raced an in-flight launch — closing the browser
  // underneath it (`browserType.launch: Target page ... has been closed`,
  // SIGTRAP) or leaking it entirely. shutdown() now DRAINS this set (so it waits
  // for every in-flight launch to settle before its close pass), and
  // `launchBrowser` re-checks `isShutdown` the instant a launch settles: if a
  // shutdown intervened it closes the freshly-launched browser cleanly THEN,
  // exactly once, instead of leaving it for a teardown that already ran.
  private pendingLaunches = new Set<Promise<unknown>>();

  constructor(options: BrowserPoolOptions = {}) {
    this.logger = options.logger;
    this.injectedLaunchBrowser = options.launchBrowser;
    this.cgroupPidsReader =
      options.cgroupPidsReader ?? (() => readCgroupPids());

    const envBrowsers = process.env.BROWSER_POOL_BROWSERS
      ? parseInt(process.env.BROWSER_POOL_BROWSERS, 10)
      : process.env.BROWSER_POOL_SIZE
        ? parseInt(process.env.BROWSER_POOL_SIZE, 10)
        : undefined;
    this.browserCount =
      options.browsers ??
      (envBrowsers !== undefined &&
      !Number.isNaN(envBrowsers) &&
      envBrowsers > 0
        ? envBrowsers
        : 3);

    const envMax = process.env.BROWSER_POOL_MAX_CONTEXTS
      ? parseInt(process.env.BROWSER_POOL_MAX_CONTEXTS, 10)
      : undefined;
    // Default 24 (lowered from 40) to cap THREAD demand under the platform-fixed
    // cgroup pids.max=1000 ceiling — the proven wedge. Env-overridable via
    // BROWSER_POOL_MAX_CONTEXTS.
    this.maxContexts =
      options.maxContexts ??
      (envMax !== undefined && !Number.isNaN(envMax) && envMax > 0
        ? envMax
        : 24);

    const envRecycle = process.env.BROWSER_POOL_RECYCLE_AFTER
      ? parseInt(process.env.BROWSER_POOL_RECYCLE_AFTER, 10)
      : undefined;
    this.recycleAfter =
      options.recycleAfter ??
      (envRecycle !== undefined && !Number.isNaN(envRecycle) && envRecycle > 0
        ? envRecycle
        : 300);

    // Explicit constructor arg (tests inject a tiny value to stay fast) wins;
    // otherwise the env var (staging tuning) wins; otherwise the default. A
    // negative or non-numeric value — from EITHER source — falls back to the
    // default rather than disabling the stagger silently. An explicit `0` IS
    // valid and intentionally disables the wait (tests rely on it); only
    // negative/NaN args are rejected.
    const envStagger = process.env.BROWSER_LAUNCH_STAGGER_MS
      ? parseInt(process.env.BROWSER_LAUNCH_STAGGER_MS, 10)
      : undefined;
    const validExplicit =
      options.launchStaggerMs !== undefined &&
      !Number.isNaN(options.launchStaggerMs) &&
      options.launchStaggerMs >= 0
        ? options.launchStaggerMs
        : undefined;
    const validEnv =
      envStagger !== undefined && !Number.isNaN(envStagger) && envStagger >= 0
        ? envStagger
        : undefined;
    this.launchStaggerMs =
      validExplicit ?? validEnv ?? DEFAULT_BROWSER_LAUNCH_STAGGER_MS;

    // Relaunch backpressure (fix #1) + self-heal (fix #2) tunables. Same
    // explicit-arg > env > default precedence as the stagger, with the same
    // >= 0 guard (an explicit 0 is valid and disables retries/backoff for
    // tests; negative/NaN falls back). Counts/intervals are non-negative.
    this.relaunchMaxRetries = resolveNonNegative(
      options.relaunchMaxRetries,
      process.env.BROWSER_POOL_RELAUNCH_MAX_RETRIES,
      DEFAULT_RELAUNCH_MAX_RETRIES,
    );
    this.relaunchBackoffMs = resolveNonNegative(
      options.relaunchBackoffMs,
      process.env.BROWSER_POOL_RELAUNCH_BACKOFF_MS,
      DEFAULT_RELAUNCH_BACKOFF_MS,
    );
    this.selfHealIntervalMs = resolveNonNegative(
      options.selfHealIntervalMs,
      process.env.BROWSER_POOL_SELF_HEAL_INTERVAL_MS,
      DEFAULT_SELF_HEAL_INTERVAL_MS,
    );
    // Breaker thresholds are CLAMPED to >= 1 (not merely non-negative): a `0`
    // would disable the `> 0` guards on the hard-recovery escape AND the give-up
    // alarm, reverting to the infinite-silent-spin this breaker fixes. A config
    // typo (or an explicit 0) can't silently disable the safety net.
    this.selfHealHardRecoveryThreshold = resolvePositive(
      options.selfHealHardRecoveryThreshold,
      process.env.BROWSER_POOL_SELF_HEAL_HARD_RECOVERY_THRESHOLD,
      DEFAULT_SELF_HEAL_HARD_RECOVERY_THRESHOLD,
    );
    this.selfHealMaxHardRecoveries = resolvePositive(
      options.selfHealMaxHardRecoveries,
      process.env.BROWSER_POOL_SELF_HEAL_MAX_HARD_RECOVERIES,
      DEFAULT_SELF_HEAL_MAX_HARD_RECOVERIES,
    );
    this.onDegraded = options.onDegraded;
    this.onRecovered = options.onRecovered;
    this.onUnrecoverable = options.onUnrecoverable;
    this.onSnapshot = options.onSnapshot;
    this.heartbeatMs = resolveNonNegative(
      options.heartbeatMs,
      process.env.BROWSER_POOL_HEARTBEAT_MS,
      DEFAULT_HEARTBEAT_MS,
    );
  }

  /**
   * EARLY-WARNING INSTRUMENTATION: sample + log the OS resource gauges so a
   * burst approaching the cgroup `pids.max` ceiling (the PROVEN wedge cause) is
   * observable, and an EAGAIN at `launchBrowser()` correlates to a measured
   * `pids.current` near `pids.max`. Logged at `info` with the headline
   * `pids.current`/`pids.max`/thread fields plus the refuted-candidate
   * differential (FD/RSS/shm/tmp). Best-effort: a sampling failure is swallowed
   * (degrades to -1 fields off-Linux), never on the critical path. `label`
   * names the call site (`launch`, `self-heal-launch-failed`, probe ticks).
   */
  private logGauges(label: string): void {
    try {
      const g = sampleResourceGauges();
      this.logger?.info("browser-pool.resource-gauges", {
        label,
        ...g,
      });
    } catch (err) {
      this.logger?.warn?.("browser-pool.resource-gauges-failed", {
        label,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Build the per-browser breakdown for a forensic snapshot. Pure counters
   * (index / live-context count / served count / recycling flag) — no secrets —
   * safe for the public-read `resource_snapshots` PB collection.
   */
  private perBrowserSnapshot(): BrowserPoolPerBrowserSnapshot[] {
    return this.browsers.map((entry, index) => ({
      index,
      liveContexts: entry.liveContexts.size,
      servedContexts: entry.servedContexts,
      recycling: entry.recycling,
    }));
  }

  /**
   * FULL forensic snapshot of a MEANINGFUL pool condition: sample the OS gauges
   * ONCE, log them with the event label, and fire the durable `onSnapshot` hook
   * (which persists to PocketBase so the trail survives the wedge→restart). Use
   * this on the meaningful transitions (degraded/unrecoverable/launch-fail/
   * crash/recycle/heartbeat/init/shutdown), NOT on the hot acquire/release path
   * — a full sample is a handful of /proc reads + two `df` execs, too costly per
   * acquire. The hot path uses `readHotGauges` (a cheap cgroup-PID-only subset
   * folded into the existing acquire/release log line).
   *
   * Best-effort throughout: a gauge-sampling failure logs at warn and skips the
   * snapshot; a throwing `onSnapshot` hook is caught + logged. Neither ever
   * propagates into the pool's lifecycle paths.
   */
  private snapshot(event: string): void {
    let gauges: ResourceGauges;
    try {
      gauges = sampleResourceGauges();
    } catch (err) {
      this.logger?.warn?.("browser-pool.resource-gauges-failed", {
        label: event,
        error: err instanceof Error ? err.message : String(err),
      });
      // CVDIAG: gauge sampling failed → the snapshot is SKIPPED. Surface the
      // miss on stdout so a post-wedge lookback can tell "no snapshot row for
      // this transition" apart from "snapshot fired but PB write dropped".
      console.log(
        formatCvdiag({
          component: `browser-pool:snapshot:${event}`,
          boundary: "als-snapshot",
          status: "error",
          error: `gauge-sample-failed: ${err instanceof Error ? err.message : String(err)}`,
        }),
      );
      return;
    }
    this.logger?.info("browser-pool.resource-gauges", {
      label: event,
      ...gauges,
    });
    // CVDIAG: a snapshot was actually SAMPLED for this pool condition. Emitted
    // whether or not an `onSnapshot` sink is wired (the durable PB write is the
    // orchestrator's hook below) so the live fleet logs confirm snapshots fire.
    console.log(
      formatCvdiag({
        component: `browser-pool:snapshot:${event}`,
        boundary: "als-snapshot",
        status: "ok",
        error: this.onSnapshot ? "sink=wired" : "sink=none",
      }),
    );
    if (!this.onSnapshot) return;
    try {
      this.onSnapshot({
        event,
        gauges,
        stats: this.stats(),
        perBrowser: this.perBrowserSnapshot(),
      });
    } catch (err) {
      this.logger?.error?.("browser-pool.hook-failed", {
        hook: "onSnapshot",
        error: err instanceof Error ? err.message : String(err),
      });
      // CVDIAG: the durable snapshot sink threw — the gauges were sampled but
      // will NOT be persisted, so flag the durability gap on stdout.
      console.log(
        formatCvdiag({
          component: `browser-pool:snapshot:${event}`,
          boundary: "als-snapshot",
          status: "error",
          error: `onSnapshot-hook-failed: ${err instanceof Error ? err.message : String(err)}`,
        }),
      );
    }
  }

  /**
   * CHEAP gauge read for the HOT acquire/release path. Reads ONLY the cgroup PID
   * counters (two small file reads — `pids.current`/`pids.max`). Deliberately
   * does NOT walk /proc or exec `df` (the costly part of a full sample) so
   * sampling on every acquire/release stays negligible. The two counters are
   * folded into the existing `browser-pool.acquire`/`browser-pool.release` log
   * line (one line, not a duplicate second log) so the headline wedge signal
   * (`pids.current` vs `pids.max`) is visible at acquire/release resolution
   * without the full-sample cost; this does NOT fire the durable snapshot hook
   * (the heartbeat + transitions own durable persistence). Best-effort: a read
   * failure degrades to -1 and is swallowed.
   */
  private readHotGauges(): { pidsCurrent: number; pidsMax: number } {
    try {
      const pids = this.cgroupPidsReader();
      return { pidsCurrent: pids.current, pidsMax: pids.max };
    } catch {
      return { pidsCurrent: -1, pidsMax: -1 };
    }
  }

  /**
   * The fleet WORKER's live capacity signal for the pull-queue claim gate. A
   * worker consults this before claiming a new job and only takes more work
   * when it has free context budget (`available > 0`) AND headroom under its
   * cgroup pids ceiling — this is what keeps each worker safely below the
   * platform-fixed `pids.max=1000` thread/PID ceiling (the PROVEN wedge).
   *
   * CHEAP by design — in-memory context counts plus the same cheap
   * cgroup-PID-only read the hot acquire/release path uses (no /proc walk, no
   * `df`; consistent with the #5234 hot-path subset). Safe to call on every
   * claim attempt. `available` is clamped at 0 (a transient overshoot never
   * surfaces as a negative budget); `pidsCurrent`/`pidsMax` degrade to -1 when
   * the cgroup controller is unreadable.
   */
  budget(): BrowserPoolBudget {
    const { pidsCurrent, pidsMax } = this.readHotGauges();
    return {
      inUse: this.liveContextCount,
      available: Math.max(0, this.maxContexts - this.liveContextCount),
      max: this.maxContexts,
      pidsCurrent,
      pidsMax,
    };
  }

  /**
   * Periodic baseline heartbeat: a self-rescheduling loop that fires a FULL
   * forensic snapshot every `heartbeatMs`. Gated on `shutdownSignal` (the same
   * proven mechanism the self-heal loop uses) so it aborts PROMPTLY on shutdown
   * and never leaks a timer — a raw `setInterval` would keep firing after
   * shutdown and pin a handle. Idempotent via `heartbeatRunning`. The heartbeat
   * is what makes a slow PID-ceiling creep visible in the durable history even
   * when no lifecycle event fires in the window.
   */
  private startHeartbeat(): void {
    if (this.heartbeatMs <= 0) return;
    if (this.heartbeatRunning) return;
    this.heartbeatRunning = true;
    void (async () => {
      while (!this.isShutdown) {
        await this.delayOrShutdown(this.heartbeatMs);
        if (this.isShutdown) break;
        this.snapshot("heartbeat");
      }
      this.heartbeatRunning = false;
    })();
  }

  async init(): Promise<void> {
    if (this.injectedLaunchBrowser) {
      this.rawLaunchBrowser = this.injectedLaunchBrowser;
    } else {
      const { chromium } =
        (await import("playwright")) as typeof import("playwright");
      this.rawLaunchBrowser = () =>
        chromium.launch({
          headless: true,
          args: ["--no-sandbox", "--disable-dev-shm-usage"],
        });
    }

    try {
      for (let i = 0; i < this.browserCount; i++) {
        const browser = await this.launchBrowser();
        const entry: BrowserEntry = {
          browser,
          liveContexts: new Set(),
          servedContexts: 0,
          recycling: false,
          pendingOpens: 0,
          recyclePending: false,
          generation: 0,
        };
        this.browsers.push(entry);
        this.attachDisconnectHandler(entry, browser);
      }
      // Baseline forensic snapshot the instant the fixed set is warm, then kick
      // the periodic heartbeat so the durable history has a trend from boot.
      this.snapshot("init");
      this.startHeartbeat();
    } catch (err) {
      // A mid-fill launch failure (the PID-ceiling pthread_create EAGAIN /
      // "Zygote could not fork" this gate exists to survive) must not leak the
      // browsers already launched: callers see a rejected init() and commonly
      // never call shutdown(), so those live chromium processes would leak
      // permanently. Reset state BEFORE closing (so a `disconnected` fire from
      // a close cannot re-enter recovery), then close each launched browser and
      // re-throw to preserve init()'s reject-on-failure contract.
      const launched = this.browsers;
      this.browsers = [];
      this.contextToBrowser.clear();
      await Promise.allSettled(
        launched.map((entry, idx) => this.closeBrowser(entry.browser, idx)),
      );
      throw err;
    }
  }

  // The un-gated launcher. Assigned during init() — either the injected fake
  // (tests) or the real `chromium.launch` wrapper (production). Never called
  // directly by the pool's lifecycle paths; they all go through
  // `launchBrowser()`, which serializes via the gate.
  private rawLaunchBrowser!: LaunchBrowser;

  /**
   * The single launch seam every pool path routes through (init fill, crash
   * recovery, hygiene recycle). It chains onto `launchChain` so AT MOST ONE
   * `rawLaunchBrowser()` is in flight at a time across the whole pool, and a
   * `launchStaggerMs` delay elapses after each launch settles before the next
   * begins. This spaces chromium process spawns so a burst never spikes PID
   * demand past the container ceiling.
   *
   * The caller's `result` resolves the instant `rawLaunchBrowser()` settles —
   * the stagger does NOT delay the launch's own caller. It instead gates only
   * the NEXT launch. The chain swallows failures (`.catch`) so one failed
   * launch does not poison the queue; the failing launch's own caller still
   * receives the rejection via the returned `result`. The stagger applies
   * whether the launch resolved or threw — a failed launch is just as
   * PID-costly to retry.
   *
   * ATOMIC vs TEARDOWN: the launch promise is registered in `pendingLaunches`
   * BEFORE it is awaited and removed when it settles, so `shutdown()` can DRAIN
   * every in-flight launch before its close pass — a launch can no longer escape
   * teardown accounting (the close-during-launch race). And the instant a launch
   * settles, if a `shutdown()` raced in while it was in flight, this seam closes
   * the freshly-launched browser cleanly THEN (exactly once) and re-throws a
   * shutdown sentinel: the caller's launch then "fails" into its normal
   * error/abort path rather than registering (and leaking) a browser into a pool
   * that is going away. Callers must NOT separately close a browser this seam
   * returned on the shutdown path — the throw means there is no browser to close.
   */
  private launchBrowser = (): Promise<Browser> => {
    // EARLY WARNING: log the OS resource gauges on EVERY launch (init fill,
    // crash recovery, hygiene recycle, self-heal). A launch is the moment PID
    // demand spikes toward the cgroup `pids.max` ceiling — the proven wedge —
    // so sampling here makes a burst approaching the ceiling observable and lets
    // a `pthread_create` EAGAIN be correlated to a measured `pids.current`.
    this.logGauges("launch");
    const gate = this.launchChain;
    const raw = gate.then(() => this.rawLaunchBrowser());
    // Gate the NEXT launch off the RAW result (pre-shutdown-handling) so the
    // stagger/queue semantics are unchanged by the teardown guard below.
    this.launchChain = raw
      .catch(() => undefined)
      .then(() =>
        this.launchStaggerMs > 0 ? delay(this.launchStaggerMs) : undefined,
      );

    const result = raw.then((browser) => {
      // The launch settled. If a shutdown raced in while it was in flight, this
      // freshly-launched browser would otherwise be invisible to the close pass
      // that already ran (it was never in `this.browsers`). Close it cleanly here
      // — exactly once — and surface a shutdown sentinel so the caller does not
      // register it into a pool that is tearing down.
      if (this.isShutdown) {
        // The launching browser is by definition not yet registered in
        // `this.browsers`, so there is no meaningful index — log it as -1.
        return this.closeBrowser(browser, -1).then((): Browser => {
          throw new Error("BrowserPool shut down during launch");
        });
      }
      return browser;
    });

    // Track the in-flight launch so shutdown() drains it before closing. Use a
    // catch-swallowed handle so a rejected launch (failure OR the shutdown
    // sentinel above) still settles the drain without surfacing an unhandled
    // rejection on the tracking copy; the caller still receives the real
    // rejection via `result`.
    const tracked = result.catch(() => undefined);
    this.pendingLaunches.add(tracked);
    void tracked.finally(() => {
      this.pendingLaunches.delete(tracked);
    });

    return result;
  };

  /**
   * Close a browser, routing any failure through the structured logger with
   * the originating browser index instead of silently swallowing it. A close
   * failure is non-fatal (the process may have already crashed) but must be
   * visible to the harness log/Sentry pipeline.
   */
  private async closeBrowser(
    browser: Browser,
    browserIndex: number,
  ): Promise<void> {
    try {
      await browser.close();
    } catch (err) {
      this.logger?.warn?.("browser-pool.close-failed", {
        browserIndex,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Effective load of an entry: live (checked-out) contexts PLUS in-flight
   * opens. Ranking by `liveContexts.size` alone is BLIND to opens that have
   * reserved a slot but not yet settled into `liveContexts` — under a BURST of
   * concurrent acquires every pick sees the same `liveContexts.size` and stacks
   * the whole burst onto ONE browser process. That per-process context pileup
   * is exactly the pthread_create EAGAIN thread spike that caused the outage.
   * Counting `pendingOpens` spreads a burst across the set as the opens reserve.
   */
  private entryLoad(entry: BrowserEntry): number {
    return entry.liveContexts.size + entry.pendingOpens;
  }

  /**
   * Close a context, routing any failure through the structured logger instead
   * of silently swallowing it. Mirrors `closeBrowser`: a context-close failure
   * is non-fatal (the underlying browser may already be dead) but — per the
   * `closeBrowser` doctrine that close failures must be visible to the harness
   * log/Sentry pipeline — must not be swallowed by a bare `.catch(() => {})`.
   */
  private async closeContext(
    context: BrowserContext,
    browserIndex: number,
  ): Promise<void> {
    try {
      await context.close();
    } catch (err) {
      this.logger?.warn?.("browser-pool.context-close-failed", {
        browserIndex,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Pick the least-loaded live browser entry to open the next context on.
   * Skips entries that are recycling or whose browser has disconnected —
   * acquire() must never open a context on a dying browser. "Load" is measured
   * by `entryLoad` (live contexts plus in-flight opens). Returns undefined when
   * no live browser is available (caller enqueues a waiter; crash recovery
   * fulfills it).
   */
  private pickLeastLoaded(): BrowserEntry | undefined {
    let best: BrowserEntry | undefined;
    for (const entry of this.browsers) {
      if (entry.recycling) continue;
      if (!entry.browser.isConnected()) continue;
      if (best === undefined || this.entryLoad(entry) < this.entryLoad(best)) {
        best = entry;
      }
    }
    return best;
  }

  /**
   * Synchronously RESERVE one slot against the cap, with NO await between the
   * check and the increment. This is the synchronization primitive that makes
   * the cap hold under concurrency: because JS is single-threaded, an
   * increment that is synchronous with its bound check cannot be interleaved by
   * another `acquire`, so concurrent acquires can never collectively pass the
   * check and overshoot `maxContexts` the way a check-then-`await`-then-mutate
   * sequence could. Returns `true` if a slot was reserved (`liveContextCount`
   * now reflects it as in-use), `false` if at cap. Every successful reservation
   * MUST be matched by exactly one of: a context tracked via
   * `trackOpenedContext` (the reservation becomes a live context), or a
   * rollback via `releaseReservation` (the open failed / was orphaned).
   */
  private reserveSlot(): boolean {
    if (this.liveContextCount >= this.maxContexts) return false;
    this.liveContextCount++;
    return true;
  }

  /**
   * Roll back a reservation (or a live-context decrement), clamped at 0 so a
   * future double-decrement / double-release can never drive the count
   * negative and desync `stats()`.
   */
  private releaseReservation(): void {
    if (this.liveContextCount > 0) this.liveContextCount--;
  }

  /**
   * SINGLE idle predicate every recycle/teardown decision consults. An entry
   * is idle ONLY when it has neither a live (checked-out) context NOR an open
   * in flight. The `pendingOpens` term is the structural fix: a context that
   * has taken a reservation but is still awaiting `newContext()` is not yet in
   * `liveContexts`, so `liveContexts.size === 0` alone would read a busy entry
   * as idle and let a hygiene recycle tear the browser down mid-open. Consult
   * THIS, never `liveContexts.size === 0` directly, for any idle decision.
   */
  private isEntryIdle(entry: BrowserEntry): boolean {
    return entry.liveContexts.size === 0 && entry.pendingOpens === 0;
  }

  /**
   * True when a NON-crash (hygiene) recycle may safely fire for this entry: it
   * must be genuinely idle (`isEntryIdle`) AND not already recycling. The crash
   * path does NOT use this — a disconnected/dead browser is recycled regardless
   * of in-flight opens (those opens will fail against the dead browser and roll
   * themselves back).
   */
  private isEntryRecyclable(entry: BrowserEntry): boolean {
    return !entry.recycling && this.isEntryIdle(entry);
  }

  /**
   * Fire a hygiene recycle that was previously DEFERRED (carried on
   * `entry.recyclePending`) if the entry is now genuinely recyclable. This is
   * the shared "honor the deferred recycle" check that EVERY path which returns
   * an entry to idle must run — not just `release()`. The release path defers a
   * hygiene recycle (e.g. because a waiter was just served onto the freed slot)
   * and sets `recyclePending`, expecting the next idle release to honor it; but
   * an entry can also return to idle via NON-release teardowns (the
   * `openContextOn` orphan-by-recycle rollback and the `serveNextWaiter`
   * orphan-close), where no `release()` ever fires. Without re-checking here the
   * deferred recycle is dropped and the browser exceeds `recycleAfter`
   * indefinitely. Race-safe: the predicate + flag clear + recycle dispatch are
   * all synchronous (no await straddles them), and `recycleBrowser` itself
   * re-guards on `recycling`/`pendingOpens`.
   */
  private maybeFireDeferredRecycle(entry: BrowserEntry): void {
    if (entry.recyclePending && this.isEntryRecyclable(entry)) {
      entry.recyclePending = false;
      this.recycleBrowser(entry, "hygiene");
    }
  }

  /**
   * Open a context on the given live browser against a reservation the caller
   * ALREADY took via `reserveSlot()`. Centralizes the `X-AIMock-Strict` default
   * header. On success the reservation is converted into a tracked live context
   * (the reservation already counted it in `liveContextCount`, so no second
   * increment). On `newContext()` failure the reservation is rolled back and
   * the error re-thrown — the caller decides whether to retry (it must
   * re-reserve) or give up.
   *
   * PRECONDITION: the caller holds a reservation. This method never checks the
   * cap itself; the cap is enforced synchronously at `reserveSlot()`.
   */
  private async openContextOn(
    entry: BrowserEntry,
    options?: ContextOptions,
  ): Promise<BrowserContext> {
    // Capture the browser instance BEFORE the await. If the entry is recycled
    // mid-open, `entry.browser` is reassigned to a fresh process — the context
    // we get back belongs to a browser that is being / has been torn down, so
    // it must not be handed out or counted. Mark the in-flight open so any
    // concurrent recycle/idle decision (`isEntryIdle`) sees it and does NOT
    // treat the entry as idle during this await window.
    //
    // GENERATION TOKEN: capture the entry's generation alongside the browser.
    // If a recycle (crash OR hygiene) replaces the browser while this open is in
    // flight, the recycle teardown rolls back THIS open's pendingOpens +
    // reservation against the OLD generation. When the late settle finally
    // arrives it sees `entry.generation !== genBefore` and decrements NOTHING —
    // the fresh generation's counters are untouched. Without this, a crash
    // teardown that rolled back in-flight reservations and the late settle would
    // BOTH decrement → double rollback / negative count; or, if only the late
    // settle decremented, it would decrement the FRESH generation → stuck
    // pendingOpens that blocks every future hygiene recycle.
    const browserBefore = entry.browser;
    const genBefore = entry.generation;
    entry.pendingOpens++;

    // Roll back this open's accounting iff the entry is STILL the same
    // generation we started on. A recycle that already accounted for this
    // in-flight open (crash teardown) bumped the generation, so a late
    // settle here is a no-op (the teardown owns the rollback).
    const rollbackPendingOpen = (): void => {
      if (entry.generation === genBefore && entry.pendingOpens > 0) {
        entry.pendingOpens--;
        this.releaseReservation();
      }
    };

    let context: BrowserContext;
    try {
      context = await browserBefore.newContext({
        extraHTTPHeaders: {
          "X-AIMock-Strict": "true",
          ...options?.extraHTTPHeaders,
        },
      });
    } catch (err) {
      // The open failed — give the reserved slot back (if this generation still
      // owns it) so it does not bleed capacity permanently, and clear the
      // in-flight marker.
      rollbackPendingOpen();
      throw err;
    }

    // BELT-AND-SUSPENDERS for the recycle-vs-open AND shutdown-vs-open races: the
    // entry may have been recycled (crash recovery or a hygiene recycle that
    // fired before this counter was consulted) OR the pool may have SHUT DOWN
    // WHILE the newContext() above was in flight. If so the freshly-opened
    // context is an orphan on a torn-down browser / a torn-down pool — closing or
    // otherwise counting it would corrupt the cap, could hand a dead context to a
    // holder, OR (the shutdown case) land in contextToBrowser/liveContexts AFTER
    // shutdown()'s close-pass already ran, leaking a context that is never closed.
    //
    // The `isShutdown` term is the SHUTDOWN-LEAK fix: a serveNextWaiter()/acquire
    // open that reserved before shutdown can settle AFTER shutdown's close-pass.
    // shutdown() drains inFlightRecycles + pendingLaunches, but this open is
    // fire-and-forget and tracked by NEITHER set, so the drain does not await it.
    // Treating shutdown like a recycle here — close the just-opened orphan, roll
    // back the reservation, and throw — keeps the post-shutdown pool clean.
    if (
      this.isShutdown ||
      entry.generation !== genBefore ||
      entry.recycling ||
      entry.browser !== browserBefore ||
      !browserBefore.isConnected()
    ) {
      rollbackPendingOpen();
      void this.closeContext(context, this.browsers.indexOf(entry));
      this.logger?.warn?.("browser-pool.open-orphaned-by-recycle", {
        browserIndex: this.browsers.indexOf(entry),
      });
      // NON-release teardown: this in-flight open ended without a release(), so
      // the release-path's deferred-recycle re-check (recyclePending) and waiter
      // drain never run for the capacity this rollback just freed. Mirror them
      // here. (Bug 2) honor a recycle that was deferred behind this very open,
      // now that pendingOpens dropped and the entry may be idle; (Bug 3) drain a
      // queued waiter onto the freed slot instead of stalling it until the next
      // unrelated release/recycle handoff. Both run on synchronous state.
      this.maybeFireDeferredRecycle(entry);
      this.scheduleServeNextWaiter();
      throw new Error("browser-pool: context open orphaned by recycle");
    }

    // Convert the held reservation into a tracked live context. The reservation
    // already incremented liveContextCount, so do NOT increment again here.
    entry.pendingOpens--;
    entry.liveContexts.add(context);
    entry.servedContexts++;
    this.contextToBrowser.set(context, entry);
    return context;
  }

  async acquire(
    options?: ContextOptions,
    timeoutMs = 30_000,
  ): Promise<BrowserContext> {
    if (this.isShutdown) {
      throw new Error("BrowserPool is shut down");
    }

    // At-cap → pend a FIFO waiter carrying this acquire's options. release()
    // (or a recovery handoff) creates a fresh context for it when capacity
    // frees up, keeping the cap saturated.
    //
    // SYNCHRONOUS RESERVATION: take the slot before any await. If reserveSlot()
    // returns false we are at cap and pend a waiter (the waiter re-reserves
    // when served). Because the check-and-increment in reserveSlot() has no
    // await between them, concurrent acquires cannot collectively overshoot the
    // cap during one another's newContext() awaits.
    if (!this.reserveSlot()) {
      return this.enqueueWaiter(options, timeoutMs);
    }

    const entry = this.pickLeastLoaded();
    if (!entry) {
      // No live browser right now (all recycling / disconnected). Give the
      // reservation back and enqueue a waiter — crash recovery's relaunch
      // re-reserves and fulfills it on the next tick.
      this.releaseReservation();
      return this.enqueueWaiter(options, timeoutMs);
    }

    try {
      const context = await this.openContextOn(entry, options);
      // HOT-PATH gauge: cheap cgroup-PID-only sample (no /proc walk, no df)
      // folded INTO this acquire line so the headline wedge signal is visible at
      // acquire resolution without the full-sample cost and without a duplicate
      // log. Durable persistence is owned by the heartbeat + transitions.
      this.logger?.info("browser-pool.acquire", {
        available: this.maxContexts - this.liveContextCount,
        inUse: this.liveContextCount,
        ...this.readHotGauges(),
      });
      return context;
    } catch (err) {
      // SHUTDOWN STRADDLE: the pool shut down WHILE this open was in flight —
      // openContextOn's orphan guard closed the orphan, rolled the reservation
      // back, and threw. Do NOT enter the transient-retry / recycle / enqueue
      // path: shutdown() already cleared `this.waiters`, so enqueueWaiter would
      // strand this acquire on a queue nothing drains (it would only settle on
      // its own timeout). Reject promptly instead, mirroring the at-entry
      // `isShutdown` guard. (openContextOn already rolled the reservation back.)
      if (this.isShutdown) {
        throw new Error("BrowserPool is shut down", { cause: err });
      }
      // FIX #7 — a `newContext()` throw does NOT prove the browser died. The
      // unfixed code unconditionally recycled `entry`, so a TRANSIENT
      // newContext error on a still-`isConnected()` shared browser tore down a
      // healthy process AND abandoned its OTHER live contexts (the recycle
      // teardown drops every live context of that entry). Gate the recycle on
      // the SAME dead-vs-alive logic the orphan guard uses: only recycle when
      // the browser is actually disconnected. openContextOn already rolled the
      // reservation back on failure.
      this.logger?.warn?.("browser-pool.acquire-newcontext-failed", {
        browserIndex: this.browsers.indexOf(entry),
        connected: entry.browser.isConnected(),
        error: err instanceof Error ? err.message : String(err),
      });
      if (entry.browser.isConnected()) {
        // TRANSIENT error on a live browser — do NOT destroy it (that would
        // abandon its sibling live contexts). Re-reserve and retry the open on
        // the SAME browser once; if that also throws, pend a waiter (served by a
        // later release / recovery) rather than recycling a healthy process.
        if (!this.reserveSlot()) {
          return this.enqueueWaiter(options, timeoutMs);
        }
        try {
          return await this.openContextOn(entry, options);
        } catch (transientRetryErr) {
          // SHUTDOWN STRADDLE (retry leg): a DISTINCT, genuinely-reachable straddle
          // window from the outer catch's guard — the outer guard already observed
          // isShutdown===false, then we re-reserved and re-opened, and the pool can
          // shut down WHILE THIS retry's open is in flight (its orphan guard then
          // closed+rolled-back+threw, landing here). Reject promptly, mirroring the
          // outer guard, rather than enqueueing onto a queue shutdown already
          // cleared (which would strand this acquire until its timeout).
          if (this.isShutdown) {
            throw new Error("BrowserPool is shut down", {
              cause: transientRetryErr,
            });
          }
          this.logger?.warn?.("browser-pool.acquire-transient-retry-failed", {
            browserIndex: this.browsers.indexOf(entry),
            connected: entry.browser.isConnected(),
            error:
              transientRetryErr instanceof Error
                ? transientRetryErr.message
                : String(transientRetryErr),
          });
          // openContextOn rolled the re-reservation back on this throw. If the
          // browser is NOW disconnected, fall through to the dead-browser
          // recovery below; otherwise pend a waiter without destroying it.
          if (entry.browser.isConnected()) {
            return this.enqueueWaiter(options, timeoutMs);
          }
        }
      }
      // The browser is dead — recycle it and try a sibling. openContextOn
      // already rolled the reservation back, so RE-RESERVE before the retry —
      // this keeps the retry path cap-correct instead of opening a context with
      // no reservation behind it.
      this.recycleBrowser(entry);
      if (!this.reserveSlot()) {
        // Another concurrent acquire took the freed slot first — pend a waiter.
        return this.enqueueWaiter(options, timeoutMs);
      }
      const retry = this.pickLeastLoaded();
      if (retry) {
        try {
          const context = await this.openContextOn(retry, options);
          return context;
        } catch (retryErr) {
          // A SECOND browser died in the same EAGAIN burst — the exact
          // scenario this module exists to survive. openContextOn already
          // rolled the re-reservation back on this throw, so accounting is
          // safe; mirror the first-attempt recovery: recycle `retry` and pend
          // a waiter so the caller is gracefully enqueued (served when a
          // context frees / a recovery relaunch lands) instead of receiving a
          // hard rejection. Do NOT re-reserve here — the rollback already
          // happened, and enqueueWaiter pends without a reservation (the
          // waiter re-reserves when served).
          this.logger?.warn?.("browser-pool.acquire-retry-newcontext-failed", {
            browserIndex: this.browsers.indexOf(retry),
            error:
              retryErr instanceof Error ? retryErr.message : String(retryErr),
          });
          this.recycleBrowser(retry);
          return this.enqueueWaiter(options, timeoutMs);
        }
      }
      // No other live browser — give the re-reservation back and pend a
      // waiter; recovery fulfills it.
      this.releaseReservation();
      return this.enqueueWaiter(options, timeoutMs);
    }
  }

  /**
   * Enqueue a FIFO waiter for a context with a bounded timeout. The waiter
   * carries its `options` so the context eventually created for it (by
   * release() or a recovery handoff) gets the requested headers.
   */
  private enqueueWaiter(
    options: ContextOptions | undefined,
    timeoutMs: number,
  ): Promise<BrowserContext> {
    return new Promise<BrowserContext>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, options, settled: false };
      const timer = setTimeout(() => {
        const idx = this.waiters.indexOf(waiter);
        if (idx !== -1) this.waiters.splice(idx, 1);
        // Mark settled BEFORE rejecting so a serveNextWaiter() that already
        // shift()ed this waiter and is mid-`await openContextOn` observes the
        // dead state and closes/rolls back the context instead of orphaning it.
        waiter.settled = true;
        // CVDIAG: an acquire blocked the full timeout without a context — the
        // load-bearing wedge symptom (no free contexts / empty browser set).
        // Surface it so the post-wedge lookback sees the starvation breadcrumb.
        console.log(
          formatCvdiag({
            component: "browser-pool:acquire-timeout",
            boundary: "als-snapshot",
            status: "error",
            error: `timeoutMs=${timeoutMs} waiters=${this.waiters.length} browsers=${this.browsers.length} degraded=${this.degraded}`,
          }),
        );
        reject(new Error("BrowserPool acquire timeout"));
      }, timeoutMs);
      const origResolve = waiter.resolve;
      const origReject = waiter.reject;
      waiter.resolve = (context) => {
        clearTimeout(timer);
        waiter.settled = true;
        origResolve(context);
      };
      waiter.reject = (err) => {
        clearTimeout(timer);
        waiter.settled = true;
        origReject(err);
      };
      this.waiters.push(waiter);
    });
  }

  /**
   * Serve the next FIFO waiter by creating a fresh context on the
   * least-loaded live browser with the waiter's stored options. Keeps the cap
   * saturated. If no live browser is available the waiter stays queued (a
   * recovery relaunch serves it later). A newContext failure re-queues the
   * waiter at the FRONT so ordering is preserved, then — mirroring acquire()'s
   * FIX #7 — only recycles the browser when it is actually disconnected; a
   * transient failure on a still-connected browser leaves the healthy process
   * intact and re-drives the queue.
   */
  /**
   * Fire-and-forget recursive re-serve. The recursive `serveNextWaiter()`
   * calls inside `serveNextWaiter` itself are not awaited (they re-enter to
   * drain the next waiter after a dead-waiter skip / orphan close), so a future
   * throw would surface as an unhandled promise rejection. Route any failure to
   * the structured logger instead.
   */
  private scheduleServeNextWaiter(): void {
    this.serveNextWaiter().catch((err: unknown) => {
      this.logger?.error?.("browser-pool.serve-waiter-unhandled", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  private async serveNextWaiter(): Promise<void> {
    if (this.waiters.length === 0) return;
    // SHUTDOWN GUARD: bail BEFORE shifting/reserving/opening once the pool is
    // shutting down. shutdown() flips `isShutdown` and rejects every queued
    // waiter synchronously; a serveNextWaiter scheduled just before that (or
    // re-entering from a release/recycle handoff) must NOT shift a waiter and
    // start an `openContextOn` whose context would settle AFTER shutdown's
    // close-pass and leak into contextToBrowser/liveContexts. (The orphan guard
    // in openContextOn is the belt; this is the suspenders — never start the open
    // in the first place.)
    if (this.isShutdown) return;
    const entry = this.pickLeastLoaded();
    if (!entry) return; // No live browser — waiter served by a later relaunch.

    // SYNCHRONOUS RESERVATION before shifting + opening. A waiter only exists
    // because acquire() rolled back its reservation when it pended, so the slot
    // must be re-reserved here. If we cannot reserve we are at cap (a concurrent
    // release + recycle-drain both tried to serve) — leave the waiter queued for
    // the next freed slot rather than overshoot.
    if (!this.reserveSlot()) return;

    const waiter = this.waiters.shift()!;

    // The waiter may have settled (timed out) between being enqueued and being
    // shifted here — if so it is already off the queue handled by the timeout
    // splice OR was the head; either way do NOT open a context for a dead
    // waiter. Roll the reservation back and serve the next one instead.
    if (waiter.settled) {
      this.releaseReservation();
      if (this.waiters.length > 0) this.scheduleServeNextWaiter();
      return;
    }

    let context: BrowserContext;
    try {
      context = await this.openContextOn(entry, waiter.options);
    } catch (err) {
      // SHUTDOWN STRADDLE: the pool may have shut down WHILE this open was in
      // flight — openContextOn's orphan guard then closed the orphan, rolled the
      // reservation back, and threw. This waiter was `shift()`ed off `this.waiters`
      // (line above) BEFORE shutdown could run; shutdown()'s reject-loop iterates
      // ONLY what is still on `this.waiters`, so it never saw — and never rejected
      // — this shifted waiter. Re-queueing it would strand it on a list nothing
      // drains (shutdown's reject loop already ran) → a never-settling acquire.
      // THIS branch is therefore the SOLE settler of a shifted-then-straddled
      // waiter: REJECT it here, mirroring shutdown's waiter-rejection, and do NOT
      // touch the browser (everything is being torn down).
      if (this.isShutdown) {
        if (!waiter.settled) {
          waiter.reject(new Error("BrowserPool is shut down"));
        }
        return;
      }
      // FIX #7 (propagated to serveNextWaiter) — a `newContext()` throw does NOT
      // prove the browser died. The unfixed code unconditionally recycled
      // `entry`, so a TRANSIENT newContext error on a still-`isConnected()`
      // shared browser tore down a healthy process AND abandoned its OTHER live
      // contexts (the recycle teardown drops every live context of that entry).
      // Under saturation (waiters queued — this module's target load) that
      // destroys a healthy Chromium and fails every sibling probe. Gate the
      // recycle on the SAME dead-vs-alive logic acquire() uses: only recycle
      // when the browser is actually disconnected. openContextOn already rolled
      // the reservation back on failure.
      this.logger?.warn?.("browser-pool.serve-waiter-failed", {
        browserIndex: this.browsers.indexOf(entry),
        connected: entry.browser.isConnected(),
        error: err instanceof Error ? err.message : String(err),
      });
      // Re-queue at the FRONT so FIFO order is preserved regardless of which
      // branch we take below.
      this.waiters.unshift(waiter);
      if (entry.browser.isConnected()) {
        // TRANSIENT error on a live browser — do NOT destroy it (that would
        // abandon its sibling live contexts). Leave the browser intact.
        //
        // BOUND the re-drive to match acquire()'s "retry ONCE then enqueue"
        // semantics. acquire() retries a transient open once and then leaves the
        // caller enqueued for a future release/recovery event; serveNextWaiter
        // must do the same. Without a ceiling, a persistently-transient
        // `newContext()` on a connected browser hot-loops (schedule → serve →
        // throw → unshift → schedule) through microtasks and starves the event
        // loop until the waiter's acquire timeout fires. Self-reschedule only up
        // to MAX_TRANSIENT_SERVE_RETRIES consecutive transient failures; past
        // that, leave the waiter enqueued — a later release() / recycle handoff
        // re-drives it (and resets the counter on the next genuine attempt).
        const retries = (waiter.transientServeRetries ?? 0) + 1;
        waiter.transientServeRetries = retries;
        if (retries <= MAX_TRANSIENT_SERVE_RETRIES) {
          this.scheduleServeNextWaiter();
        } else {
          this.logger?.warn?.("browser-pool.serve-waiter-transient-ceiling", {
            browserIndex: this.browsers.indexOf(entry),
            retries,
          });
        }
        return;
      }
      // The browser is dead — recycle it. Its relaunch handoff re-attempts the
      // queued waiters (which re-reserve).
      this.recycleBrowser(entry);
      return;
    }

    // DEAD-WAITER ORPHAN GUARD: the waiter may have timed out WHILE the
    // newContext() above was in flight. Its resolve() would now no-op, so the
    // freshly-opened context would be counted in liveContextCount yet never
    // released — a permanent capacity bleed. Detect the settled waiter, CLOSE
    // the orphan context, roll back its accounting, and serve the next waiter
    // with the freed slot instead.
    if (waiter.settled) {
      this.contextToBrowser.delete(context);
      entry.liveContexts.delete(context);
      // openContextOn already did `entry.servedContexts++` for this context.
      // Since it is being orphan-closed and never delivered, mirror that
      // increment with a decrement (clamped at 0) — otherwise every
      // timed-out-mid-serve permanently inflates servedContexts and biases the
      // hygiene recycle (servedContexts >= recycleAfter) to fire early, tripping
      // a premature recycle → an extra chromium launch (the PID pressure this
      // module exists to avoid). (Bug 1)
      entry.servedContexts = Math.max(0, entry.servedContexts - 1);
      this.releaseReservation();
      void this.closeContext(context, this.browsers.indexOf(entry));
      this.logger?.warn?.("browser-pool.serve-waiter-orphan-closed", {
        browserIndex: this.browsers.indexOf(entry),
      });
      // NON-release teardown: returning this entry to idle here without a
      // release() means the release-path's deferred-recycle re-check never runs.
      // Honor a hygiene recycle that was deferred behind this serve (set via the
      // release-path `shouldRecycle && hadWaiter` guard) now that the entry is
      // idle again — otherwise the deferred recycle is dropped and the browser
      // exceeds recycleAfter indefinitely. (Bug 2)
      this.maybeFireDeferredRecycle(entry);
      if (this.waiters.length > 0) this.scheduleServeNextWaiter();
      return;
    }

    // A genuine serve succeeded — clear any accumulated transient-retry count so
    // the ceiling applies per consecutive-failure run, not cumulatively.
    waiter.transientServeRetries = 0;
    waiter.resolve(context);
  }

  async release(context: BrowserContext): Promise<void> {
    if (this.isShutdown) {
      // Best-effort close; nothing to track post-shutdown. Route through the
      // helper so a close failure is logged (FIX#8 doctrine — no bare swallow).
      // The owning entry is no longer tracked post-shutdown, so index is -1.
      await this.closeContext(context, -1);
      return;
    }

    const entry = this.contextToBrowser.get(context);
    // Unknown / double release — no-op.
    if (!entry) return;

    // SYNCHRONOUS ACCOUNTING FIRST, then close(). The unfixed code awaited
    // `context.close()` BEFORE this bookkeeping + the idle-recycle decision, so
    // a concurrent acquire/openContextOn could interleave during the close
    // await and the recycle decision could be evaluated against stale state.
    // Doing the bookkeeping AND evaluating the idle-recycle decision off purely
    // SYNCHRONOUS state — with no await between the decrement and the size
    // check — removes that window: a new context cannot sneak in between the
    // decrement and the decision.
    this.contextToBrowser.delete(context);
    entry.liveContexts.delete(context);
    this.releaseReservation();

    // HOT-PATH gauge: cheap cgroup-PID-only subset (see acquire) folded INTO
    // this release line — cheap enough to read on every release, one log line.
    // Full samples are reserved for transitions + heartbeat.
    this.logger?.info("browser-pool.release", {
      available: this.maxContexts - this.liveContextCount,
      inUse: this.liveContextCount,
      ...this.readHotGauges(),
    });

    // Hygiene-recycle intent, LATCHED synchronously: the instant this browser
    // has served >= recycleAfter contexts, mark `recyclePending`. This is a
    // sticky intent, NOT an immediate level check — once the threshold is
    // reached the entry WILL be recycled at the next genuinely-idle release,
    // even if that release served a waiter (deferring) or arrived while an open
    // was in flight. Latching the intent (rather than re-deriving a level check
    // each release) is what carries a deferred recycle FORWARD across a release
    // that served a waiter: the firing condition below is `isEntryRecyclable &&
    // recyclePending`, so a release that served the waiter (entry non-idle) does
    // NOT recycle now but the intent survives to the next idle release. Under
    // sustained saturation this closes the starvation the bare `!hadWaiter`
    // guard caused (the recycle is deferred, never dropped).
    if (entry.servedContexts >= this.recycleAfter) {
      entry.recyclePending = true;
    }

    // Close the released context AFTER the accounting/decision so the close
    // await cannot straddle them. Best-effort; failure is non-fatal but routed
    // through the helper so it is LOGGED (FIX#8 doctrine — no bare swallow).
    await this.closeContext(context, this.browsers.indexOf(entry));

    // Keep the cap saturated: if a waiter is queued, hand it a fresh context
    // on the least-loaded live browser now that capacity freed up. Capture
    // whether a waiter was queued BEFORE serving it: serveNextWaiter() may
    // reserve + asynchronously open a context on THIS just-freed entry, which
    // would race the hygiene recycle below (the recycle snapshot was taken
    // synchronously above and is now stale — recycling would tear the browser
    // out from under the just-served waiter, intermittently failing/stalling a
    // probe under load).
    const hadWaiter = this.waiters.length > 0;
    if (hadWaiter) {
      this.serveNextWaiter().catch((err: unknown) => {
        this.logger?.error?.("browser-pool.serve-waiter-unhandled", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    // Hygiene recycle: once a browser's recycle intent is latched
    // (`recyclePending`, set above the instant served >= recycleAfter) AND the
    // entry is genuinely recyclable (idle — no live contexts, no in-flight
    // opens, not already recycling), replace its process to bound memory/handle
    // drift. This is the RARE path — it fires at most once per `recycleAfter`
    // contexts per browser and never on a busy browser.
    //
    // Firing SOLELY off `recyclePending` (not a fresh level check) is what makes
    // the carry-forward load-bearing: a release that served a queued waiter
    // (`hadWaiter`) leaves the entry NOT idle right after — `serveNextWaiter`
    // reserves + opens on the next tick, so either a live context exists or
    // `pendingOpens > 0` — so `isEntryRecyclable` returns false and the recycle
    // defers WITHOUT dropping the latched intent. The next genuinely-idle
    // release fires it. (`hadWaiter` is still read above to drive the serve; the
    // recycle decision intentionally does not gate on it — the idle check
    // already prevents tearing down a just-served waiter.)
    if (entry.recyclePending && this.isEntryRecyclable(entry)) {
      entry.recyclePending = false;
      this.recycleBrowser(entry, "hygiene");
    }
  }

  /**
   * Sleep `ms`, but resolve EARLY if the pool shuts down. Used by the self-heal
   * loop and the relaunch backoff so a shutdown does not have to wait out a full
   * `selfHealIntervalMs` / `relaunchBackoffMs` before those loops observe
   * `isShutdown` and exit. The setTimeout is cleared when the shutdown signal
   * wins so we leave no dangling timer.
   */
  private delayOrShutdown(ms: number): Promise<void> {
    if (this.isShutdown || ms <= 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      void this.shutdownSignal.then(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  async shutdown(): Promise<void> {
    // FULL durable snapshot before teardown — captures the final resource state
    // while the browser set is still populated (the per-browser breakdown is
    // meaningful only pre-teardown). Sampled BEFORE flipping isShutdown so the
    // snapshot's `onSnapshot` write is not racing the post-shutdown drain.
    this.snapshot("shutdown");
    this.isShutdown = true;
    // Wake any racing self-heal / backoff delay so it aborts promptly instead of
    // stalling shutdown for up to selfHealIntervalMs / relaunchBackoffMs.
    this.resolveShutdownSignal?.();

    // Reject any queued waiters.
    for (const waiter of this.waiters) {
      waiter.reject(new Error("BrowserPool is shut down"));
    }
    this.waiters = [];

    // Drain in-flight recycles + self-heal loops AND in-flight launches in a
    // LOOP, re-snapshotting each pass. A ONE-TIME snapshot is racy: a self-heal
    // iteration (or an in-flight-recovery relaunch) can register a NEW promise in
    // `inFlightRecycles` AFTER the snapshot — and that late iteration may launch
    // a fresh chromium AFTER shutdown returned, leaking the process. Loop until
    // BOTH sets are genuinely empty (each settled loop/recycle/launch has dropped
    // its handle), so we await every late-registered iteration too.
    //
    // `pendingLaunches` is the close-during-launch fix: an init/recycle/self-heal
    // launch that is mid-`launch()` is NOT yet in `this.browsers`, so the close
    // pass below cannot see it. Draining it here makes shutdown WAIT for every
    // in-flight launch to settle; the launch seam itself (`launchBrowser`) then
    // observes `isShutdown` on settle and closes the freshly-launched browser
    // cleanly — so it is neither closed mid-launch nor leaked. The loops all
    // check `isShutdown` and the delays abort via the shutdown signal, so this
    // converges promptly.
    while (this.inFlightRecycles.size > 0 || this.pendingLaunches.size > 0) {
      await Promise.allSettled([
        ...Array.from(this.inFlightRecycles),
        ...Array.from(this.pendingLaunches),
      ]);
    }

    // Close every live context, then every browser. Route through the close
    // helpers so a close failure is logged with its browser index. A late
    // self-heal iteration that pushed a browser just before observing
    // `isShutdown` is captured here because we close AFTER the drain loop above
    // fully quiesced.
    const contextClosers = Array.from(this.contextToBrowser.keys()).map((c) =>
      // Resolve the REAL owning-browser index for the log — not the key's
      // iteration position. The owner is the entry the context maps to.
      this.closeContext(
        c,
        this.browsers.indexOf(this.contextToBrowser.get(c)!),
      ),
    );
    await Promise.allSettled(contextClosers);

    const closers = this.browsers.map((entry, idx) =>
      this.closeBrowser(entry.browser, idx),
    );
    await Promise.allSettled(closers);

    this.browsers = [];
    this.contextToBrowser.clear();
    this.liveContextCount = 0;
  }

  stats(): BrowserPoolStats {
    return {
      // `size` is the context capacity, not the process count — driver tests
      // assert acquire/release moves the counters by 1 per context.
      size: this.maxContexts,
      available: this.maxContexts - this.liveContextCount,
      inUse: this.liveContextCount,
      totalRecycles: this.totalRecycles,
    };
  }

  /**
   * Register a `disconnected` listener on a browser so a chromium process
   * that crashes mid-life proactively recycles its entry. Three guards keep
   * stale fires harmless:
   *
   *   1. Pool shutdown: handler may fire as we close everything; ignore.
   *   2. Entry reassignment: `entry.browser` may already point to a fresh
   *      browser if recycle completed before the old browser's disconnect
   *      event drained — the late fire is for the OLD instance.
   *   3. Entry eviction: launch failure during recycle removes the entry from
   *      `this.browsers`; a disconnect for a no-longer-tracked entry is a
   *      no-op.
   */
  private attachDisconnectHandler(entry: BrowserEntry, browser: Browser): void {
    browser.on("disconnected", () => {
      if (this.isShutdown) return;
      if (entry.browser !== browser) return;
      if (!this.browsers.includes(entry)) return;
      this.logger?.info("browser-pool.disconnected", {
        browserIndex: this.browsers.indexOf(entry),
      });
      // A browser crashed/disconnected mid-life — capture a FULL durable
      // snapshot so the resource state at the crash (esp. pids.current vs
      // pids.max) is reconstructable post-restart.
      this.snapshot("crash");
      this.recycleBrowser(entry);
    });
  }

  /**
   * RARE path — crash recovery + served-context hygiene. Replaces the entry's
   * browser PROCESS with a fresh one. A recycle guard makes a second call for
   * the same entry a no-op. The entry's live contexts (if any — e.g. a crash
   * while contexts were held) are abandoned: their holders' next op rejects,
   * so their probe fails (bounded blast radius — only this browser's
   * contexts). On launch failure the entry is evicted; if that empties the
   * browser set while waiters are queued, every waiter is rejected.
   *
   * `reason` distinguishes a genuine crash/disconnect (the browser is already
   * dead) from a hygiene recycle (the browser is healthy, we are replacing it
   * proactively to bound drift). A HYGIENE recycle must NEVER tear down an
   * entry with an in-flight open (`pendingOpens > 0`): the freshly-opening
   * context would land on a browser we are about to close, becoming a dead
   * context counted against the cap. `release()` already gates the hygiene call
   * on `isEntryRecyclable` (pendingOpens === 0), but we re-check here as
   * defense-in-depth and bail. The CRASH path proceeds regardless — the browser
   * is dead anyway, and the in-flight open's own newContext()/orphan-guard
   * rolls itself back.
   */
  private recycleBrowser(
    entry: BrowserEntry,
    reason: "crash" | "hygiene" = "crash",
  ): void {
    if (this.isShutdown) return;
    if (entry.recycling) return;
    // Hygiene recycle never proceeds against an in-flight open — defer it (the
    // pending intent is carried on `recyclePending`, which the next idle
    // release will honor). The crash path is exempt: the browser is dead.
    if (reason === "hygiene" && entry.pendingOpens > 0) {
      entry.recyclePending = true;
      return;
    }
    entry.recycling = true;
    this.totalRecycles++;

    const browserIdx = this.browsers.indexOf(entry);
    this.logger?.info("browser-pool.recycle", {
      browserIndex: browserIdx,
      reason,
      servedContexts: entry.servedContexts,
      recycleAfter: this.recycleAfter,
      totalRecycles: this.totalRecycles,
    });
    // FULL durable snapshot at recycle start (crash OR hygiene): a recycle
    // relaunches a chromium process — the PID-demand moment the wedge exploits.
    this.snapshot(`recycle-${reason}`);

    // Drop the abandoned live contexts from the global lookup + count so a
    // later release() of a stale reference is a no-op and the cap accounting
    // stays accurate. Clamp each decrement (releaseReservation) so the count
    // can never go negative if a context was concurrently released.
    for (const ctx of entry.liveContexts) {
      this.contextToBrowser.delete(ctx);
      this.releaseReservation();
    }
    entry.liveContexts.clear();

    // FIX #3 — account for in-flight opens at crash teardown. An
    // `openContextOn` that reserved a slot (liveContextCount++ / pendingOpens++)
    // but is still awaiting `newContext()` against a now-dead browser may NEVER
    // settle (a crashed chromium's pending newContext() can hang forever) — so
    // its reservation would bleed capacity permanently and wedge the pool. Roll
    // those reservations back HERE, then BUMP the generation: any late settle of
    // those opens compares its captured generation, sees the mismatch, and rolls
    // back NOTHING (the rollback below already owns it — no double rollback).
    // The generation bump also covers the hygiene path (reason can only be
    // hygiene when pendingOpens === 0, so the rollback loop is a no-op there),
    // keeping generation strictly monotonic per replacement.
    for (let i = 0; i < entry.pendingOpens; i++) {
      this.releaseReservation();
    }
    entry.pendingOpens = 0;
    entry.generation++;

    const oldBrowser = entry.browser;

    const recyclePromise = (async () => {
      await this.closeBrowser(oldBrowser, browserIdx);

      if (this.isShutdown) return;

      try {
        // FIX #1 — PID-ceiling backpressure: retry the relaunch with backoff
        // before giving up the entry. A `pthread_create: Resource temporarily
        // unavailable (errno 11)` at the thread ceiling is TRANSIENT; the
        // unfixed code evicted on the first throw, so a thread-exhaustion storm
        // drained every entry and wedged the pool. Pacing the relaunch and
        // surviving a transient EAGAIN keeps the entry alive.
        const fresh = await this.relaunchWithBackoff(browserIdx);
        if (this.isShutdown) {
          await this.closeBrowser(fresh, this.browsers.indexOf(entry));
          return;
        }
        entry.browser = fresh;
        entry.servedContexts = 0;
        entry.liveContexts.clear();
        // FIX #2 — reset pendingOpens onto the fresh generation. The crash
        // teardown above already rolled back the OLD generation's in-flight
        // opens and bumped the generation, so any late settle is a no-op; but
        // reset to 0 explicitly so the fresh browser starts with a clean
        // in-flight count and a stale ≥1 can never block all future hygiene
        // recycles (nor a stray decrement drive it negative).
        entry.pendingOpens = 0;
        entry.recycling = false;
        // The deferred-recycle intent was satisfied by THIS recycle — clear it
        // so the fresh browser does not inherit a stale "recycle me" flag.
        entry.recyclePending = false;
        this.attachDisconnectHandler(entry, fresh);
        // Drain queued waiters onto the freshly-launched browser. Guard
        // forward progress: serveNextWaiter() can return WITHOUT consuming a
        // waiter (pickLeastLoaded() momentarily undefined / reserveSlot()
        // false) while isConnected() still reports true — without the guard the
        // loop would busy-spin, yielding only to microtasks. Break the instant
        // a serve made no progress (waiter count unchanged); a later release or
        // recovery handoff drains the remaining waiters.
        while (
          this.waiters.length > 0 &&
          this.liveContextCount < this.maxContexts &&
          entry.browser.isConnected()
        ) {
          const before = this.waiters.length;
          await this.serveNextWaiter();
          if (this.waiters.length >= before) break;
        }
      } catch (err) {
        // FIX #9 — a relaunch failure DURING shutdown is benign, not a capacity
        // outage. The relaunch loop aborts the moment `isShutdown` flips
        // (relaunchWithBackoff throws), and that throw landed here. Logging it at
        // ERROR + running the degraded/self-heal semantics would emit a phantom
        // alarm and spawn a self-heal loop on a pool that is intentionally going
        // away. Downgrade to a benign debug log and skip the error/degraded path.
        if (this.isShutdown) {
          this.logger?.info?.(
            "browser-pool.recycle-relaunch-aborted-shutdown",
            {
              browserIndex: this.browsers.indexOf(entry),
            },
          );
          const idx = this.browsers.indexOf(entry);
          if (idx !== -1) this.browsers.splice(idx, 1);
          return;
        }
        // Relaunch retries exhausted — evict the entry so it does not
        // masquerade as live capacity.
        this.logger?.error?.("browser-pool.recycle-relaunch-failed", {
          browserIndex: this.browsers.indexOf(entry),
          error: err instanceof Error ? err.message : String(err),
        });
        // CVDIAG: relaunch retries exhausted → the entry is evicted (capacity
        // loss). Breadcrumb for the crash/recycle lookback.
        console.log(
          formatCvdiag({
            component: "browser-pool:launch-fail",
            boundary: "als-snapshot",
            status: "error",
            error: `relaunch-exhausted: ${err instanceof Error ? err.message : String(err)}`,
          }),
        );
        // FULL durable snapshot: the relaunch retries are exhausted — a
        // launch-fail transition. Capture the resource state so a `pthread_create`
        // EAGAIN at the PID ceiling is correlatable post-restart.
        this.snapshot("launch-fail");
        const idx = this.browsers.indexOf(entry);
        if (idx !== -1) this.browsers.splice(idx, 1);
        // FIX #2 — self-heal + alarm on empty browser set. The unfixed code
        // rejected all waiters here and then sat permanently dead: the set was
        // empty, pickLeastLoaded() returned undefined forever, every future
        // acquire timed out, and NO degraded signal was ever emitted (it only
        // fired on init() failure). Instead, when the set empties we fire the
        // degraded alarm AND kick a background self-heal loop that keeps trying
        // to relaunch a fresh set — so a thread-exhaustion window that later
        // relaxes recovers without a manual redeploy. Queued waiters are NOT
        // mass-rejected: each still honors its own acquire timeout, and the
        // self-heal drains any still-waiting on success.
        if (this.browsers.length === 0) {
          this.onBrowserSetEmpty();
        }
      }
    })();

    this.inFlightRecycles.add(recyclePromise);
    recyclePromise
      .catch((err: unknown) => {
        this.logger?.error?.("browser-pool.recycle-failed", {
          browserIndex: this.browsers.indexOf(entry),
          error: err instanceof Error ? err.message : String(err),
        });
        // CVDIAG: a hygiene/crash recycle promise rejected unexpectedly —
        // surface the swallowed error so it is greppable, not silent.
        console.log(
          formatCvdiag({
            component: "browser-pool:recycle-failed",
            boundary: "als-snapshot",
            status: "error",
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      })
      .finally(() => {
        // Do NOT reset `entry.recycling` here. Each path already leaves it
        // correct: the success path cleared it (and reattached the entry as a
        // live, non-recycling browser); the eviction path spliced the entry out
        // of `this.browsers` entirely, so flipping `recycling` back to false
        // would wrongly resurrect a dead entry as eligible. Only drop the
        // in-flight tracking handle here.
        this.inFlightRecycles.delete(recyclePromise);
      });
  }

  /**
   * FIX #1 — relaunch a browser with bounded retry + linear backoff. The first
   * attempt is immediate; each subsequent attempt waits `relaunchBackoffMs *
   * attempt` (also gated by the launch-stagger). Surfaces the LAST error if all
   * attempts are exhausted (the caller evicts + self-heals). A pool shutdown
   * mid-retry aborts the loop. `relaunchMaxRetries === 0` reproduces the legacy
   * fail-fast behavior (one attempt, no retry) — tests use it to drive the
   * empty-set path deterministically.
   */
  private async relaunchWithBackoff(browserIdx: number): Promise<Browser> {
    let lastErr: unknown;
    const totalAttempts = this.relaunchMaxRetries + 1;
    for (let attempt = 0; attempt < totalAttempts; attempt++) {
      if (this.isShutdown) {
        throw lastErr instanceof Error
          ? lastErr
          : new Error("BrowserPool shut down during relaunch");
      }
      if (attempt > 0 && this.relaunchBackoffMs > 0) {
        // Abort the backoff PROMPTLY on shutdown instead of waiting it out.
        await this.delayOrShutdown(this.relaunchBackoffMs * attempt);
        if (this.isShutdown) {
          throw lastErr instanceof Error
            ? lastErr
            : new Error("BrowserPool shut down during relaunch");
        }
      }
      try {
        return await this.launchBrowser();
      } catch (err) {
        lastErr = err;
        this.logger?.warn?.("browser-pool.relaunch-attempt-failed", {
          browserIndex: browserIdx,
          attempt: attempt + 1,
          maxAttempts: totalAttempts,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error("browser-pool: relaunch retries exhausted");
  }

  /**
   * FIX #2 (alarm half) — invoked the moment the browser set empties mid-life.
   * Emits the `system:browser-pool-degraded=red` alarm via `onDegraded` (the
   * mid-life signal the unfixed code never sent — it only fired on init()
   * failure, so this outage was silent) and kicks the self-heal loop. Idempotent
   * via the `degraded` flag so a burst of concurrent evictions fires the alarm /
   * spawns the loop exactly once.
   */
  private onBrowserSetEmpty(): void {
    if (this.isShutdown) return;
    // Fire the degraded alarm exactly once per degraded episode (idempotent via
    // `degraded`). The alarm hook is gated, but the self-heal loop is NOT: if
    // the set empties AGAIN while `degraded` is still true but NO heal loop is
    // running (e.g. a heal that partially revived the set, then the survivor
    // crashed and re-emptied before recovery completed), the old `if (degraded)
    // return` short-circuit would leave `degraded + empty + !selfHealing` as a
    // TERMINAL dead state with no active heal path — pool permanently dead. So
    // always (re)spawn the heal loop on empty; `startSelfHeal` is itself
    // idempotent via `selfHealing`.
    if (!this.degraded) {
      this.degraded = true;
      this.logger?.error?.("browser-pool.set-empty-degraded", {
        waiters: this.waiters.length,
        browserCount: this.browserCount,
      });
      // CVDIAG: mid-life capacity loss — the browser set emptied. Durable
      // breadcrumb for the post-wedge lookback; the snapshot() call below
      // additionally persists the gauges via the orchestrator's onSnapshot hook.
      console.log(
        formatCvdiag({
          component: "browser-pool:degraded",
          boundary: "als-snapshot",
          status: "error",
          error: `set-empty waiters=${this.waiters.length} browserCount=${this.browserCount}`,
        }),
      );
      // FULL durable snapshot at the degraded transition — the headline
      // forensic moment. This MUST land in PB: the wedge ends in a restart that
      // clears in-memory state, so the degraded-instant gauges are otherwise
      // unretrievable.
      this.snapshot("degraded");
      this.safeHook(this.onDegraded, "onDegraded");
    }
    this.startSelfHeal();
  }

  /**
   * FIX #2 (self-heal half) — background loop that keeps trying to relaunch a
   * fresh browser set after the set has emptied. Each iteration attempts to
   * launch `browserCount` browsers (through the stagger gate); the FIRST
   * successful launch is enough to revive capacity — it is pushed as a live
   * entry and queued waiters are drained onto it, then the loop tops the set
   * back up to `browserCount`. On a fully-failed iteration it waits
   * `selfHealIntervalMs` and retries, until success or shutdown. On recovery it
   * clears `degraded` and fires `onRecovered`. Guarded by `selfHealing` so only
   * one loop runs at a time.
   *
   * CIRCUIT-BREAKER (the durable fix for the RECURRING wedge): the unfixed loop
   * just RELAUNCHED into the same wedged state forever — when chromium is in a
   * launch-crash-loop (`browserType.launch: ...has been closed`) every relaunch
   * throws identically and the loop never escapes (the wedge is the cgroup
   * PID/thread ceiling, which an immediate relaunch only re-pins). Now, after
   * `selfHealHardRecoveryThreshold` CONSECUTIVE launch failures, the loop stops
   * looping identical relaunches and performs a HARD recovery — a PACED cold
   * relaunch (NO `/tmp` purge — see hardRecover) — then cold-launches fresh into
   * a kernel given time to relax. A single successful launch
   * resets the failure counter. If `selfHealMaxHardRecoveries` consecutive HARD
   * recoveries ALSO revive nothing, it fires the LOUD `pool-unrecoverable` alarm
   * and stops (a redeploy is genuinely required) rather than spinning silently.
   */
  private startSelfHeal(): void {
    if (this.selfHealing) return;
    this.selfHealing = true;
    const loop = (async () => {
      // Circuit-breaker counters, carried ACROSS iterations: consecutive launch
      // failures (reset by ANY successful launch) trip the hard recovery;
      // consecutive failed hard recoveries (reset by any successful launch) trip
      // the unrecoverable alarm.
      let consecutiveFailures = 0;
      let consecutiveHardRecoveries = 0;
      // Keep iterating until the set is restored to FULL strength
      // (`browserCount`), not merely non-empty. The unfixed loop broke + fired
      // onRecovered the instant ONE browser revived, even though the pool target
      // is `browserCount` — silently reporting green while under-provisioned. We
      // top the set up across iterations (each iteration relaunches the
      // remaining shortfall, backing off between failed iterations) and only
      // fire onRecovered once at full strength.
      while (!this.isShutdown && this.browsers.length < this.browserCount) {
        let launchedAny = false;
        const shortfall = this.browserCount - this.browsers.length;
        for (let i = 0; i < shortfall; i++) {
          if (this.isShutdown) break;
          // BREAKER: before attempting another identical relaunch, check whether
          // we have already failed `selfHealHardRecoveryThreshold` times in a
          // row. If so, escape the relaunch-into-the-same-wedge loop and HARD
          // recover (paced cold relaunch — give the kernel time to relax; NO
          // /tmp purge) so the NEXT launch is cold.
          if (
            this.selfHealHardRecoveryThreshold > 0 &&
            consecutiveFailures >= this.selfHealHardRecoveryThreshold
          ) {
            consecutiveFailures = 0;
            consecutiveHardRecoveries++;
            await this.hardRecover(consecutiveHardRecoveries);
            if (this.isShutdown) break;
            // Even the paced cold relaunch could not break the wedge after K
            // tries — give up LOUDLY rather than spinning forever.
            if (
              this.selfHealMaxHardRecoveries > 0 &&
              consecutiveHardRecoveries >= this.selfHealMaxHardRecoveries
            ) {
              this.fireUnrecoverable();
              return;
            }
          }
          try {
            const fresh = await this.launchBrowser();
            if (this.isShutdown) {
              await this.closeBrowser(fresh, this.browsers.length);
              break;
            }
            const revived: BrowserEntry = {
              browser: fresh,
              liveContexts: new Set(),
              servedContexts: 0,
              recycling: false,
              pendingOpens: 0,
              recyclePending: false,
              generation: 0,
            };
            this.browsers.push(revived);
            this.attachDisconnectHandler(revived, fresh);
            launchedAny = true;
            // A launch succeeded — the wedge (if any) is broken. Reset BOTH
            // breaker counters so a future re-empty starts the breaker fresh.
            consecutiveFailures = 0;
            consecutiveHardRecoveries = 0;
            // Drain queued waiters onto the revived browser as capacity returns.
            while (
              this.waiters.length > 0 &&
              this.liveContextCount < this.maxContexts &&
              fresh.isConnected()
            ) {
              const before = this.waiters.length;
              await this.serveNextWaiter();
              if (this.waiters.length >= before) break;
            }
          } catch (err) {
            consecutiveFailures++;
            this.logger?.warn?.("browser-pool.self-heal-launch-failed", {
              attemptIndex: i,
              consecutiveFailures,
              hardRecoveryThreshold: this.selfHealHardRecoveryThreshold,
              error: err instanceof Error ? err.message : String(err),
            });
            // EARLY WARNING: a self-heal launch just failed — capture a FULL
            // DURABLE snapshot so a `pthread_create` EAGAIN at this point
            // correlates to a measured `pids.current` near `pids.max` (the
            // proven wedge) AND survives the wedge→restart in PB. This is the
            // repeating signal (28× in ~19s observed) that is most often lost to
            // the Railway stdout window — durable persistence is the point.
            this.snapshot("self-heal-launch-failed");
          }
        }
        if (this.browsers.length >= this.browserCount) {
          // FULL capacity restored — clear degraded + signal recovery exactly
          // once at full strength.
          break;
        }
        // The set is not yet at full strength. If NOTHING launched this
        // iteration, back off before retrying so we keep pacing relaunches into
        // a still-exhausted kernel instead of busy-spinning. If SOME launched
        // (partial recovery) loop straight back to top up the remainder, but
        // still yield a macrotask so the loop stays cancellable.
        if (!launchedAny && !this.isShutdown && this.selfHealIntervalMs > 0) {
          await this.delayOrShutdown(this.selfHealIntervalMs);
        } else if (!this.isShutdown) {
          // Interval-0 path OR partial-progress iteration: yield a REAL
          // macrotask so the loop is cancellable and does not starve other
          // timers (a microtask yield would not let pending setTimeouts run).
          await delay(0);
        }
      }
      // Fire recovery iff we actually came back up (full strength) and were not
      // torn down. A shutdown-aborted loop must NOT report recovery.
      if (!this.isShutdown && this.browsers.length >= this.browserCount) {
        this.degraded = false;
        this.logger?.info("browser-pool.self-heal-recovered", {
          browsers: this.browsers.length,
          browserCount: this.browserCount,
          waiters: this.waiters.length,
        });
        // CVDIAG: self-heal brought the set back to full strength — bookends
        // the degraded breadcrumb so the recovery window is reconstructable.
        console.log(
          formatCvdiag({
            component: "browser-pool:recovered",
            boundary: "als-snapshot",
            status: "ok",
            error: `browsers=${this.browsers.length} waiters=${this.waiters.length}`,
          }),
        );
        // FULL durable snapshot at the recovered transition — bookends the
        // degraded snapshot so the resource delta across the recovery window is
        // reconstructable.
        this.snapshot("recovered");
        this.safeHook(this.onRecovered, "onRecovered");
      }
      this.selfHealing = false;
    })();
    // Track the self-heal loop so shutdown() awaits it (it checks isShutdown and
    // exits promptly). Route any unexpected throw to the logger.
    this.inFlightRecycles.add(loop);
    loop
      .catch((err: unknown) => {
        this.logger?.error?.("browser-pool.self-heal-failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        // CVDIAG: the self-heal loop itself threw — the pool may be left
        // degraded with no active heal path. Surface the swallowed error.
        console.log(
          formatCvdiag({
            component: "browser-pool:self-heal-failed",
            boundary: "als-snapshot",
            status: "error",
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      })
      .finally(() => {
        this.selfHealing = false;
        this.inFlightRecycles.delete(loop);
      });
  }

  /**
   * CIRCUIT-BREAKER hard-recovery step. Invoked by the self-heal loop after
   * `selfHealHardRecoveryThreshold` consecutive launch failures — the signal
   * that the loop is stuck relaunching into a wedged chromium. The PROVEN wedge
   * is cgroup PID/thread-ceiling exhaustion, which a `/tmp` purge does NOT fix
   * (that ceiling is platform-fixed and demand-side), so the hard recovery is
   * simply a PACED cold relaunch: it backs the loop off (`delayOrShutdown`) to
   * give the thread-exhausted kernel time to relax before the next cold launch,
   * rather than hammering it. Stays promptly cancellable on shutdown.
   */
  private async hardRecover(attempt: number): Promise<void> {
    if (this.isShutdown) return;
    this.logger?.error?.("browser-pool.self-heal-hard-recovery", {
      attempt,
      maxHardRecoveries: this.selfHealMaxHardRecoveries,
      hardRecoveryThreshold: this.selfHealHardRecoveryThreshold,
    });
    // Pace the cold-launch retry into the (hopefully now-unwedged) kernel.
    if (!this.isShutdown && this.selfHealIntervalMs > 0) {
      await this.delayOrShutdown(this.selfHealIntervalMs);
    }
  }

  /**
   * CIRCUIT-BREAKER give-up step. Invoked when `selfHealMaxHardRecoveries`
   * consecutive HARD recoveries (paced cold relaunches) have ALL failed to
   * revive a single browser — the wedge survived every relaunch, so a redeploy
   * is genuinely required (the PROVEN cgroup PID/thread ceiling is not
   * relaxing). Emits the LOUD `pool-unrecoverable` alarm (the operator signal
   * the old silent-spin path never sent), carrying the measured cgroup
   * `pids.current`/`pids.max` + thread count so the alert NAMES the real signal,
   * and lets the heal loop exit instead of spinning forever.
   *
   * ONCE-PER-EPISODE is guaranteed STRUCTURALLY, not by an instance latch: each
   * distinct degraded episode spawns its OWN self-heal loop (`startSelfHeal` is
   * gated only by `selfHealing`, which the prior loop clears on exit), the
   * loop-local `consecutiveHardRecoveries` counter resets per spawn, and the
   * loop `return`s the instant this fires — so it cannot double-fire within one
   * loop, and a later set re-empty re-spawns a loop that can fire its OWN alarm.
   * A prior buggy instance latch (`this.unrecoverable`, cleared ONLY on a
   * successful launch) silenced every SUBSEQUENT episode of a permanently-wedged
   * container that re-emptied after the first give-up — the exact silent-spin
   * this breaker exists to kill. The latch was removed so each episode alarms.
   */
  private fireUnrecoverable(): void {
    // Sample the OS gauges at the moment of give-up so the alarm NAMES the
    // proven wedge signal (cgroup pids.current near pids.max + thread demand)
    // rather than reporting only the abstract breaker counters. Best-effort: a
    // sampling failure degrades the gauge fields to -1, never blocks the alarm.
    let cgroupPidsCurrent = -1;
    let cgroupPidsMax = -1;
    let treeThreadCount = -1;
    try {
      const g = sampleResourceGauges();
      cgroupPidsCurrent = g.cgroupPidsCurrent;
      cgroupPidsMax = g.cgroupPidsMax;
      treeThreadCount = g.treeThreadCount;
    } catch {
      // gauge sampling is best-effort; leave the -1 defaults.
    }
    const info: BrowserPoolUnrecoverableInfo = {
      browserCount: this.browserCount,
      waiters: this.waiters.length,
      maxHardRecoveries: this.selfHealMaxHardRecoveries,
      cgroupPidsCurrent,
      cgroupPidsMax,
      treeThreadCount,
    };
    this.logger?.error?.("browser-pool.pool-unrecoverable", { ...info });
    // CVDIAG: terminal give-up — the circuit breaker exhausted every hard
    // recovery and a redeploy is required. The single most important pool
    // breadcrumb; names the proven cgroup-PID wedge signal in `error`.
    console.log(
      formatCvdiag({
        component: "browser-pool:unrecoverable",
        boundary: "als-snapshot",
        status: "error",
        error: `give-up pids=${cgroupPidsCurrent}/${cgroupPidsMax} threads=${treeThreadCount} waiters=${this.waiters.length}`,
      }),
    );
    // FULL durable snapshot at the TERMINAL give-up — the single most important
    // forensic row. The pool is dead and a redeploy is required; this MUST be in
    // PB because the redeploy clears everything in-memory and the stdout window
    // will have long rolled off by the time an operator looks.
    this.snapshot("unrecoverable");
    // Best-effort hook (mirrors safeHook) — passes the breaker counters so the
    // operator alarm can describe how hard the pool tried before giving up.
    if (this.onUnrecoverable) {
      try {
        this.onUnrecoverable(info);
      } catch (err) {
        this.logger?.error?.("browser-pool.hook-failed", {
          hook: "onUnrecoverable",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /**
   * Invoke a best-effort lifecycle hook (`onDegraded` / `onRecovered`) without
   * letting a throwing hook crash the pool. A hook failure is logged, not
   * propagated. (`onUnrecoverable` is invoked inline in `fireUnrecoverable`
   * because it takes a counters argument.)
   */
  private safeHook(hook: (() => void) | undefined, name: string): void {
    if (!hook) return;
    try {
      hook();
    } catch (err) {
      this.logger?.error?.("browser-pool.hook-failed", {
        hook: name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
