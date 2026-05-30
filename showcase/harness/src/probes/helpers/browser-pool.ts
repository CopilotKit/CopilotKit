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
 * harness-wide `Logger` interface but only the `info` method is required.
 * Optional so existing callers (tests, legacy boot paths) don't break.
 */
interface PoolLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
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
  private isShutdown = false;
  private readonly logger?: PoolLogger;
  private readonly injectedLaunchBrowser?: LaunchBrowser;

  // Tracks which Browser instance maps to which Slot, so release() can find
  // the slot in O(1) even after the slot was removed from `available`.
  private browserToSlot = new Map<Browser, Slot>();

  constructor(
    size = 4,
    recycleAfter?: number,
    logger?: PoolLogger,
    launchBrowser?: LaunchBrowser,
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
  }

  async init(): Promise<void> {
    if (this.injectedLaunchBrowser) {
      this.launchBrowser = this.injectedLaunchBrowser;
    } else {
      const { chromium } =
        (await import("playwright")) as typeof import("playwright");
      this.launchBrowser = () =>
        chromium.launch({
          headless: true,
          args: ["--no-sandbox", "--disable-dev-shm-usage"],
        });
    }

    for (let i = 0; i < this.poolSize; i++) {
      const browser = await this.launchBrowser();
      const slot: Slot = { browser, contextCount: 0 };
      this.slots.push(slot);
      this.available.push(slot);
      this.browserToSlot.set(browser, slot);
      this.attachDisconnectHandler(slot, browser);
    }
  }

  // Assigned during init() after the dynamic import resolves.
  private launchBrowser!: LaunchBrowser;

  /**
   * Single waiter-first handoff used by every slot-recovery path (reinit,
   * recycle success, relaunchPendingSlots). A freshly launched browser must
   * go to a queued waiter if one exists — otherwise the waiter is stranded
   * until its acquire timeout while a live browser sits idle in `available`.
   * Only when there is no waiter does the slot land in `available` (guarded
   * by `includes` so a slot is never published twice).
   */
  private handOff(slot: Slot, browser: Browser): void {
    const waiter = this.waiters.shift();
    if (waiter) {
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
      this.logger?.info("browser-pool.close-failed", {
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
    this.inFlightRecycles.add(promise);
    // Chain the cleanup onto what we return (and await), and absorb any throw
    // with a logged `.catch` so it can never surface as an unhandled
    // rejection. The inner methods swallow their own launch errors today, but
    // a future throw inside reinitInner/relaunchPendingSlotsInner must stay
    // contained — a recovery launch failing is non-fatal to the pool.
    return promise
      .catch((err: unknown) => {
        this.logger?.info("browser-pool.recovery-failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        this.inFlightRecycles.delete(promise);
      });
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
    if (this.isShutdown || this.launchBrowser === undefined) return;
    // Track the whole reinit so a shutdown racing this launch loop drains it
    // before closing slots, rather than leaking a browser that resolves after
    // shutdown already awaited the in-flight set.
    await this.track(this.reinitInner());
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
        // the pool stays empty and the next acquire retries reinit.
        this.logger?.info("browser-pool.reinit-failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
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
        // Still failing — leave it pending for the next acquire to retry.
        this.logger?.info("browser-pool.relaunch-failed", {
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
    if (this.slots.length === 0) {
      await this.reinit();
    } else {
      // Lazily relaunch any slot whose last relaunch failed. This is the
      // recovery path for a transient launch failure: the slot was kept
      // (capacity preserved) but parked as `relaunchPending`; the next
      // acquire re-attempts the launch before falling through to the
      // normal available-slot scan.
      await this.relaunchPendingSlots();
    }

    // Skip zombie slots whose browser has disconnected but whose disconnect
    // handler hasn't yet completed the recycle. Without this loop, a single
    // dead chromium process locks every probe that draws its slot until
    // either the harness restarts or 100 release-cycles trigger the
    // contextCount-based recycle. Each zombie is kicked into recycle so the
    // pool self-heals across ticks.
    while (this.available.length > 0) {
      const slot = this.available.shift()!;
      if (slot.browser.isConnected()) {
        this.logger?.info("browser-pool.acquire", {
          available: this.available.length,
          inUse: this.slots.length - this.available.length,
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

    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve(slot.browser);
    } else {
      this.available.push(slot);
    }
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
  }

  stats(): BrowserPoolStats {
    // `size` counts only live (non-pending) capacity. A slot parked as
    // `relaunchPending` holds a dead browser and is being recovered lazily,
    // so it is not usable capacity and must not inflate `size`/`inUse`. When
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
      // Clamp to 0 so a future invariant break (availableCount exceeding
      // liveSlots.length) can never surface as a negative gauge.
      inUse: Math.max(0, liveSlots.length - availableCount),
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
      this.logger?.info("browser-pool.recycle-relaunch-failed", {
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
    recyclePromise.finally(() => {
      this.recyclingSlots.delete(slot);
      this.inFlightRecycles.delete(recyclePromise);
    });
  }
}
