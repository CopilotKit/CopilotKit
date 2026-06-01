import type { Browser } from "playwright";

interface Slot {
  browser: Browser;
  contextCount: number;
  /**
   * True when this slot's last relaunch attempt failed and the slot is
   * currently holding a dead browser. A pending slot is kept in
   * `this.slots` (so capacity is not permanently lost) but is NOT placed
   * in `available` — `acquire()` lazily re-launches it on demand.
   */
  relaunchPending?: boolean;
}

/**
 * Number of immediate relaunch attempts (with backoff between them) a
 * recycle makes before giving up and leaving the slot in the
 * `relaunchPending` state for a later lazy retry. A single transient
 * chromium launch failure (OOM spike, fd exhaustion) must not
 * permanently shrink the pool, so we retry rather than evict.
 */
const RELAUNCH_MAX_ATTEMPTS = 3;

/** Base backoff between relaunch attempts; doubles each attempt. */
const RELAUNCH_BACKOFF_BASE_MS = 250;

/**
 * Default delay the launch-serialization gate waits AFTER each chromium
 * launch settles before the next launch may start. Tunable on staging via
 * the `BROWSER_LAUNCH_STAGGER_MS` env var without a code change.
 *
 * WHY: the harness drives chromium launches in BURSTS (initial pool fill,
 * recycle relaunches, lazy relaunchPending recovery, reinit backstop). Each
 * headless chromium spawns ~50 PIDs (threads count against the container's
 * ~1000-PID ceiling), so a burst of many simultaneous `chromium.launch()`
 * calls transiently spikes PID demand far above the eventual steady state and
 * trips `pthread_create: Resource temporarily unavailable (11)` /
 * "Zygote could not fork" — every browser fails to launch and a d6 run goes
 * 0/18. Funneling every launch through a concurrency-1 gate with a stagger
 * spaces the spawns so the transient spike never exceeds the ceiling, WITHOUT
 * reducing the eventual pool size. Cold-start pays a one-time warm cost; the
 * pool warms once and steady-state acquires are instant.
 */
const DEFAULT_BROWSER_LAUNCH_STAGGER_MS = 150;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Waiter {
  resolve: (browser: Browser) => void;
  reject: (err: Error) => void;
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

export class BrowserPool {
  private readonly poolSize: number;
  private readonly recycleAfter: number;
  private slots: Slot[] = [];
  private available: Slot[] = [];
  private waiters: Waiter[] = [];
  private totalRecycles = 0;
  private inFlightRecycles = new Set<Promise<void>>();
  private recyclingSlots = new Set<Slot>();
  // Re-entry guard for the relaunchPending recovery path. A slot is marked
  // here while its lazy relaunch is in flight so two concurrent invocations
  // (an acquire()-driven relaunch racing a late `disconnected` fire that
  // re-enters recycleSlot for the same slot) cannot both launch a browser for
  // the same slot — which would leak one process and/or publish the slot to
  // `available` twice.
  private relaunchingSlots = new Set<Slot>();
  // Re-entry guard for the empty-pool reinit backstop, mirroring the
  // relaunchingSlots/recyclingSlots idiom. Two concurrent acquire() calls
  // against a truly-empty pool (this.slots.length === 0) would each drive
  // reinit() and each launch up to poolSize browsers — overshooting capacity.
  // Setting this synchronously before reinit's first await makes the second
  // acquire skip reinit and fall through to the waiter queue, where the first
  // reinit's handOff serves it. Cleared in a finally so a thrown reinit can't
  // wedge the guard set forever.
  private reiniting = false;
  private isShutdown = false;
  private readonly logger?: PoolLogger;
  private readonly injectedLaunchBrowser?: LaunchBrowser;

  // Launch-serialization gate. Every chromium launch — no matter which path
  // triggers it (init fill, acquire-time relaunch, recycle relaunch, reinit
  // backstop, deferred/pending relaunch) — is funneled through `launchBrowser`,
  // which chains onto `launchChain` so strictly ONE launch runs at a time and a
  // `launchStaggerMs` delay elapses after each settles before the next starts.
  private readonly launchStaggerMs: number;
  // Tail of the serialized-launch promise chain. Each gated launch awaits the
  // current tail, runs, staggers, then becomes the new tail — so launches run
  // one-at-a-time in arrival order. Rejections are swallowed on the CHAIN
  // (`.catch`) so one failed launch never poisons the queue; the real result
  // (value or throw) is still surfaced to that launch's own caller.
  private launchChain: Promise<unknown> = Promise.resolve();

  // Tracks which Browser instance maps to which Slot, so release() can find
  // the slot in O(1) even after the slot was removed from `available`.
  private browserToSlot = new Map<Browser, Slot>();

  // Slots whose browser is currently handed out to a caller (acquire's
  // available-scan return, or a handOff that resolved a waiter). A slot enters
  // this set exactly when its browser is delivered to a holder and leaves it
  // exactly when that holder releases it (or the slot is recycled). It is the
  // idempotency anchor for release(): a release() whose slot is NOT in this set
  // is a double/foreign return and must be a no-op, so the same live browser
  // can never be handed to two waiters via handOff's unguarded waiter branch.
  // It also backs `stats().inUse` directly (the count of checked-out slots),
  // which is more precise than the prior `liveSlots - available` subtraction.
  private checkedOut = new Set<Slot>();

  constructor(
    size = 4,
    recycleAfter?: number,
    logger?: PoolLogger,
    launchBrowser?: LaunchBrowser,
    launchStaggerMs?: number,
  ) {
    this.poolSize = size;
    this.logger = logger;
    this.injectedLaunchBrowser = launchBrowser;
    const envRecycle = process.env.BROWSER_POOL_RECYCLE_AFTER
      ? parseInt(process.env.BROWSER_POOL_RECYCLE_AFTER, 10)
      : undefined;
    this.recycleAfter =
      recycleAfter ??
      (envRecycle !== undefined && !Number.isNaN(envRecycle)
        ? envRecycle
        : 100);

    // Explicit constructor arg (tests inject a tiny value to stay fast) wins;
    // otherwise the env var (staging tuning) wins; otherwise the default. A
    // negative or non-numeric value — from EITHER source — falls back to the
    // default rather than disabling the stagger silently. (Disabling the
    // stagger reintroduces the launch-burst PID spike the gate exists to
    // prevent.) Note that an explicit `0` IS valid and intentionally disables
    // the wait (tests rely on it); only negative/NaN args are rejected.
    const envStagger = process.env.BROWSER_LAUNCH_STAGGER_MS
      ? parseInt(process.env.BROWSER_LAUNCH_STAGGER_MS, 10)
      : undefined;
    const validExplicit =
      launchStaggerMs !== undefined &&
      !Number.isNaN(launchStaggerMs) &&
      launchStaggerMs >= 0
        ? launchStaggerMs
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
      for (let i = 0; i < this.poolSize; i++) {
        const browser = await this.launchBrowser();
        const slot: Slot = { browser, contextCount: 0 };
        this.slots.push(slot);
        this.available.push(slot);
        this.browserToSlot.set(browser, slot);
        this.attachDisconnectHandler(slot, browser);
      }
    } catch (err) {
      // A mid-fill launch failure (the PID-ceiling pthread_create EAGAIN /
      // "Zygote could not fork" this gate exists to survive) must not leak the
      // browsers already launched on iterations 0..N-1: callers see a rejected
      // init() and commonly never call shutdown(), so those live chromium
      // processes would leak permanently and accelerate PID exhaustion. Reset
      // the pool's internal state BEFORE closing (so a `disconnected` fire from
      // a close cannot re-enter the recycle path via the slot's disconnect
      // handler — same ordering shutdown() relies on), then close each launched
      // browser (closeBrowser logs its own failures) and re-throw to preserve
      // init()'s reject-on-failure contract.
      const launched = this.slots;
      this.slots = [];
      this.available = [];
      this.browserToSlot.clear();
      await Promise.allSettled(
        launched.map((slot, idx) => this.closeBrowser(slot.browser, idx)),
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
   * The single launch seam every pool path routes through (init fill,
   * acquire-time relaunch, recycle relaunch, reinit backstop, lazy
   * relaunchPending recovery). It chains onto `launchChain` so that AT MOST
   * ONE `rawLaunchBrowser()` is in flight at a time across the whole pool, and
   * a `launchStaggerMs` delay elapses after each launch settles before the
   * next one begins. This spaces chromium process spawns so a burst never
   * spikes PID demand past the container ceiling (`pthread_create` EAGAIN /
   * "Zygote could not fork"), WITHOUT reducing the eventual pool size.
   *
   * The caller's `result` resolves the instant `rawLaunchBrowser()` settles —
   * the stagger does NOT delay the launch's own caller (it must get its
   * browser as soon as the process is up). The stagger instead gates only the
   * NEXT launch: the chain tail (`launchChain`) is advanced to a promise that
   * resolves `launchStaggerMs` AFTER this launch settled, so the following
   * gated launch cannot begin its `rawLaunchBrowser()` until that window
   * elapses. The chain swallows failures (`.catch`) so one failed launch does
   * not poison the queue for subsequent launches; the failing launch's own
   * caller still receives the rejection via the returned `result` promise. The
   * stagger applies whether the launch resolved or threw — a failed launch is
   * just as PID-costly to retry, so the next one must be spaced too.
   */
  private launchBrowser = (): Promise<Browser> => {
    // `gate` is the prior tail: this launch's rawLaunchBrowser() waits for it,
    // guaranteeing concurrency 1. We capture it before reassigning the tail.
    const gate = this.launchChain;
    const result = gate.then(() => this.rawLaunchBrowser());
    // Advance the tail to "this launch settled (ok or not), THEN staggered".
    // The next launch chains off THIS, so it cannot start until the stagger
    // window after this launch settles. `.catch` keeps a thrown launch from
    // breaking the chain; the throw is still surfaced to `result`'s caller.
    this.launchChain = result
      .catch(() => undefined)
      .then(() =>
        this.launchStaggerMs > 0 ? delay(this.launchStaggerMs) : undefined,
      );
    return result;
  };

  /**
   * Single waiter-first handoff used by every slot-recovery path (reinit,
   * recycle success, relaunchPendingSlots) AND by release(). A freshly
   * launched (or just-released) browser must go to a queued waiter if one
   * exists — otherwise the waiter is stranded until its acquire timeout while
   * a live browser sits idle in `available`. Only when there is no waiter
   * does the slot land in `available` (guarded by `includes` so a slot is
   * never published twice).
   *
   * Liveness gate: the acquire() available-scan recycles a zombie
   * (`!isConnected()`) before handing it out, but the waiter-served path
   * historically did not — so a browser that silently disconnected in the
   * window between launch/release and this handoff could be delivered to a
   * waiting probe. Before resolving a waiter (or publishing to `available`),
   * check `isConnected()`. If the browser is dead, do NOT hand it out: leave
   * the waiter QUEUED (so a live browser serves it) and route the slot back
   * into recovery —
   *   - if the slot is idle (release()'s path), `recycleSlot` re-launches it
   *     immediately and its eventual handOff serves the still-queued waiter;
   *   - if the slot is already owned by a recovery path (recycle IIFE /
   *     relaunchPendingSlots, where `isSlotBusy` is true and `recycleSlot`
   *     would no-op), park it `relaunchPending` so the next acquire's
   *     `relaunchPendingSlots` re-launches and serves the queued waiter.
   * Either way the waiter is never dropped and a dead browser is never
   * handed out.
   */
  private handOff(slot: Slot, browser: Browser): void {
    if (!browser.isConnected()) {
      // warn, not info: this is a capacity-affecting event — it strands a
      // queued waiter (kept queued, served later by a live browser) and routes
      // the slot back into recovery. It must reach the warn/Sentry alert
      // pipeline, consistent with reinit-empty / recycle-relaunch-failed.
      this.logger?.warn?.("browser-pool.handoff-dead-browser", {
        slotIndex: this.slots.indexOf(slot),
      });
      // Keep the waiter queued — do NOT shift it. Route the slot back into
      // recovery so a live browser serves the waiter on a later tick.
      if (this.isSlotBusy(slot)) {
        slot.relaunchPending = true;
      } else {
        this.recycleSlot(slot);
      }
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      // The waiter is now the slot's holder, so its eventual release() is the
      // one (and only) release that may return this slot. Mark it checked out —
      // but DEFER the mark to a microtask. release() calls handOff synchronously
      // (the live-slot return path), so a re-add HERE would make the slot
      // checked-out again WITHIN the same synchronous frame as a double
      // `release(sameBrowser)`: the original holder's second release would then
      // pass the `checkedOut.has(slot)` guard and steal THIS waiter's
      // release-right, shifting and resolving a second waiter with the same
      // browser. Deferring the re-add to a microtask keeps the slot un-checked
      // through the rest of the current synchronous frame (so the second
      // release is a no-op) while still marking it long before the waiter — a
      // distinct task scheduled by `resolve()` — could ever release it. (A
      // recycle/shutdown that supersedes this handoff between now and the
      // microtask clears `checkedOut` for the slot, so the deferred add cannot
      // resurrect a stale checkout: it only re-checks the slot is still the
      // live holder's by re-confirming the browser still maps to it.)
      // LOAD-BEARING ordering (covered by the "waiter-served release does not
      // leak the slot" control-mutant test): the checkedOut.add MUST be
      // enqueued via queueMicrotask BEFORE waiter.resolve so it runs before the
      // waiter's resolve continuation (microtask FIFO). Do NOT refactor to
      // setTimeout or extra .then hops — any reordering re-opens the
      // double-serve race the mutant test guards against.
      const waitingBrowser = browser;
      queueMicrotask(() => {
        if (this.browserToSlot.get(waitingBrowser) === slot) {
          this.checkedOut.add(slot);
        }
      });
      waiter.resolve(browser);
    } else if (!this.available.includes(slot)) {
      this.available.push(slot);
    }
  }

  /**
   * Close a browser, routing any failure through the structured logger with
   * the originating slot index instead of silently swallowing it. A close
   * failure is non-fatal (the process may have already crashed) but must be
   * visible to the harness log/Sentry pipeline.
   */
  private async closeBrowser(
    browser: Browser,
    slotIndex: number,
  ): Promise<void> {
    try {
      await browser.close();
    } catch (err) {
      this.logger?.warn?.("browser-pool.close-failed", {
        slotIndex,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Track an in-flight recovery launch (reinit / relaunchPendingSlots) so
   * `shutdown()` can drain it. Without this, a launch that resolves AFTER
   * shutdown has awaited `inFlightRecycles` leaks a browser the pool never
   * closes.
   */
  private track(promise: Promise<void>): Promise<void> {
    // Build the wrapper FIRST, then track and return the SAME wrapper object.
    // Tracking the raw `promise` while returning a distinct wrapper would let
    // `shutdown()`'s `Array.from(inFlightRecycles)` drain await the RAW promise
    // — which settles BEFORE the wrapper's `.catch`/`.finally` post-settle work
    // runs — so the drain would under-wait and shutdown could proceed before
    // this recovery's cleanup completed. Adding/removing the SAME object means
    // shutdown awaits the wrapper (including its cleanup).
    //
    // Note recycleSlot does NOT follow this same-object pattern: it adds the
    // RAW IIFE `recyclePromise` to `inFlightRecycles` and its `.catch`/`.finally`
    // is a SEPARATE chain. That is fine there because shutdown awaits the IIFE,
    // whose body performs the real recovery work — only the inert post-shutdown
    // set-cleanup in the detached `.finally` is under-waited, which is harmless.
    // Here, by contrast, the wrapper's `.catch`/`.finally` is the only thing
    // tracked, so it must be the SAME object that is added and removed.
    // The `.catch` absorbs any throw with a logged event so it can never
    // surface as an unhandled rejection (the inner methods swallow their own
    // launch errors today, but a future throw must stay contained — a recovery
    // launch failing is non-fatal to the pool).
    const wrapped: Promise<void> = promise
      .catch((err: unknown) => {
        this.logger?.error?.("browser-pool.recovery-failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        this.inFlightRecycles.delete(wrapped);
      });
    this.inFlightRecycles.add(wrapped);
    return wrapped;
  }

  /**
   * Backstop re-initialization for the truly-empty pool. Called from
   * `acquire()` only when `this.slots` is empty — i.e. nothing was ever
   * launched (init never ran / launched nothing). This is NOT the all-slots-
   * crashed recovery path: failed recycles keep their slots in `this.slots`
   * (parked `relaunchPending`) and are recovered by `relaunchPendingSlots()`,
   * so they never reach this backstop. Re-launches up to `poolSize` browsers,
   * tolerating partial failure — even one fresh slot lets a waiting probe
   * proceed. A total failure here surfaces to the caller via the normal
   * acquire timeout / waiter-reject path rather than wedging the pool forever.
   */
  private async reinit(): Promise<void> {
    // `rawLaunchBrowser` is the gate's underlying launcher, assigned by
    // init(). Guard on it (not the always-defined `launchBrowser` arrow) so
    // reinit is a no-op when init never ran — there is nothing to launch with.
    if (this.isShutdown || this.rawLaunchBrowser === undefined) return;
    // Set the concurrent-entry guard SYNCHRONOUSLY before the first `await`
    // (before `this.track(...)`) so a second acquire reaching its empty-pool
    // check while this reinit is in flight skips reinit and parks a waiter
    // instead of launching its own duplicate set of browsers. Cleared in the
    // `finally` so a thrown reinit can't leave the guard latched forever.
    this.reiniting = true;
    try {
      // Track the whole reinit so a shutdown racing this launch loop drains it
      // before closing slots, rather than leaking a browser that resolves after
      // shutdown already awaited the in-flight set.
      await this.track(this.reinitInner());
    } finally {
      this.reiniting = false;
    }
  }

  private async reinitInner(): Promise<void> {
    this.logger?.info("browser-pool.reinit", { poolSize: this.poolSize });
    for (
      let i = 0;
      i < this.poolSize && this.slots.length < this.poolSize;
      i++
    ) {
      try {
        const browser = await this.launchBrowser();
        if (this.isShutdown) {
          // This browser was never added to `this.slots`, so there is no real
          // originating slot index. Pass -1 rather than a fabricated index
          // (`this.slots.length`) that would masquerade as a live slot.
          await this.closeBrowser(browser, -1);
          return;
        }
        const slot: Slot = { browser, contextCount: 0 };
        this.slots.push(slot);
        this.browserToSlot.set(browser, slot);
        this.attachDisconnectHandler(slot, browser);
        this.handOff(slot, browser);
      } catch (err) {
        // Best effort — keep trying the remaining slots. If none succeed
        // the pool stays empty and the next acquire retries reinit. Per-attempt
        // failure is a warn: a single slot failing to relaunch is recoverable
        // (other slots may succeed, or a later acquire retries).
        this.logger?.warn?.("browser-pool.reinit-failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // The genuine empty-pool capacity-loss signal: reinit ran but every launch
    // failed, so the pool ends with zero slots. Unlike the per-attempt warn
    // above, this is the terminal "pool ended empty" outage and must reach the
    // error/Sentry pipeline. Per-attempt reinit-failed stays warn (recoverable);
    // this distinct end-of-loop emit fires once when the backstop drained empty.
    if (this.slots.length === 0) {
      this.logger?.error?.("browser-pool.reinit-empty", {
        poolSize: this.poolSize,
      });
    }
  }

  /**
   * A slot is "busy" while either recovery path owns it: `recycleSlot` (which
   * tracks via `recyclingSlots`) or `relaunchPendingSlotsInner` (which tracks
   * via `relaunchingSlots`). The two sets guard disjoint entry points, so each
   * entry point must consult BOTH — otherwise a late `disconnected` fire for a
   * pending slot's OLD browser would re-enter `recycleSlot` while
   * `relaunchPendingSlots` is concurrently relaunching the same slot, and both
   * would launch a fresh browser (the second swap overwrites `slot.browser`,
   * leaking the first process and/or double-publishing the slot).
   */
  private isSlotBusy(slot: Slot): boolean {
    return this.recyclingSlots.has(slot) || this.relaunchingSlots.has(slot);
  }

  /**
   * Re-attempt the launch for every slot parked as `relaunchPending`. Each
   * such slot was retained (not evicted) after a failed recycle so capacity
   * is preserved; here we lazily replace its dead browser with a fresh one.
   * A still-failing launch leaves the slot pending for the next acquire.
   *
   * Two concerns this method must own (a late `disconnected` fire for a
   * pending slot's OLD browser can re-enter `recycleSlot` while an
   * acquire()-driven call is relaunching the same slot):
   *   - Re-entry: `relaunchingSlots` marks a slot before its `await` so a
   *     racing invocation skips it — otherwise both launch a browser, the
   *     second overwrites `slot.browser` (leaking the first) and/or the slot
   *     is handed to two acquirers.
   *   - Handoff: a fresh browser is delivered to a queued waiter first
   *     (`handOff`) so the relaunch actually serves the waiter parked by the
   *     acquire that drove it, instead of only pushing to `available`.
   */
  private async relaunchPendingSlots(): Promise<void> {
    if (this.isShutdown) return;
    await this.track(this.relaunchPendingSlotsInner());
  }

  private async relaunchPendingSlotsInner(): Promise<void> {
    const pending = this.slots.filter(
      (s) => s.relaunchPending && !this.isSlotBusy(s),
    );
    for (const slot of pending) {
      if (this.isShutdown) return;
      // Re-validate against the once-captured `pending` snapshot before
      // claiming the slot. A concurrent invocation (a second acquire()-driven
      // relaunch, or a late `disconnected` re-entering recycleSlot) may have
      // claimed this slot (isSlotBusy) or already recovered it
      // (relaunchPending cleared) during a prior iteration's `await`. Without
      // this check-then-set — with NO `await` between the check and the
      // `add` — both invocations would launch a fresh browser for the same
      // slot, the second overwriting `slot.browser` (leaking the first
      // process) and double-publishing via handOff. Mirrors recycleSlot's
      // `if (this.isSlotBusy(slot)) return;` guard.
      if (this.isSlotBusy(slot) || !slot.relaunchPending) continue;
      // Mark before the await so a concurrent invocation skips this slot.
      this.relaunchingSlots.add(slot);
      try {
        const fresh = await this.launchBrowser();
        if (this.isShutdown) {
          await this.closeBrowser(fresh, this.slots.indexOf(slot));
          return;
        }
        this.browserToSlot.delete(slot.browser);
        slot.browser = fresh;
        slot.contextCount = 0;
        slot.relaunchPending = false;
        this.browserToSlot.set(fresh, slot);
        this.attachDisconnectHandler(slot, fresh);
        this.handOff(slot, fresh);
        this.logger?.info("browser-pool.relaunch-recovered", {
          slotIndex: this.slots.indexOf(slot),
        });
      } catch (err) {
        // Still failing — leave it pending for the next acquire to retry. This
        // is a per-attempt failure (the slot stays parked and recoverable), so
        // warn rather than error.
        this.logger?.warn?.("browser-pool.relaunch-failed", {
          slotIndex: this.slots.indexOf(slot),
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        this.relaunchingSlots.delete(slot);
      }
    }
  }

  async acquire(timeoutMs = 30_000): Promise<Browser> {
    if (this.isShutdown) {
      throw new Error("BrowserPool is shut down");
    }

    // Backstop: only when `this.slots` is truly empty — nothing was ever
    // launched (init() never ran or launched nothing) — does the pool have no
    // slot to recover, so reinit from scratch. NOTE: a burst of crashes whose
    // relaunches all fail does NOT empty `this.slots`; those slots are kept
    // and parked as `relaunchPending`, and are recovered below via
    // `relaunchPendingSlots()`, not here. (`stats().size` may read 0 in that
    // state, but `size` does not gate this backstop — `this.slots.length`
    // does.)
    if (this.slots.length === 0 && !this.reiniting) {
      await this.reinit();
    } else if (this.slots.length > 0) {
      // Lazily relaunch any slot whose last relaunch failed. This is the
      // recovery path for a transient launch failure: the slot was kept
      // (capacity preserved) but parked as `relaunchPending`; the next
      // acquire re-attempts the launch before falling through to the
      // normal available-slot scan.
      await this.relaunchPendingSlots();
    }
    // The remaining case — `slots.length === 0 && this.reiniting` — is the
    // concurrent-acquire skip: another acquire's reinit is already launching
    // up to poolSize browsers, so this call does NOT launch its own duplicate
    // set. It falls through to the waiter-queue path below; the in-flight
    // reinit's `handOff` serves this waiter as soon as a fresh browser lands.

    // Skip zombie slots whose browser has disconnected but whose disconnect
    // handler hasn't yet completed the recycle. Without this loop, a single
    // dead chromium process locks every probe that draws its slot until
    // either the harness restarts or `recycleAfter` release-cycles trigger the
    // contextCount-based recycle. Each zombie is kicked into recycle so the
    // pool self-heals across ticks.
    while (this.available.length > 0) {
      const slot = this.available.shift()!;
      if (slot.browser.isConnected()) {
        // This slot is now handed to the caller — mark it checked out so its
        // matching release() is the single return that may re-publish it, and
        // a duplicate release() is a no-op.
        this.checkedOut.add(slot);
        this.logger?.info("browser-pool.acquire", {
          available: this.available.length,
          inUse: this.checkedOut.size,
        });
        return slot.browser;
      }
      this.logger?.info("browser-pool.skipped-dead-slot", {
        slotIndex: this.slots.indexOf(slot),
      });
      this.recycleSlot(slot);
    }

    return new Promise<Browser>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject };
      const timer = setTimeout(() => {
        const idx = this.waiters.indexOf(waiter);
        if (idx !== -1) this.waiters.splice(idx, 1);
        reject(new Error("BrowserPool acquire timeout"));
      }, timeoutMs);

      // Wrap resolve/reject so the timeout is always cleared.
      const origResolve = waiter.resolve;
      const origReject = waiter.reject;
      waiter.resolve = (browser: Browser) => {
        clearTimeout(timer);
        origResolve(browser);
      };
      waiter.reject = (err: Error) => {
        clearTimeout(timer);
        origReject(err);
      };

      this.waiters.push(waiter);

      // No timer re-arms recovery here. A parked waiter is served by the next
      // acquire()/release()-driven relaunch: the harness probes continuously,
      // so a fresh probe tick drives `relaunchPendingSlots()` (via acquire) or
      // `handOff` (via release) and serves this waiter. In the degenerate idle
      // case the waiter hits its bounded `timeoutMs` and the caller retries on
      // the next tick — the no-eviction + lazy-recovery design already prevents
      // the pool from draining permanently to 0.
    });
  }

  release(browser: Browser): void {
    if (this.isShutdown) return;

    const slot = this.browserToSlot.get(browser);

    // Browser was already recycled or doesn't belong to this pool.
    if (!slot) return;

    // Idempotency guard covering BOTH return paths. A live slot is never
    // removed from `browserToSlot`, so a SECOND release(sameLiveBrowser) still
    // resolves the slot here and — without this check — would re-enter handOff,
    // shift a SECOND waiter, and resolve it with the SAME browser (two probes
    // driving one chromium). The `!available.includes(slot)` guard inside
    // handOff only covers the no-waiter branch; this guard closes the waiter
    // branch too. A release whose slot is not currently checked out is a
    // double release (or a foreign/stale reference) and must be a no-op. The
    // matching `add` happens when the slot is handed out (acquire's scan or
    // handOff's waiter branch); clearing it here makes the first release the
    // only one that proceeds.
    if (!this.checkedOut.has(slot)) return;
    this.checkedOut.delete(slot);

    slot.contextCount++;

    if (slot.contextCount >= this.recycleAfter) {
      this.recycleSlot(slot);
      return;
    }

    // Defensive: a release-time isConnected check catches the race where
    // the disconnect event hasn't fired yet (Playwright's events are
    // asynchronous) but the underlying process is already dead. Without
    // this, a dead browser would re-enter `available` and the next
    // acquire would hand it out before the disconnect handler runs.
    if (!slot.browser.isConnected()) {
      this.logger?.info("browser-pool.release-dead-slot", {
        slotIndex: this.slots.indexOf(slot),
      });
      this.recycleSlot(slot);
      return;
    }

    // Route the live-slot return through the shared waiter-first handoff so
    // there is ONE waiter-served path with ONE set of invariants: the
    // `!available.includes(slot)` guard (a double release() of a still-live
    // slot looks the slot up successfully BOTH times — the slot was never
    // recycled, so it stays in browserToSlot — and an unconditional push would
    // publish it to `available` twice, handing the SAME browser to two probes)
    // AND the `isConnected()` liveness gate (the release-time check above is
    // synchronous, but handOff re-checks before resolving so a dead browser is
    // never delivered to a waiter on this path either). The slot is idle here
    // (not in any recovery set), so a dead-browser handoff recycles it
    // immediately rather than parking it pending.
    this.handOff(slot, slot.browser);
    const s = this.stats();
    this.logger?.info("browser-pool.release", {
      available: s.available,
      inUse: s.inUse,
    });
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

    // Close every browser we know about. Route through closeBrowser so a
    // close failure is logged with its slot index rather than silently
    // swallowed.
    const closers = this.slots.map((slot, idx) =>
      this.closeBrowser(slot.browser, idx),
    );
    await Promise.allSettled(closers);

    this.slots = [];
    this.available = [];
    this.browserToSlot.clear();
    this.checkedOut.clear();
  }

  stats(): BrowserPoolStats {
    // `size` counts only live (non-pending) capacity. A slot parked as
    // `relaunchPending` holds a dead browser and is being recovered lazily,
    // so it is not usable capacity and must not inflate `size`. (`inUse` is NOT
    // filtered by `relaunchPending` — it derives from `this.checkedOut.size`
    // below, the set of slots actually handed to a caller.) When
    // every slot is pending, `size` reads 0 — that surfaces the outage to
    // callers, but it is NOT what gates recovery. The parked slots remain in
    // `this.slots`, so `acquire()` recovers them via `relaunchPendingSlots()`
    // (the `this.slots.length === 0` reinit backstop is a separate
    // never-launched case), not via this size reading.
    const liveSlots = this.slots.filter((s) => !s.relaunchPending);
    const availableCount = this.available.length;
    return {
      size: liveSlots.length,
      available: availableCount,
      // Derive `inUse` from the explicit checked-out set — the slots actually
      // handed to a caller right now — rather than the `liveSlots - available`
      // subtraction, which was inconsistently filtered (e.g. a slot mid-recycle
      // is neither live-counted the same way nor in `available`, skewing the
      // difference). `checkedOut` is maintained at every checkout/return/recycle
      // site, so its size is the precise in-use gauge.
      inUse: this.checkedOut.size,
      totalRecycles: this.totalRecycles,
    };
  }

  /**
   * Register a `disconnected` listener on a browser so a chromium process
   * that crashes mid-life proactively recycles its slot instead of waiting
   * for the next release-driven check. Three guards keep stale fires
   * harmless:
   *
   *   1. Pool shutdown: handler may fire as we close everything; ignore.
   *   2. Slot reassignment: `slot.browser` may already point to a fresh
   *      browser if recycle completed before the old browser's disconnect
   *      event drained — the late fire is for the OLD instance, not the
   *      slot's current one.
   *   3. Slot eviction: launch failure during recycle removes the slot
   *      from `this.slots`; a disconnect for a no-longer-tracked slot is
   *      a no-op.
   */
  private attachDisconnectHandler(slot: Slot, browser: Browser): void {
    browser.on("disconnected", () => {
      if (this.isShutdown) return;
      if (slot.browser !== browser) return;
      if (!this.slots.includes(slot)) return;
      this.logger?.info("browser-pool.disconnected", {
        slotIndex: this.slots.indexOf(slot),
      });
      this.recycleSlot(slot);
    });
  }

  private recycleSlot(slot: Slot): void {
    // Gate entry on shutdown so a late recycle cannot register a fresh promise
    // in `inFlightRecycles` AFTER shutdown() snapshotted that set via
    // `Array.from`, which would let its fresh browser escape the drain. The
    // disconnect handler already checks isShutdown, but recycleSlot has other
    // entry points (acquire()'s zombie scan, release()'s dead-slot check), so
    // harden the function itself. Matches the isShutdown gating reinit() and
    // relaunchPendingSlots() already do at their entry points.
    if (this.isShutdown) return;
    // Re-entry guard: a second call for the same slot is a no-op. This must
    // honor BOTH recovery sets (via isSlotBusy), not just recyclingSlots — a
    // slot parked relaunchPending still holds its OLD dead browser in
    // `slot.browser` and is still in `this.slots`, so a late `disconnected`
    // fire for that old browser passes the handler's guards and reaches here
    // while `relaunchPendingSlots` may already be relaunching the same slot.
    // Without consulting relaunchingSlots, both would launch a fresh browser
    // and the second swap would overwrite `slot.browser`, leaking one process
    // and/or double-publishing the slot.
    if (this.isSlotBusy(slot)) return;
    this.recyclingSlots.add(slot);

    // A recycled slot's OLD browser is no longer a usable checkout: whether it
    // was in-use (disconnect-during-hold) or idle (acquire's zombie scan), the
    // slot is being torn down and relaunched. Clear it so the set never leaks a
    // stale entry across recycle (a fresh browser starts NOT checked out until
    // re-acquired or handed to a waiter via the relaunch's handOff). release()
    // paths that route here (contextCount/dead-slot) already cleared it; this
    // covers the other entry points (disconnect handler, acquire zombie scan).
    this.checkedOut.delete(slot);

    this.totalRecycles++;
    const slotIdx = this.slots.indexOf(slot);
    this.logger?.info("browser-pool.recycle", {
      slotIndex: slotIdx,
      contextCount: slot.contextCount,
      recycleAfter: this.recycleAfter,
      totalRecycles: this.totalRecycles,
    });

    // Remove the old browser from the lookup map immediately so a
    // double-release of the stale reference is a no-op.
    this.browserToSlot.delete(slot.browser);

    // Remove from available in case it's still there (shouldn't be in
    // the normal path, but defensive).
    const availIdx = this.available.indexOf(slot);
    if (availIdx !== -1) {
      this.available.splice(availIdx, 1);
    }

    const oldBrowser = slot.browser;

    const recyclePromise = (async () => {
      await this.closeBrowser(oldBrowser, slotIdx);

      if (this.isShutdown) return;

      // Retry the relaunch a bounded number of times with backoff. A single
      // transient launch failure (OOM spike, fd exhaustion) must NOT
      // permanently shrink the pool — the old code spliced the slot out on
      // the first failure, so one bad launch monotonically drained the pool
      // to empty and it never self-healed.
      let lastErr: unknown;
      for (let attempt = 1; attempt <= RELAUNCH_MAX_ATTEMPTS; attempt++) {
        if (this.isShutdown) return;
        try {
          const fresh = await this.launchBrowser();

          if (this.isShutdown) {
            // Shutdown was initiated while we were launching. Close the
            // fresh browser and don't hand it to anyone.
            await this.closeBrowser(fresh, this.slots.indexOf(slot));
            return;
          }

          slot.browser = fresh;
          slot.contextCount = 0;
          slot.relaunchPending = false;
          this.browserToSlot.set(fresh, slot);
          this.attachDisconnectHandler(slot, fresh);

          this.handOff(slot, fresh);
          return;
        } catch (err) {
          lastErr = err;
          if (attempt < RELAUNCH_MAX_ATTEMPTS) {
            await delay(RELAUNCH_BACKOFF_BASE_MS * 2 ** (attempt - 1));
          }
        }
      }

      // All immediate retries failed. Do NOT evict the slot — keep it in
      // `this.slots` so capacity is preserved and park it as
      // `relaunchPending`. The next `acquire()` lazily re-attempts the
      // launch (see relaunchPendingSlots), and the empty-pool backstop in
      // acquire() re-initializes if every slot ends up pending/lost.
      slot.relaunchPending = true;
      // Capacity loss after exhausting ALL immediate retries — the slot is now
      // parked dead and only a later lazy acquire can recover it. This is a
      // genuine capacity-loss signal that must reach error/Sentry, not info.
      this.logger?.error?.("browser-pool.recycle-relaunch-failed", {
        slotIndex: this.slots.indexOf(slot),
        attempts: RELAUNCH_MAX_ATTEMPTS,
        poolSize: this.slots.length,
        error: lastErr instanceof Error ? lastErr.message : String(lastErr),
      });

      // Leave the slot parked as `relaunchPending` — no timer kick. The next
      // `acquire()` re-attempts the launch via `relaunchPendingSlots()` and a
      // release-driven recycle recovers via `handOff`, so a queued waiter is
      // served by the next probe tick (or, in the degenerate idle case, the
      // caller retries after the waiter's bounded acquire timeout).
    })();

    this.inFlightRecycles.add(recyclePromise);
    // Absorb any throw with a logged `.catch` before the `.finally`, mirroring
    // track(). The IIFE swallows its own launch errors today, but a future
    // synchronous throw (e.g. handOff/attachDisconnectHandler/browserToSlot.set)
    // must stay contained — a recycle failing is non-fatal to the pool and must
    // never surface as an unhandled rejection.
    recyclePromise
      .catch((err: unknown) => {
        this.logger?.error?.("browser-pool.recycle-failed", {
          slotIndex: this.slots.indexOf(slot),
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        this.recyclingSlots.delete(slot);
        this.inFlightRecycles.delete(recyclePromise);
      });
  }
}
