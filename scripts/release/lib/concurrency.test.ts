import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "./concurrency.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe("mapWithConcurrency", () => {
  it("returns results in INPUT order, not completion order", async () => {
    // Reverse-staggered delays: later items settle first.
    const results = await mapWithConcurrency([3, 2, 1], 3, async (n) => {
      for (let i = 0; i < n; i++) await tick();
      return n * 10;
    });

    expect(results.map((r) => r.value)).toEqual([30, 20, 10]);
  });

  it("never exceeds the concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;

    await mapWithConcurrency(
      Array.from({ length: 20 }, (_, i) => i),
      4,
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await tick();
        await tick();
        inFlight--;
      },
    );

    expect(peak).toBe(4);
  });

  it("attempts EVERY item even when some reject, so one report names all failures", async () => {
    const attempted: number[] = [];

    const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      attempted.push(n);
      if (n % 2 === 0) throw new Error(`boom ${n}`);
      return n;
    });

    expect(attempted.sort()).toEqual([1, 2, 3, 4, 5]);
    const failures = results.filter((r) => r.error);
    expect(failures).toHaveLength(2);
    expect(failures.map((f) => f.item)).toEqual([2, 4]);
    // Successes are still reported alongside the failures.
    expect(results.filter((r) => !r.error).map((r) => r.value)).toEqual([
      1, 3, 5,
    ]);
  });

  it("pairs each error with the item that produced it", async () => {
    const results = await mapWithConcurrency(["a", "b"], 1, async (s) => {
      if (s === "b") throw new Error("failed-b");
      return s;
    });

    expect(results[1].item).toBe("b");
    expect((results[1].error as Error).message).toBe("failed-b");
    expect(results[0].error).toBeUndefined();
  });

  it("handles an empty list without spawning workers", async () => {
    await expect(mapWithConcurrency([], 4, async () => 1)).resolves.toEqual([]);
  });

  it("caps workers at the item count when the limit exceeds it", async () => {
    let peak = 0;
    let inFlight = 0;

    await mapWithConcurrency([1, 2], 16, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await tick();
      inFlight--;
    });

    expect(peak).toBe(2);
  });

  it("runs serially at limit 1, preserving the old behaviour as an escape hatch", async () => {
    const order: string[] = [];

    await mapWithConcurrency([1, 2, 3], 1, async (n) => {
      order.push(`start${n}`);
      await tick();
      order.push(`end${n}`);
    });

    expect(order).toEqual([
      "start1",
      "end1",
      "start2",
      "end2",
      "start3",
      "end3",
    ]);
  });

  it("rejects a nonsensical limit rather than silently running serially", async () => {
    await expect(mapWithConcurrency([1], 0, async () => 1)).rejects.toThrow(
      /positive integer/,
    );
    await expect(mapWithConcurrency([1], 1.5, async () => 1)).rejects.toThrow(
      /positive integer/,
    );
    await expect(mapWithConcurrency([1], NaN, async () => 1)).rejects.toThrow(
      /positive integer/,
    );
  });
});
