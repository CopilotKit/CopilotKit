const DEFAULT_IDLE_TIMEOUT_MS = 30_000;
const DEFAULT_IDLE_POLL_INTERVAL_MS = 500;

export interface MCPAppsQueueAgent {
  threadId?: string;
  isRunning: boolean;
  subscribe(callbacks: {
    onRunFinalized: () => void;
    onRunFailed: () => void;
  }): { unsubscribe(): void };
}

export interface MCPAppsRequestQueueOptions {
  idleTimeoutMs?: number;
  idlePollIntervalMs?: number;
}

export interface MCPAppsQueueRequest<T> {
  agent: MCPAppsQueueAgent;
  ownerId: string;
  execute: (signal: AbortSignal) => Promise<T>;
  dropAfterThreadSwitch?: boolean;
}

type QueueItem = {
  agent: MCPAppsQueueAgent;
  capturedThreadId: string;
  controller: AbortController;
  dropAfterThreadSwitch: boolean;
  execute: (signal: AbortSignal) => Promise<unknown>;
  ownerId: string;
  reject: (error: Error) => void;
  resolve: (result: unknown) => void;
};

/** Raised when a renderer cancels MCP work that it owns. */
export class MCPAppsQueueCancelledError extends Error {
  constructor() {
    super("MCP Apps request cancelled because its renderer was destroyed.");
    this.name = "MCPAppsQueueCancelledError";
  }
}

/** Raised when an agent does not become idle within the configured limit. */
export class MCPAppsQueueTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Timed out waiting ${timeoutMs}ms for the agent to become idle.`);
    this.name = "MCPAppsQueueTimeoutError";
  }
}

/** Raised when a queued follow-up no longer belongs to the active thread. */
export class MCPAppsQueueThreadChangedError extends Error {
  constructor(originThreadId: string, currentThreadId: string) {
    super(
      `Dropped MCP Apps follow-up after thread changed from "${originThreadId}" to "${currentThreadId}".`,
    );
    this.name = "MCPAppsQueueThreadChangedError";
  }
}

/**
 * Serializes MCP requests per agent thread while retaining renderer ownership.
 *
 * An owner can abort its queued and active waits without affecting requests
 * created by another renderer. Follow-ups can additionally opt into a
 * thread-identity check immediately before execution.
 */
export class MCPAppsRequestQueue {
  private readonly queues = new Map<
    MCPAppsQueueAgent,
    Map<string, QueueItem[]>
  >();
  private readonly processing = new Map<MCPAppsQueueAgent, Set<string>>();
  private readonly idleTimeoutMs: number;
  private readonly idlePollIntervalMs: number;

  constructor(options: MCPAppsRequestQueueOptions = {}) {
    this.idleTimeoutMs = positiveDuration(
      options.idleTimeoutMs,
      DEFAULT_IDLE_TIMEOUT_MS,
      "idleTimeoutMs",
    );
    this.idlePollIntervalMs = positiveDuration(
      options.idlePollIntervalMs,
      DEFAULT_IDLE_POLL_INTERVAL_MS,
      "idlePollIntervalMs",
    );
  }

  /** Enqueues one request and resolves it in FIFO order for its thread. */
  enqueue<T>(request: MCPAppsQueueRequest<T>): Promise<T> {
    const capturedThreadId = request.agent.threadId || "default";

    return new Promise<T>((resolve, reject) => {
      const agentQueues =
        this.queues.get(request.agent) ?? new Map<string, QueueItem[]>();
      const queue = agentQueues.get(capturedThreadId) ?? [];
      const item: QueueItem = {
        agent: request.agent,
        capturedThreadId,
        controller: new AbortController(),
        dropAfterThreadSwitch: request.dropAfterThreadSwitch ?? false,
        execute: request.execute,
        ownerId: request.ownerId,
        reject,
        resolve: (result) => resolve(result as T),
      };

      queue.push(item);
      agentQueues.set(capturedThreadId, queue);
      this.queues.set(request.agent, agentQueues);
      void this.processQueue(request.agent, capturedThreadId);
    });
  }

  /** Cancels only requests associated with the supplied renderer owner. */
  cancelOwner(ownerId: string): void {
    for (const agentQueues of this.queues.values()) {
      for (const queue of agentQueues.values()) {
        for (const item of queue) {
          if (item.ownerId === ownerId && !item.controller.signal.aborted) {
            item.controller.abort();
            item.reject(new MCPAppsQueueCancelledError());
          }
        }
      }
    }
  }

  private async processQueue(
    agent: MCPAppsQueueAgent,
    threadId: string,
  ): Promise<void> {
    const processingThreads = this.processing.get(agent) ?? new Set<string>();
    if (processingThreads.has(threadId)) return;
    processingThreads.add(threadId);
    this.processing.set(agent, processingThreads);

    try {
      const queue = this.queues.get(agent)?.get(threadId);
      if (!queue) return;

      while (queue.length > 0) {
        const item = queue[0]!;

        try {
          this.throwIfCancelled(item.controller.signal);
          await this.waitForAgentIdle(item.agent, item.controller.signal);
          this.throwIfCancelled(item.controller.signal);

          const currentThreadId = item.agent.threadId || "default";
          if (
            item.dropAfterThreadSwitch &&
            currentThreadId !== item.capturedThreadId
          ) {
            throw new MCPAppsQueueThreadChangedError(
              item.capturedThreadId,
              currentThreadId,
            );
          }

          const result = await raceWithAbort(
            item.execute(item.controller.signal),
            item.controller.signal,
          );
          item.resolve(result);
        } catch (error) {
          item.reject(asError(error));
        } finally {
          queue.shift();
        }
      }
    } finally {
      const agentQueues = this.queues.get(agent);
      agentQueues?.delete(threadId);
      if (agentQueues?.size === 0) this.queues.delete(agent);

      processingThreads.delete(threadId);
      if (processingThreads.size === 0) this.processing.delete(agent);
    }
  }

  private waitForAgentIdle(
    agent: MCPAppsQueueAgent,
    signal: AbortSignal,
  ): Promise<void> {
    if (!agent.isRunning) return Promise.resolve();

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let subscription: { unsubscribe(): void } | undefined;
      let interval: ReturnType<typeof setInterval> | undefined;

      const cleanup = () => {
        clearTimeout(timeout);
        if (interval !== undefined) clearInterval(interval);
        subscription?.unsubscribe();
        signal.removeEventListener("abort", cancel);
      };
      const finish = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const cancel = () => fail(new MCPAppsQueueCancelledError());
      const timeout = setTimeout(
        () => fail(new MCPAppsQueueTimeoutError(this.idleTimeoutMs)),
        this.idleTimeoutMs,
      );

      signal.addEventListener("abort", cancel, { once: true });
      subscription = agent.subscribe({
        onRunFinalized: finish,
        onRunFailed: finish,
      });
      interval = setInterval(() => {
        if (!agent.isRunning) finish();
      }, this.idlePollIntervalMs);

      if (signal.aborted) cancel();
    });
  }

  private throwIfCancelled(signal: AbortSignal): void {
    if (signal.aborted) throw new MCPAppsQueueCancelledError();
  }
}

function positiveDuration(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved <= 0) {
    throw new RangeError(`${name} must be a positive finite number.`);
  }
  return resolved;
}

function raceWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) return Promise.reject(new MCPAppsQueueCancelledError());

  return new Promise<T>((resolve, reject) => {
    const cancel = () => reject(new MCPAppsQueueCancelledError());
    signal.addEventListener("abort", cancel, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", cancel);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", cancel);
        reject(error);
      },
    );
  });
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
