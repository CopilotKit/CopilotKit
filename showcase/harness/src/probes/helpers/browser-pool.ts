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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
}

export interface BrowserPoolOptions {
  /** Number of long-lived browser processes in the fixed set. Default 3
   *  (env BROWSER_POOL_BROWSERS, legacy fallback BROWSER_POOL_SIZE). */
  browsers?: number;
  /** Global cap on concurrently-live contexts across all browsers. Default
   *  24 (env BROWSER_POOL_MAX_CONTEXTS). acquire() past this pends a waiter. */
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
  private readonly logger?: PoolLogger;
  private readonly injectedLaunchBrowser?: LaunchBrowser;

  // Launch-serialization gate. Every chromium launch — init fill, crash
  // recovery, hygiene recycle — is funneled through `launchBrowser`, which
  // chains onto `launchChain` so strictly ONE launch runs at a time and a
  // `launchStaggerMs` delay elapses after each settles before the next
  // starts.
  private readonly launchStaggerMs: number;
  private launchChain: Promise<unknown> = Promise.resolve();

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
   */
  private launchBrowser = (): Promise<Browser> => {
    const gate = this.launchChain;
    const result = gate.then(() => this.rawLaunchBrowser());
    this.launchChain = result
      .catch(() => undefined)
      .then(() =>
        this.launchStaggerMs > 0 ? delay(this.launchStaggerMs) : undefined,
      );
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
   * Pick the live browser with the fewest live contexts. Skips entries that
   * are recycling or whose browser has disconnected — acquire() must never
   * open a context on a dying browser. Returns undefined when no live browser
   * is available (caller enqueues a waiter; crash recovery fulfills it).
   */
  private pickLeastLoaded(): BrowserEntry | undefined {
    let best: BrowserEntry | undefined;
    for (const entry of this.browsers) {
      if (entry.recycling) continue;
      if (!entry.browser.isConnected()) continue;
      if (
        best === undefined ||
        entry.liveContexts.size < best.liveContexts.size
      ) {
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
    const browserBefore = entry.browser;
    entry.pendingOpens++;

    let context: BrowserContext;
    try {
      context = await browserBefore.newContext({
        extraHTTPHeaders: {
          "X-AIMock-Strict": "true",
          ...options?.extraHTTPHeaders,
        },
      });
    } catch (err) {
      // The open failed — give the reserved slot back so it does not bleed
      // capacity permanently, and clear the in-flight marker.
      entry.pendingOpens--;
      this.releaseReservation();
      throw err;
    }

    // BELT-AND-SUSPENDERS for the recycle-vs-open race: the entry may have been
    // recycled (crash recovery or a hygiene recycle that fired before this
    // counter was consulted) WHILE the newContext() above was in flight. If so
    // the freshly-opened context is an orphan on a torn-down browser — closing
    // or otherwise counting it would corrupt the cap and could hand a dead
    // context to a holder. Detect that state, close the orphan, roll back the
    // reservation + the in-flight marker, and surface as a failure so the
    // caller's retry/enqueue path handles it.
    if (
      entry.recycling ||
      entry.browser !== browserBefore ||
      !browserBefore.isConnected()
    ) {
      entry.pendingOpens--;
      this.releaseReservation();
      void context.close().catch(() => {});
      this.logger?.warn?.("browser-pool.open-orphaned-by-recycle", {
        browserIndex: this.browsers.indexOf(entry),
      });
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
      // The browser died between pickLeastLoaded and newContext. openContextOn
      // already rolled the reservation back on failure, so RE-RESERVE before
      // the retry — this keeps the retry path cap-correct instead of opening a
      // context with no reservation behind it.
      this.logger?.warn?.("browser-pool.acquire-newcontext-failed", {
        browserIndex: this.browsers.indexOf(entry),
        error: err instanceof Error ? err.message : String(err),
      });
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
   * recovery relaunch serves it later). A newContext failure kicks the
   * browser's recycle and re-queues the waiter at the FRONT so ordering is
   * preserved.
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
      this.logger?.warn?.("browser-pool.serve-waiter-failed", {
        browserIndex: this.browsers.indexOf(entry),
        error: err instanceof Error ? err.message : String(err),
      });
      // openContextOn already rolled the reservation back on failure. Re-queue
      // at the front so FIFO order is preserved, then recycle the dead browser.
      // Its relaunch handoff re-attempts the queued waiters (which re-reserve).
      this.waiters.unshift(waiter);
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
      this.releaseReservation();
      void context.close().catch(() => {});
      this.logger?.warn?.("browser-pool.serve-waiter-orphan-closed", {
        browserIndex: this.browsers.indexOf(entry),
      });
      if (this.waiters.length > 0) this.scheduleServeNextWaiter();
      return;
    }

    waiter.resolve(context);
  }

  async release(context: BrowserContext): Promise<void> {
    if (this.isShutdown) {
      // Best-effort close; nothing to track post-shutdown.
      await context.close().catch(() => {});
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

    // Hygiene-recycle decision, captured SYNCHRONOUSLY against current state
    // (no await gap above could have mutated liveContexts since the decrement).
    // `isEntryRecyclable` consults BOTH liveContexts AND pendingOpens, so an
    // in-flight open keeps the entry off the recycle path even though it isn't
    // yet in liveContexts.
    const shouldRecycle =
      entry.servedContexts >= this.recycleAfter &&
      this.isEntryRecyclable(entry);

    // Close the released context AFTER the accounting/decision so the close
    // await cannot straddle them. Best-effort; failure is non-fatal.
    await context.close().catch(() => {});

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

    // Hygiene recycle: once a browser has served enough contexts AND is idle
    // (no live contexts, no in-flight opens), replace its process to bound
    // memory/handle drift. This is the RARE path — it fires at most once per
    // `recycleAfter` contexts per browser and never on a busy browser.
    //
    // The `!hadWaiter` guard (a prior fix) defers the recycle when a waiter was
    // just served onto this freed slot, so the browser is not torn down under
    // the just-served waiter. But under SUSTAINED saturation a waiter is queued
    // at nearly every release, so on its own that guard STARVES the hygiene
    // recycle — the documented memory/handle-drift bound is never met exactly
    // when it matters. We close that without reintroducing the serve-vs-recycle
    // race by carrying the deferred intent on `entry.recyclePending`:
    //
    //   - if shouldRecycle this round but a waiter was served, set the flag and
    //     defer (do not recycle now);
    //   - on EVERY release, if the entry is now genuinely recyclable (idle, no
    //     pending opens, not already recycling) AND either shouldRecycle this
    //     round OR a recycle is pending, fire it and clear the flag.
    //
    // Serving a waiter is asynchronous (`serveNextWaiter` reserves + opens on
    // the next tick), so right after a serve the entry is NOT idle — either a
    // live context exists or `pendingOpens > 0` — and `isEntryRecyclable`
    // returns false, naturally deferring to the next genuinely-idle release.
    if (shouldRecycle && hadWaiter) {
      entry.recyclePending = true;
    }
    if (
      this.isEntryRecyclable(entry) &&
      (shouldRecycle || entry.recyclePending)
    ) {
      entry.recyclePending = false;
      this.recycleBrowser(entry, "hygiene");
    }
  }

  async shutdown(): Promise<void> {
    this.isShutdown = true;

    // Reject any queued waiters.
    for (const waiter of this.waiters) {
      waiter.reject(new Error("BrowserPool is shutting down"));
    }
    this.waiters = [];

    // Wait for in-flight recycles to finish before closing everything.
    if (this.inFlightRecycles.size > 0) {
      await Promise.allSettled(Array.from(this.inFlightRecycles));
    }

    // Close every live context, then every browser. Route through closeBrowser
    // so a close failure is logged with its browser index.
    const contextClosers = Array.from(this.contextToBrowser.keys()).map((c) =>
      c.close().catch(() => {}),
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

    const oldBrowser = entry.browser;

    const recyclePromise = (async () => {
      await this.closeBrowser(oldBrowser, browserIdx);

      if (this.isShutdown) return;

      try {
        const fresh = await this.launchBrowser();
        if (this.isShutdown) {
          await this.closeBrowser(fresh, this.browsers.indexOf(entry));
          return;
        }
        entry.browser = fresh;
        entry.servedContexts = 0;
        entry.liveContexts.clear();
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
        // Launch failed — evict the entry so it does not masquerade as live
        // capacity. If the browser set is now empty and waiters are queued,
        // reject them all (no process can serve them).
        this.logger?.error?.("browser-pool.recycle-relaunch-failed", {
          browserIndex: this.browsers.indexOf(entry),
          error: err instanceof Error ? err.message : String(err),
        });
        const idx = this.browsers.indexOf(entry);
        if (idx !== -1) this.browsers.splice(idx, 1);
        if (this.browsers.length === 0 && this.waiters.length > 0) {
          for (const waiter of this.waiters) {
            waiter.reject(new Error("BrowserPool has no live browsers"));
          }
          this.waiters = [];
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
}
