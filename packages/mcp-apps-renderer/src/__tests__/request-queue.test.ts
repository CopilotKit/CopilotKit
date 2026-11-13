import { describe, expect, it, vi } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";
import {
  MCPAppsRequestQueue,
  MCP_APPS_QUEUE_IDLE_TIMEOUT_MS,
  MCPAppsQueueThreadChangedError,
} from "../request-queue";

/**
 * Agent stub exposing the surface the queue touches: `isRunning`, `threadId`
 * and a run-lifecycle subscription.
 */
function makeAgent(opts?: { isRunning?: boolean; threadId?: string }) {
  const subscribers = new Set<{
    onRunFinalized?: () => void;
    onRunFailed?: () => void;
  }>();
  const agent = {
    threadId: opts?.threadId ?? "thread-1",
    isRunning: opts?.isRunning ?? false,
    subscribe(subscriber: Record<string, () => void>) {
      subscribers.add(subscriber);
      return {
        unsubscribe() {
          subscribers.delete(subscriber);
        },
      };
    },
    /** Simulate the active run finishing. */
    goIdle() {
      agent.isRunning = false;
      subscribers.forEach((s) => s.onRunFinalized?.());
    },
    get subscriberCount() {
      return subscribers.size;
    },
  };
  return agent as unknown as AbstractAgent & {
    goIdle(): void;
    subscriberCount: number;
    isRunning: boolean;
  };
}

const ok = { result: {}, newMessages: [] } as never;
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

describe("MCPAppsRequestQueue ordering", () => {
  it("runs requests for one thread in FIFO order", async () => {
    const queue = new MCPAppsRequestQueue();
    const agent = makeAgent();
    const order: string[] = [];
    const record = (name: string) => async () => {
      order.push(name);
      return ok;
    };

    const first = queue.enqueue(agent, record("first"));
    const second = queue.enqueue(agent, record("second"));
    const third = queue.enqueue(agent, record("third"));
    await Promise.all([first, second, third]);

    expect(order).toEqual(["first", "second", "third"]);
  });
});

describe("MCPAppsRequestQueue ownership", () => {
  it("does not run work cancelled by its owner while it waited for a busy agent", async () => {
    const queue = new MCPAppsRequestQueue();
    const agent = makeAgent({ isRunning: true });
    const ownerA = {};
    const ownerB = {};
    const runA = vi.fn(async () => ok);
    const runB = vi.fn(async () => ok);

    const promiseA = queue.enqueue(agent, runA, { owner: ownerA });
    const promiseB = queue.enqueue(agent, runB, { owner: ownerB });
    promiseB.catch(() => {}); // cancellation rejects; assert on the spy below

    // B's widget tears down before the agent frees up.
    queue.cancelOwner(ownerB);
    agent.goIdle();
    await promiseA;
    await tick(20);

    // A still ran; B's queued request never reached the agent.
    expect(runA).toHaveBeenCalledTimes(1);
    expect(runB).not.toHaveBeenCalled();
  });

  it("rejects the cancelled caller instead of leaving its promise pending", async () => {
    const queue = new MCPAppsRequestQueue();
    const agent = makeAgent({ isRunning: true });
    const owner = {};

    const promise = queue.enqueue(agent, async () => ok, { owner });
    queue.cancelOwner(owner);

    await expect(promise).rejects.toThrow(/cancelled on teardown/i);
  });

  it("leaves other owners' queued work alone", async () => {
    const queue = new MCPAppsRequestQueue();
    const agent = makeAgent({ isRunning: true });
    const kept = vi.fn(async () => ok);
    const ownerKept = {};

    const promiseKept = queue.enqueue(agent, kept, { owner: ownerKept });
    // Cancelling an unrelated owner must not touch this request.
    queue.cancelOwner({});
    agent.goIdle();
    await promiseKept;

    expect(kept).toHaveBeenCalledTimes(1);
  });

  it("keeps two agents sharing a thread id independent", async () => {
    const queue = new MCPAppsRequestQueue();
    // Same threadId, different agent instances: one being busy must not hold the
    // other's queue.
    const busy = makeAgent({ isRunning: true, threadId: "shared" });
    const idle = makeAgent({ isRunning: false, threadId: "shared" });
    const onBusy = vi.fn(async () => ok);
    const onIdle = vi.fn(async () => ok);

    queue.enqueue(busy, onBusy);
    await queue.enqueue(idle, onIdle);

    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(onBusy).not.toHaveBeenCalled();
    busy.goIdle();
  });
});

describe("MCPAppsRequestQueue busy-agent timeout", () => {
  it("rejects (and frees its listeners) when the agent never goes idle", async () => {
    vi.useFakeTimers();
    try {
      const queue = new MCPAppsRequestQueue();
      const agent = makeAgent({ isRunning: true });
      const run = vi.fn(async () => ok);

      const promise = queue.enqueue(agent, run, { timeoutMs: 1000 });
      const assertion = expect(promise).rejects.toThrow(/Timed out/i);
      await vi.advanceTimersByTimeAsync(1100);
      await assertion;

      expect(run).not.toHaveBeenCalled();
      // The idle wait must not leak its agent subscription or interval.
      expect(agent.subscriberCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("defaults to a 30s wait", () => {
    expect(MCP_APPS_QUEUE_IDLE_TIMEOUT_MS).toBe(30_000);
  });

  it("does not time out work that starts before the deadline", async () => {
    const queue = new MCPAppsRequestQueue();
    const agent = makeAgent({ isRunning: true });
    const run = vi.fn(async () => ok);

    const promise = queue.enqueue(agent, run, { timeoutMs: 5000 });
    await tick(20);
    agent.goIdle();
    await promise;

    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("MCPAppsRequestQueue cancellation cleanup", () => {
  it("releases the timer and agent subscription as soon as the owner cancels", async () => {
    const queue = new MCPAppsRequestQueue();
    const agent = makeAgent({ isRunning: true });
    const owner = {};

    const promise = queue.enqueue(agent, async () => ok, { owner });
    promise.catch(() => {});
    await tick(10);
    // The item is waiting on the busy agent, so it holds a subscription.
    expect(agent.subscriberCount).toBe(1);

    queue.cancelOwner(owner);
    await tick(10);

    // Angular parity: cancelling frees the wait immediately, it does not linger
    // until the agent frees up or the timeout fires.
    expect(agent.subscriberCount).toBe(0);
  });
});

describe("Angular cancellation policy", () => {
  it("releases active owned waits and passes an abort signal without cancelling another owner", async () => {
    const queue = new MCPAppsRequestQueue();
    const agent = makeAgent();
    const owner = {};
    let signal: AbortSignal | undefined;
    const active = queue.enqueue(
      agent,
      (value) => {
        signal = value;
        return new Promise(() => {});
      },
      { owner, cancelRunningWait: true },
    );
    const rejected = expect(active).rejects.toThrow(/cancelled/);
    await tick();
    const survivor = queue.enqueue(agent, async () => ok, { owner: {} });
    queue.cancelOwner(owner);
    await rejected;
    expect(signal?.aborted).toBe(true);
    await expect(survivor).resolves.toEqual(ok);
  });

  it("keeps the default wait for an already-running request", async () => {
    const queue = new MCPAppsRequestQueue();
    const agent = makeAgent();
    const owner = {};
    let finish!: () => void;
    const active = queue.enqueue(
      agent,
      () =>
        new Promise((resolve) => {
          finish = () => resolve(ok);
        }),
      { owner },
    );
    await tick();
    queue.cancelOwner(owner);
    finish();
    await expect(active).resolves.toEqual(ok);
  });
});

describe("MCPAppsRequestQueue thread guard", () => {
  it("drops queued work when the agent switched threads, and keeps serving the current one", async () => {
    const queue = new MCPAppsRequestQueue();
    // One shared agent object whose threadId is mutated in place - the failure
    // mode the queue key alone does not protect against.
    const agent = makeAgent({ isRunning: true, threadId: "thread-1" });
    const stale = vi.fn(async () => ok);

    const staleCall = queue.enqueue(agent, stale, {
      dropAfterThreadSwitch: true,
    });
    const rejection = expect(staleCall).rejects.toThrow(
      MCPAppsQueueThreadChangedError,
    );

    // The host switches threads while the request waits, then the agent frees up.
    (agent as { threadId: string }).threadId = "thread-2";
    agent.goIdle();
    await rejection;
    expect(stale).not.toHaveBeenCalled();

    // A request enqueued on the current thread still runs normally.
    const fresh = vi.fn(async () => ok);
    await queue.enqueue(agent, fresh, { dropAfterThreadSwitch: true });
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  it("runs queued work when the thread did not change", async () => {
    const queue = new MCPAppsRequestQueue();
    const agent = makeAgent({ isRunning: true, threadId: "thread-1" });
    const run = vi.fn(async () => ok);

    const promise = queue.enqueue(agent, run, { dropAfterThreadSwitch: true });
    await tick(10);
    agent.goIdle();
    await promise;

    expect(run).toHaveBeenCalledTimes(1);
  });
});
