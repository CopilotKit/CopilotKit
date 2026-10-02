import type { AbstractAgent, RunAgentResult } from "@ag-ui/client";

/**
 * How long a queued request waits for a busy agent before it is rejected.
 * A stuck run would otherwise hold the whole queue (and the widget's loading
 * state) forever. The Vue host enforced this before the shared extraction; it
 * now applies to every frontend.
 */
export const MCP_APPS_QUEUE_IDLE_TIMEOUT_MS = 30_000;

/**
 * Raised when queued work is dropped because the agent moved to another thread
 * between enqueue and execution. Distinguishable so callers can answer the
 * requester explicitly instead of leaving it waiting.
 */
export class MCPAppsQueueThreadChangedError extends Error {
  constructor(
    readonly originThreadId: string,
    readonly currentThreadId: string,
  ) {
    super(
      `[CopilotKit] MCP app request dropped: the agent moved from thread "${originThreadId}" to "${currentThreadId}" while it was queued.`,
    );
    this.name = "MCPAppsQueueThreadChangedError";
  }
}

/** Options accepted by {@link MCPAppsRequestQueue.enqueue}. */
export interface MCPAppsEnqueueOptions {
  /**
   * Identifies the caller that owns this request, so `cancelOwner` can drop the
   * work of a single widget without touching requests queued by other widgets
   * (the pre-extraction `cancel(threadId)` was too broad: it rejected everything
   * sharing a thread).
   */
  owner?: object;
  /** Override the busy-agent wait timeout. Defaults to 30s. */
  timeoutMs?: number;
  /** Also release an executing request's wait on owner cancellation (does not stop its run). */
  cancelRunningWait?: boolean;
  /**
   * Drop the request instead of running it when the agent has switched threads
   * since it was enqueued.
   *
   * The queue is keyed by agent AND thread, but that only decides which FIFO the
   * work joins: a single shared agent object can have its `threadId` mutated in
   * place while the work waits, so executing later would run a thread-1 request
   * against thread-2 - and stream into it (issue #5819's failure mode, applied
   * to the proxy paths).
   */
  dropAfterThreadSwitch?: boolean;
}

interface QueueItem {
  execute: (signal: AbortSignal) => Promise<RunAgentResult>;
  cancelRunningWait?: boolean;
  resolve: (result: RunAgentResult) => void;
  reject: (error: Error) => void;
  owner?: object;
  timeoutMs: number;
  /** Aborted by `cancelOwner`, so an active idle wait stops immediately. */
  controller: AbortController;
  /** Thread the agent was on when this work was enqueued. */
  originThreadId: string;
  dropAfterThreadSwitch?: boolean;
  /**
   * Set once `execute()` has actually been invoked. The run itself can no longer
   * be cancelled (runAgent exposes no abort), but the caller's WAIT still can:
   * with `cancelRunningWait`, `cancelOwner` aborts the signal and settles the
   * requester instead of leaving it pending.
   */
  executing?: boolean;
  /** Set by `cancelOwner` for work that must not run. */
  cancelled?: boolean;
}

/** Stable per-agent id, so two agents sharing a threadId keep separate queues. */
const agentKeys = new WeakMap<AbstractAgent, string>();
let nextAgentKey = 0;
function keyFor(agent: AbstractAgent): string {
  let key = agentKeys.get(agent);
  if (!key) {
    key = `agent-${nextAgentKey++}`;
    agentKeys.set(agent, key);
  }
  return `${key}::${agent.threadId || "default"}`;
}

/**
 * Queue for serializing MCP app requests to an agent.
 * Ensures requests wait for the agent to stop running and are processed one at a time.
 */
export class MCPAppsRequestQueue {
  private queues = new Map<string, QueueItem[]>();
  private processing = new Map<string, boolean>();

  /**
   * Add a request to the queue for a specific agent thread.
   * Returns a promise that resolves when the request completes.
   */
  async enqueue(
    agent: AbstractAgent,
    request: (signal: AbortSignal) => Promise<RunAgentResult>,
    options?: MCPAppsEnqueueOptions,
  ): Promise<RunAgentResult> {
    // Keyed by agent AND thread: a shared thread id must not serialize (or
    // cancel) work belonging to a different agent.
    const key = keyFor(agent);

    return new Promise((resolve, reject) => {
      let queue = this.queues.get(key);
      if (!queue) {
        queue = [];
        this.queues.set(key, queue);
      }

      queue.push({
        execute: request,
        cancelRunningWait: options?.cancelRunningWait,
        resolve,
        reject,
        owner: options?.owner,
        timeoutMs: options?.timeoutMs ?? MCP_APPS_QUEUE_IDLE_TIMEOUT_MS,
        controller: new AbortController(),
        originThreadId: agent.threadId || "default",
        dropAfterThreadSwitch: options?.dropAfterThreadSwitch,
      });

      // Start processing if not already running
      this.processQueue(key, agent);
    });
  }

  /**
   * Drop every request queued by `owner` that has not started executing yet,
   * rejecting its promise. Used by a widget teardown so work that only exists to
   * feed a now-unmounted iframe does not run against the agent later.
   *
   * By default this cancels waiting work only. `cancelRunningWait` also
   * releases an executing caller's wait and signals its callback; it does not
   * itself stop a runAgent call. The next item still waits for agent idle.
   */
  cancelOwner(owner: object): void {
    for (const queue of this.queues.values()) {
      for (const item of queue) {
        if (
          item.owner !== owner ||
          (item.executing && !item.cancelRunningWait) ||
          item.cancelled
        )
          continue;
        item.cancelled = true;
        // Abort first: an item already waiting on a busy agent must release its
        // timer and agent subscription now, not when the agent finally frees up.
        item.controller.abort();
        item.reject(
          new Error("[CopilotKit] MCP app request cancelled on teardown"),
        );
      }
    }
  }

  /**
   * Drain a queue one request at a time, waiting for the agent to go idle before
   * each. Re-entrant-safe (a single processor per key) and drops the entries once
   * fully drained to keep the shared queue bounded.
   */
  private async processQueue(key: string, agent: AbstractAgent): Promise<void> {
    // If already processing this queue, return
    if (this.processing.get(key)) {
      return;
    }

    this.processing.set(key, true);

    try {
      const queue = this.queues.get(key);
      if (!queue) return;

      while (queue.length > 0) {
        const item = queue[0]!;

        // Cancelled before it got its turn: its promise is already rejected.
        if (item.cancelled) {
          queue.shift();
          continue;
        }

        try {
          // Wait for any active run to complete before processing
          await this.waitForAgentIdle(
            agent,
            item.timeoutMs,
            item.controller.signal,
          );

          // The owner may have torn down while we waited for the agent.
          if (item.cancelled) {
            queue.shift();
            continue;
          }

          // Thread guard: the agent object is shared and its `threadId` can be
          // mutated in place while work waits, so re-check right before running.
          // The queue key only decided which FIFO this joined, it does not pin
          // the agent's current thread.
          const currentThreadId = agent.threadId || "default";
          if (
            item.dropAfterThreadSwitch &&
            currentThreadId !== item.originThreadId
          ) {
            item.reject(
              new MCPAppsQueueThreadChangedError(
                item.originThreadId,
                currentThreadId,
              ),
            );
            queue.shift();
            continue;
          }

          // Execution itself is not aborted; callers may opt into releasing
          // their wait on teardown (the legacy Angular contract).
          item.executing = true;
          const execution = item.execute(item.controller.signal);
          const result = item.cancelRunningWait
            ? await waitWithAbort(execution, item.controller.signal)
            : await execution;
          item.resolve(result);
        } catch (error) {
          item.reject(
            error instanceof Error ? error : new Error(String(error)),
          );
        }

        // Remove processed item
        queue.shift();
      }
    } finally {
      // Drop the drained entries from both maps. `mcpAppsRequestQueue` is shared
      // for the page lifetime, so retaining an entry per agent/thread would grow
      // unbounded as threads come and go.
      const queue = this.queues.get(key);
      if (!queue || queue.length === 0) {
        this.queues.delete(key);
        this.processing.delete(key);
      } else {
        this.processing.set(key, false);
      }
    }
  }

  /**
   * Resolve once the agent is not running. Subscribes to run-finalized/failed and
   * also polls as a fallback for reconnect scenarios where events do not fire.
   * Rejects after `timeoutMs` so a stuck run cannot block the queue forever.
   */
  private waitForAgentIdle(
    agent: AbstractAgent,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!agent.isRunning) {
        resolve();
        return;
      }
      if (signal?.aborted) {
        reject(new Error("[CopilotKit] MCP app request cancelled on teardown"));
        return;
      }

      let done = false;
      const settle = (fn: () => void) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        clearInterval(checkInterval);
        sub.unsubscribe();
        signal?.removeEventListener("abort", onAbort);
        fn();
      };
      const onAbort = () =>
        settle(() =>
          reject(
            new Error("[CopilotKit] MCP app request cancelled on teardown"),
          ),
        );
      signal?.addEventListener("abort", onAbort);
      const finish = () => settle(resolve);

      const sub = agent.subscribe({
        onRunFinalized: finish,
        onRunFailed: finish,
      });

      // Fallback for reconnect scenarios where events don't fire
      const checkInterval = setInterval(() => {
        if (!agent.isRunning) finish();
      }, 500);

      const timer = setTimeout(() => {
        settle(() =>
          reject(
            new Error(
              "[CopilotKit] Timed out waiting for agent to become idle",
            ),
          ),
        );
      }, timeoutMs);
    });
  }
}

// Shared per-thread queue instance for all MCP app requests.
export const mcpAppsRequestQueue = new MCPAppsRequestQueue();

/** Release only the caller's wait; the underlying run may still be active. */
function waitWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = () =>
      reject(new Error("[CopilotKit] MCP app request cancelled on teardown"));
    signal.addEventListener("abort", cancel, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", cancel));
    if (signal.aborted) cancel();
  });
}
