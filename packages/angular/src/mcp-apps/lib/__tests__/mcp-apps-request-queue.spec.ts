import { expect, it, vi } from "vitest";
import {
  MCPAppsQueueCancelledError,
  MCPAppsQueueThreadChangedError,
  MCPAppsRequestQueue,
  MCPAppsQueueTimeoutError,
  type MCPAppsQueueAgent,
} from "../mcp-apps-request-queue";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function idleAgent(threadId = "thread-1"): MCPAppsQueueAgent {
  return {
    threadId,
    isRunning: false,
    subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
  };
}

it("runs requests for one thread in FIFO order", async () => {
  const queue = new MCPAppsRequestQueue({ idleTimeoutMs: 100 });
  const agent = idleAgent();
  const first = deferred<string>();
  const calls: string[] = [];

  const firstResult = queue.enqueue({
    agent,
    ownerId: "renderer-1",
    execute: async () => {
      calls.push("first:start");
      const result = await first.promise;
      calls.push("first:end");
      return result;
    },
  });
  const secondResult = queue.enqueue({
    agent,
    ownerId: "renderer-2",
    execute: async () => {
      calls.push("second");
      return "second";
    },
  });

  await Promise.resolve();
  expect(calls).toEqual(["first:start"]);
  first.resolve("first");

  await expect(firstResult).resolves.toBe("first");
  await expect(secondResult).resolves.toBe("second");
  expect(calls).toEqual(["first:start", "first:end", "second"]);
});

it("times out while an agent remains busy and unsubscribes", async () => {
  vi.useFakeTimers();
  const unsubscribe = vi.fn();
  const agent: MCPAppsQueueAgent = {
    threadId: "thread-1",
    isRunning: true,
    subscribe: vi.fn(() => ({ unsubscribe })),
  };
  const queue = new MCPAppsRequestQueue({
    idleTimeoutMs: 25,
    idlePollIntervalMs: 5,
  });

  const result = queue.enqueue({
    agent,
    ownerId: "renderer-1",
    execute: vi.fn(async () => "unreachable"),
  });
  const assertion = expect(result).rejects.toBeInstanceOf(
    MCPAppsQueueTimeoutError,
  );
  await vi.advanceTimersByTimeAsync(25);

  await assertion;
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  vi.useRealTimers();
});

it("cancels only work owned by the destroyed renderer", async () => {
  const queue = new MCPAppsRequestQueue({ idleTimeoutMs: 100 });
  const agent = idleAgent();
  const blocker = deferred<string>();

  const active = queue.enqueue({
    agent,
    ownerId: "renderer-1",
    execute: () => blocker.promise,
  });
  const cancelled = queue.enqueue({
    agent,
    ownerId: "renderer-1",
    execute: async () => "cancelled",
  });
  const survivor = queue.enqueue({
    agent,
    ownerId: "renderer-2",
    execute: async () => "survived",
  });

  queue.cancelOwner("renderer-1");
  blocker.resolve("late");

  await expect(active).rejects.toBeInstanceOf(MCPAppsQueueCancelledError);
  await expect(cancelled).rejects.toBeInstanceOf(MCPAppsQueueCancelledError);
  await expect(survivor).resolves.toBe("survived");
});

it("drops a queued follow-up when its agent has switched threads", async () => {
  const queue = new MCPAppsRequestQueue({ idleTimeoutMs: 100 });
  const agent = idleAgent("thread-1");
  const blocker = deferred<string>();
  const executeFollowUp = vi.fn(async () => "leaked");

  const active = queue.enqueue({
    agent,
    ownerId: "renderer-1",
    execute: () => blocker.promise,
  });
  const followUp = queue.enqueue({
    agent,
    ownerId: "renderer-1",
    dropAfterThreadSwitch: true,
    execute: executeFollowUp,
  });

  agent.threadId = "thread-2";
  blocker.resolve("done");

  await expect(active).resolves.toBe("done");
  await expect(followUp).rejects.toBeInstanceOf(MCPAppsQueueThreadChangedError);
  expect(executeFollowUp).not.toHaveBeenCalled();
});

it("passes an abort signal to active owned work", async () => {
  const queue = new MCPAppsRequestQueue({ idleTimeoutMs: 100 });
  const agent = idleAgent();
  const observedAbort = deferred<void>();

  const result = queue.enqueue({
    agent,
    ownerId: "renderer-1",
    execute: async (signal) => {
      signal.addEventListener("abort", () => observedAbort.resolve(), {
        once: true,
      });
      return new Promise<string>(() => undefined);
    },
  });
  await Promise.resolve();

  queue.cancelOwner("renderer-1");

  await observedAbort.promise;
  await expect(result).rejects.toBeInstanceOf(MCPAppsQueueCancelledError);
});
