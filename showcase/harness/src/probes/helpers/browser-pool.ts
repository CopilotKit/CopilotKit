import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser, BrowserContext } from "playwright";

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
 * different to escape (stale `/tmp/playwright_*` profile dirs / accumulated
 * FD-shm pressure on the long-lived container persist across every relaunch).
 * `acquire()` therefore has no contexts forever → blocks to timeout fleet-wide.
 * Only a container RESTART cleared it — reactive, not durable.
 *
 * The breaker makes the self-heal loop ESCAPE: after
 * `selfHealHardRecoveryThreshold` CONSECUTIVE self-heal launch failures, instead
 * of looping another identical relaunch the pool performs a HARD recovery —
 * purges the stale `/tmp/playwright_*` profile/temp dirs the wedged chromium
 * processes left behind (the FD-shm/profile pressure that keeps every fresh
 * launch crashing) — then cold-launches fresh. Any successful launch resets the
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
 * Glob-free prefix of the per-launch profile/temp dirs Playwright's chromium
 * leaves under the OS temp dir. The default chromium launcher does not pin a
 * `userDataDir`, so each launch creates an ephemeral `playwright_*` (and
 * related `playwright-artifacts-*`) directory; a crash-looping container
 * accumulates these and the FD/shm/inode pressure keeps every fresh launch
 * crashing. The hard-recovery purge removes them so a cold launch starts clean.
 */
const PLAYWRIGHT_TMP_PREFIXES = ["playwright_", "playwright-artifacts-"];

/**
 * Default profile/temp-dir purge used by the self-heal hard-recovery path.
 * Best-effort: removes every `${tmpdir()}/playwright_*` (and
 * `playwright-artifacts-*`) directory the wedged chromium processes left behind.
 * Injectable via `BrowserPoolOptions.purgeProfileDirs` so tests can drive the
 * breaker without touching the real filesystem and assert it fired. A failure to
 * read the temp dir or unlink an entry is swallowed (the dir may not exist, or
 * be owned by another process) — the purge is a hygiene best-effort, not a
 * correctness dependency.
 */
async function defaultPurgeProfileDirs(): Promise<number> {
  const dir = tmpdir();
  let removed = 0;
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return 0;
  }
  for (const name of entries) {
    if (!PLAYWRIGHT_TMP_PREFIXES.some((p) => name.startsWith(p))) continue;
    try {
      await fs.rm(join(dir, name), { recursive: true, force: true });
      removed++;
    } catch {
      // best-effort: another process may own it, or it vanished mid-purge.
    }
  }
  return removed;
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
 * Purges the stale per-launch profile/temp dirs a crash-looping chromium leaves
 * behind, returning the count removed. The default implementation removes
 * `${tmpdir()}/playwright_*`. Tests inject a fake so the self-heal
 * circuit-breaker's hard-recovery path is exercisable without touching the real
 * filesystem (and so the test can assert the purge fired).
 */
export type PurgeProfileDirs = () => Promise<number>;

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
  /** Global cap on concurrently-live contexts across all browsers. Default
   *  40 (env BROWSER_POOL_MAX_CONTEXTS) — covers D6 peak 32 + D5 peak 8.
   *  acquire() past this pends a waiter. */
  maxContexts?: number;
  /** Per-browser served-context hygiene threshold: once a browser has served
   *  >= recycleAfter contexts AND has no live contexts, it is recycled (its
   *  process is replaced) to bound memory/handle drift. Default 300 (env
   *  BROWSER_POOL_RECYCLE_AFTER). This is RARE — not the hot path. */
  recycleAfter?: number;
  logger?: PoolLogger;
  /** Injected launcher (tests). Defaults to the real chromium launcher. */
  launchBrowser?: LaunchBrowser;
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
   *  retrying the identical relaunch and performs a HARD recovery (purge stale
   *  profile/temp dirs, then cold-launch). Default 4 (env
   *  BROWSER_POOL_SELF_HEAL_HARD_RECOVERY_THRESHOLD). Tests pass a small value to
   *  trip the breaker deterministically. */
  selfHealHardRecoveryThreshold?: number;
  /** Number of CONSECUTIVE HARD recoveries that may fail to revive any browser
   *  before the pool gives up and fires the `pool-unrecoverable` alarm (instead
   *  of spinning forever). Default 3 (env
   *  BROWSER_POOL_SELF_HEAL_MAX_HARD_RECOVERIES). */
  selfHealMaxHardRecoveries?: number;
  /** Injected profile/temp-dir purge (tests). Defaults to removing
   *  `${tmpdir()}/playwright_*`. Invoked by the self-heal hard-recovery path. */
  purgeProfileDirs?: PurgeProfileDirs;
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
   * exhausted `selfHealMaxHardRecoveries` consecutive HARD recoveries (purge +
   * cold-launch) WITHOUT reviving a single browser — i.e. the wedge survived
   * even a profile-dir purge, so a redeploy is genuinely required. The
   * orchestrator wires this to a LOUD operator alert (the signal the old
   * silent-spin path never sent). Best-effort: a throwing hook is caught +
   * logged, never crashes the pool.
   */
  onUnrecoverable?: () => void;
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

  // Crash-recovery relaunch backpressure (fix #1) + self-heal (fix #2) policy.
  private readonly relaunchMaxRetries: number;
  private readonly relaunchBackoffMs: number;
  private readonly selfHealIntervalMs: number;
  // Self-heal circuit-breaker (the durable fix for the RECURRING wedge): trip a
  // HARD recovery (profile-dir purge + cold-launch) after this many consecutive
  // self-heal launch failures, and give up (loud alarm) after this many
  // consecutive failed HARD recoveries.
  private readonly selfHealHardRecoveryThreshold: number;
  private readonly selfHealMaxHardRecoveries: number;
  private readonly purgeProfileDirs: PurgeProfileDirs;
  private readonly onDegraded?: () => void;
  private readonly onRecovered?: () => void;
  private readonly onUnrecoverable?: () => void;
  // Latched once the circuit-breaker has fired `onUnrecoverable` so the alarm is
  // emitted exactly once per unrecoverable episode and the heal loop does not
  // re-enter the give-up path. Cleared when a hard recovery later succeeds.
  private unrecoverable = false;
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
    this.maxContexts =
      options.maxContexts ??
      (envMax !== undefined && !Number.isNaN(envMax) && envMax > 0
        ? envMax
        : 40);

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
    this.selfHealHardRecoveryThreshold = resolveNonNegative(
      options.selfHealHardRecoveryThreshold,
      process.env.BROWSER_POOL_SELF_HEAL_HARD_RECOVERY_THRESHOLD,
      DEFAULT_SELF_HEAL_HARD_RECOVERY_THRESHOLD,
    );
    this.selfHealMaxHardRecoveries = resolveNonNegative(
      options.selfHealMaxHardRecoveries,
      process.env.BROWSER_POOL_SELF_HEAL_MAX_HARD_RECOVERIES,
      DEFAULT_SELF_HEAL_MAX_HARD_RECOVERIES,
    );
    // Purge resolution: an explicit injected purge wins. Otherwise, when a fake
    // `launchBrowser` is injected (tests — the browsers are fakes, so there are
    // NO real `/tmp/playwright_*` dirs to scan/remove), default to a hermetic
    // no-op so the breaker's hard-recovery path never touches the real
    // filesystem under test. Only the production path (real chromium launcher,
    // no injected launcher) gets the real `${tmpdir()}/playwright_*` purge.
    this.purgeProfileDirs =
      options.purgeProfileDirs ??
      (this.injectedLaunchBrowser
        ? async (): Promise<number> => 0
        : defaultPurgeProfileDirs);
    this.onDegraded = options.onDegraded;
    this.onRecovered = options.onRecovered;
    this.onUnrecoverable = options.onUnrecoverable;
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
      this.logger?.info("browser-pool.acquire", {
        available: this.maxContexts - this.liveContextCount,
        inUse: this.liveContextCount,
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
        throw new Error("BrowserPool is shut down");
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
            throw new Error("BrowserPool is shut down");
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

    this.logger?.info("browser-pool.release", {
      available: this.maxContexts - this.liveContextCount,
      inUse: this.liveContextCount,
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
      servedContexts: entry.servedContexts,
      recycleAfter: this.recycleAfter,
      totalRecycles: this.totalRecycles,
    });

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
   * throws identically and the loop never escapes (the stale `/tmp/playwright_*`
   * profile dirs / FD-shm pressure persist across every attempt). Now, after
   * `selfHealHardRecoveryThreshold` CONSECUTIVE launch failures, the loop stops
   * looping identical relaunches and performs a HARD recovery — purges the stale
   * profile/temp dirs — then cold-launches fresh. A single successful launch
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
          // recover (purge stale profile/temp dirs) so the NEXT launch is cold.
          if (
            this.selfHealHardRecoveryThreshold > 0 &&
            consecutiveFailures >= this.selfHealHardRecoveryThreshold
          ) {
            consecutiveFailures = 0;
            consecutiveHardRecoveries++;
            await this.hardRecover(consecutiveHardRecoveries);
            if (this.isShutdown) break;
            // Even the purge could not break the wedge after K tries — give up
            // LOUDLY rather than spinning forever.
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
            // breaker counters and clear the unrecoverable latch so a future
            // re-empty starts the breaker fresh.
            consecutiveFailures = 0;
            consecutiveHardRecoveries = 0;
            this.unrecoverable = false;
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
      })
      .finally(() => {
        this.selfHealing = false;
        this.inFlightRecycles.delete(loop);
      });
  }

  /**
   * CIRCUIT-BREAKER hard-recovery step. Invoked by the self-heal loop after
   * `selfHealHardRecoveryThreshold` consecutive launch failures — the signal
   * that the loop is stuck relaunching into a wedged chromium (every
   * `chromium.launch()` throwing `...has been closed`). Purges the stale
   * `/tmp/playwright_*` profile/temp dirs the crash-looping processes left
   * behind (the FD-shm/profile pressure that keeps every fresh launch crashing)
   * so the next launch starts cold and clean. Best-effort: a purge failure is
   * logged, not thrown — the cold-launch retry still proceeds. The
   * `delayOrShutdown` after the purge paces the next attempt and stays promptly
   * cancellable on shutdown.
   */
  private async hardRecover(attempt: number): Promise<void> {
    if (this.isShutdown) return;
    this.logger?.error?.("browser-pool.self-heal-hard-recovery", {
      attempt,
      maxHardRecoveries: this.selfHealMaxHardRecoveries,
      hardRecoveryThreshold: this.selfHealHardRecoveryThreshold,
    });
    try {
      const removed = await this.purgeProfileDirs();
      this.logger?.info("browser-pool.self-heal-profile-purge", {
        attempt,
        removed,
      });
    } catch (err) {
      this.logger?.warn?.("browser-pool.self-heal-profile-purge-failed", {
        attempt,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    // Pace the cold-launch retry into the (hopefully now-unwedged) kernel.
    if (!this.isShutdown && this.selfHealIntervalMs > 0) {
      await this.delayOrShutdown(this.selfHealIntervalMs);
    }
  }

  /**
   * CIRCUIT-BREAKER give-up step. Invoked when `selfHealMaxHardRecoveries`
   * consecutive HARD recoveries (purge + cold-launch) have ALL failed to revive
   * a single browser — the wedge survived even a profile-dir purge, so a
   * redeploy is genuinely required. Emits the LOUD `pool-unrecoverable` alarm
   * (the operator signal the old silent-spin path never sent) exactly once per
   * episode (latched via `unrecoverable`) and lets the heal loop exit instead of
   * spinning forever. A later set-empty event re-spawns the heal loop
   * (`onBrowserSetEmpty` is unconditional); the latch is cleared by the first
   * successful launch so a subsequent genuine recovery re-arms the breaker.
   */
  private fireUnrecoverable(): void {
    if (this.unrecoverable) return;
    this.unrecoverable = true;
    this.logger?.error?.("browser-pool.pool-unrecoverable", {
      browserCount: this.browserCount,
      waiters: this.waiters.length,
      maxHardRecoveries: this.selfHealMaxHardRecoveries,
    });
    this.safeHook(this.onUnrecoverable, "onUnrecoverable");
  }

  /**
   * Invoke a best-effort lifecycle hook (`onDegraded` / `onRecovered` /
   * `onUnrecoverable`) without letting a throwing hook crash the pool. A hook
   * failure is logged, not propagated.
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
