import { expect, test, vi } from "vitest";
import { createComponentRevisionQueue } from "./component-revision-queue.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("the revision queue serializes delivery and keeps only the newest pending revision", async () => {
  const firstDelivery = deferred();
  const firstStarted = deferred();
  const delivered: number[] = [];
  const prepared: number[] = [];
  const queue = createComponentRevisionQueue<number>({
    prepare: async ({ value }) => {
      prepared.push(value);
      return value;
    },
    deliver: async (value) => {
      delivered.push(value);
      if (value === 1) {
        firstStarted.resolve();
        await firstDelivery.promise;
      }
    },
    minIntervalMs: 0,
  });

  const first = queue.enqueue({ revision: 1, value: 1 });
  const skipped = queue.enqueue({ revision: 2, value: 2 });
  const newest = queue.enqueue({ revision: 3, value: 3 });
  await firstStarted.promise;

  expect(delivered).toEqual([1]);
  firstDelivery.resolve();
  await Promise.all([first, skipped, newest, queue.drain()]);

  expect(delivered).toEqual([1, 3]);
  expect(prepared).toEqual([1, 3]);
  await expect(skipped).resolves.toEqual({ deliveredRevision: 3 });
});

test("the revision queue applies provider cadence with an injected clock", async () => {
  let now = 1_000;
  const waits: number[] = [];
  const queue = createComponentRevisionQueue<number>({
    prepare: async ({ value }) => value,
    deliver: async () => undefined,
    minIntervalMs: 800,
    now: () => now,
    sleep: async (milliseconds) => {
      waits.push(milliseconds);
      now += milliseconds;
    },
  });

  await queue.enqueue({ revision: 1, value: 1, terminal: true });
  now += 300;
  await queue.enqueue({ revision: 2, value: 2, terminal: true });

  expect(waits).toEqual([500]);
});

test("terminal revisions flush in order and cannot be coalesced", async () => {
  const delivered: number[] = [];
  const queue = createComponentRevisionQueue<number>({
    prepare: async ({ value }) => value,
    deliver: async (value) => {
      delivered.push(value);
    },
    minIntervalMs: 0,
  });

  await Promise.all([
    queue.enqueue({ revision: 1, value: 1, terminal: true }),
    queue.enqueue({ revision: 2, value: 2, terminal: true }),
    queue.drain(),
  ]);

  expect(delivered).toEqual([1, 2]);
});

test("a pending terminal revision supersedes a pending nonterminal revision", async () => {
  const gate = deferred();
  const started = deferred();
  const delivered: number[] = [];
  const queue = createComponentRevisionQueue<number>({
    prepare: async ({ value }) => value,
    deliver: async (value) => {
      delivered.push(value);
      if (value === 1) {
        started.resolve();
        await gate.promise;
      }
    },
    minIntervalMs: 0,
  });

  const first = queue.enqueue({ revision: 1, value: 1 });
  await started.promise;
  const skipped = queue.enqueue({ revision: 2, value: 2 });
  const terminal = queue.enqueue({ revision: 3, value: 3, terminal: true });
  gate.resolve();
  await Promise.all([first, skipped, terminal, queue.drain()]);

  expect(delivered).toEqual([1, 3]);
  await expect(skipped).resolves.toEqual({ deliveredRevision: 3 });
});

test("a provider retry prepares and persists a revision only once", async () => {
  const prepare = vi.fn(async ({ value }: { value: string }) => value);
  const deliver = vi
    .fn<(value: string) => Promise<void>>()
    .mockRejectedValueOnce(new Error("temporary provider failure"))
    .mockResolvedValue(undefined);
  const queue = createComponentRevisionQueue<string>({
    prepare,
    deliver,
    minIntervalMs: 0,
    maxAttempts: 2,
    retryDelayMs: () => 0,
    sleep: async () => undefined,
  });

  await queue.enqueue({ revision: 1, value: "ready", terminal: true });

  expect(prepare).toHaveBeenCalledOnce();
  expect(deliver).toHaveBeenCalledTimes(2);
});

test("the revision queue rejects stale or duplicate revisions", async () => {
  const queue = createComponentRevisionQueue<number>({
    prepare: async ({ value }) => value,
    deliver: async () => undefined,
    minIntervalMs: 0,
  });

  await queue.enqueue({ revision: 2, value: 2 });

  await expect(queue.enqueue({ revision: 2, value: 2 })).rejects.toMatchObject({
    code: "channel_component_stale_revision",
  });
});

test("a failed delivery rejects its waiter and later revisions can still run", async () => {
  const delivered: number[] = [];
  const queue = createComponentRevisionQueue<number>({
    prepare: async ({ value }) => value,
    deliver: async (value) => {
      delivered.push(value);
      if (value === 1) throw new Error("provider unavailable");
    },
    minIntervalMs: 0,
  });

  await expect(
    queue.enqueue({ revision: 1, value: 1, terminal: true }),
  ).rejects.toThrow("provider unavailable");
  await expect(
    queue.enqueue({ revision: 2, value: 2, terminal: true }),
  ).resolves.toEqual({ deliveredRevision: 2 });

  expect(delivered).toEqual([1, 2]);
});

test("the revision queue rejects invalid retry and cadence configuration", () => {
  const shared = {
    prepare: async ({ value }: { value: number }) => value,
    deliver: async () => undefined,
  };

  expect(() =>
    createComponentRevisionQueue({ ...shared, minIntervalMs: -1 }),
  ).toThrow("minIntervalMs must not be negative");
  expect(() =>
    createComponentRevisionQueue({
      ...shared,
      minIntervalMs: 0,
      maxAttempts: 0,
    }),
  ).toThrow("maxAttempts must be at least one");
});
