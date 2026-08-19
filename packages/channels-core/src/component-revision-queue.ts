/** One immutable component render revision offered to provider delivery. */
export interface ComponentRevision<TValue> {
  revision: number;
  value: TValue;
  terminal?: boolean;
}

/** The provider-visible revision that satisfied one enqueue request. */
export interface ComponentRevisionDelivery {
  deliveredRevision: number;
}

/** Stable queue failure for a stale or duplicate component revision. */
export class ComponentRevisionQueueError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ComponentRevisionQueueError";
    this.code = code;
  }
}

export interface ComponentRevisionQueueOptions<TValue, TPrepared> {
  /** Persist and prepare a chosen revision exactly once before provider delivery. */
  prepare(revision: ComponentRevision<TValue>): Promise<TPrepared>;
  /** Deliver one prepared revision. Retries receive the same prepared value. */
  deliver(
    prepared: TPrepared,
    revision: ComponentRevision<TValue>,
  ): Promise<void>;
  /** Minimum gap between provider calls. */
  minIntervalMs: number;
  /** Total provider attempts per selected revision. Defaults to one. */
  maxAttempts?: number;
  /** Backoff delay before a retry. */
  retryDelayMs?: (attempt: number) => number;
  /** Injectable timer for deterministic tests. */
  sleep?: (milliseconds: number) => Promise<void>;
  /** Injectable clock for deterministic cadence tests. */
  now?: () => number;
}

/** Serialized latest-wins component provider queue. */
export interface ComponentRevisionQueue<TValue> {
  enqueue(
    revision: ComponentRevision<TValue>,
  ): Promise<ComponentRevisionDelivery>;
  drain(): Promise<void>;
}

interface QueueEntry<TValue> {
  item: ComponentRevision<TValue>;
  waiters: Array<{
    resolve(value: ComponentRevisionDelivery): void;
    reject(error: unknown): void;
  }>;
}

/**
 * Create a serialized delivery queue that replaces a pending nonterminal render
 * with the newest revision while preserving every terminal revision in order.
 */
export function createComponentRevisionQueue<TValue, TPrepared = TValue>(
  options: ComponentRevisionQueueOptions<TValue, TPrepared>,
): ComponentRevisionQueue<TValue> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const maxAttempts = options.maxAttempts ?? 1;
  const retryDelayMs = options.retryDelayMs ?? (() => 0);
  const queue: QueueEntry<TValue>[] = [];
  const drainWaiters: Array<{ resolve(): void; reject(error: unknown): void }> =
    [];
  let running = false;
  let highestOfferedRevision = -1;
  let lastDeliveredAt = 0;

  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    throw new TypeError("Component revision maxAttempts must be at least one.");
  }
  if (!Number.isFinite(options.minIntervalMs) || options.minIntervalMs < 0) {
    throw new TypeError(
      "Component revision minIntervalMs must not be negative.",
    );
  }

  return {
    enqueue(item) {
      if (
        !Number.isSafeInteger(item.revision) ||
        item.revision <= highestOfferedRevision
      ) {
        return Promise.reject(
          new ComponentRevisionQueueError(
            "channel_component_stale_revision",
            `Component revision ${item.revision} is not newer than ${highestOfferedRevision}.`,
          ),
        );
      }
      highestOfferedRevision = item.revision;

      const promise = new Promise<ComponentRevisionDelivery>(
        (resolve, reject) => {
          const waiter = { resolve, reject };
          const last = queue.at(-1);
          if (last && !last.item.terminal) {
            last.item = item;
            last.waiters.push(waiter);
          } else {
            queue.push({ item, waiters: [waiter] });
          }
        },
      );
      start();
      return promise;
    },
    drain() {
      if (!running && queue.length === 0) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        drainWaiters.push({ resolve, reject });
      });
    },
  };

  function start(): void {
    if (running) return;
    running = true;
    void run();
  }

  async function run(): Promise<void> {
    while (queue.length > 0) {
      const entry = queue.shift()!;
      try {
        await waitForCadence();
        const prepared = await options.prepare(entry.item);
        await deliverWithRetry(prepared, entry.item);
        lastDeliveredAt = now();
        const result = { deliveredRevision: entry.item.revision };
        for (const waiter of entry.waiters) waiter.resolve(result);
      } catch (error) {
        for (const waiter of entry.waiters) waiter.reject(error);
      }
    }
    running = false;
    for (const waiter of drainWaiters.splice(0)) waiter.resolve();
  }

  async function deliverWithRetry(
    prepared: TPrepared,
    item: ComponentRevision<TValue>,
  ): Promise<void> {
    let attempt = 1;
    while (true) {
      try {
        await options.deliver(prepared, item);
        return;
      } catch (error) {
        if (attempt >= maxAttempts) throw error;
        await sleep(retryDelayMs(attempt));
        attempt += 1;
      }
    }
  }

  async function waitForCadence(): Promise<void> {
    if (lastDeliveredAt === 0) return;
    const delay = Math.max(
      0,
      options.minIntervalMs - (now() - lastDeliveredAt),
    );
    if (delay > 0) await sleep(delay);
  }
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
