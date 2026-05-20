import type { Browser } from "playwright";

interface Slot {
  browser: Browser;
  contextCount: number;
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

  async acquire(timeoutMs = 30_000): Promise<Browser> {
    if (this.isShutdown) {
      throw new Error("BrowserPool is shut down");
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

    // Close every browser we know about.
    const closers = this.slots.map((slot) =>
      slot.browser.close().catch(() => {}),
    );
    await Promise.allSettled(closers);

    this.slots = [];
    this.available = [];
    this.browserToSlot.clear();
  }

  stats(): BrowserPoolStats {
    const availableCount = this.available.length;
    return {
      size: this.slots.length,
      available: availableCount,
      inUse: this.slots.length - availableCount,
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
    // Re-entry guard: a second call for the same slot (e.g. zombie-skip in
    // acquire() racing the disconnect handler) is a no-op. Without this,
    // both call sites would launch a fresh browser and the second would
    // overwrite `slot.browser` while the first's relaunch was still in
    // flight, leaking one browser process.
    if (this.recyclingSlots.has(slot)) return;
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
      try {
        await oldBrowser.close();
      } catch {
        // Best effort — the browser may have already crashed.
      }

      if (this.isShutdown) return;

      try {
        const fresh = await this.launchBrowser();

        if (this.isShutdown) {
          // Shutdown was initiated while we were launching. Close the
          // fresh browser and don't hand it to anyone.
          await fresh.close().catch(() => {});
          return;
        }

        slot.browser = fresh;
        slot.contextCount = 0;
        this.browserToSlot.set(fresh, slot);
        this.attachDisconnectHandler(slot, fresh);

        const waiter = this.waiters.shift();
        if (waiter) {
          waiter.resolve(fresh);
        } else {
          this.available.push(slot);
        }
      } catch (err) {
        // Launch failed — remove this slot from the pool entirely so
        // stats reflect the reduced capacity.
        const idx = this.slots.indexOf(slot);
        if (idx !== -1) {
          this.slots.splice(idx, 1);
        }
        console.error(
          `[BrowserPool] recycleSlot launch failed (slot ${idx}, pool size now ${this.slots.length}):`,
          err,
        );

        // If pool is completely exhausted with waiters pending, reject
        // them all — no remaining slots can ever serve them.
        if (this.slots.length === 0 && this.waiters.length > 0) {
          const stale = this.waiters.splice(0);
          for (const w of stale) {
            w.reject(
              new Error("BrowserPool exhausted: all slots failed to launch"),
            );
          }
        }
      }
    })();

    this.inFlightRecycles.add(recyclePromise);
    recyclePromise.finally(() => {
      this.recyclingSlots.delete(slot);
      this.inFlightRecycles.delete(recyclePromise);
    });
  }
}
