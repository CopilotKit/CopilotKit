import { describe, it, expect, vi } from "vitest";
import { MessageStream } from "./message-stream.js";

describe("MessageStream", () => {
  it("flushes the final buffer on finish()", async () => {
    const update = vi.fn(async () => {});
    const s = new MessageStream({ update, minIntervalMs: 0 });
    s.append("hello");
    s.append("hello world");
    await s.finish();
    expect(update).toHaveBeenLastCalledWith("hello world");
  });

  it("retries the final flush once and recovers from a transient failure", async () => {
    const update = vi
      .fn<(text: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("429"))
      .mockResolvedValue(undefined);
    const s = new MessageStream({ update, minIntervalMs: 0 });
    s.append("the complete answer");
    await s.finish();
    // First call rejected, retry succeeded → the text IS eventually written.
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenNthCalledWith(1, "the complete answer");
    expect(update).toHaveBeenNthCalledWith(2, "the complete answer");
  });

  it("swallows a persistent failure and does not advance posted (next append re-flushes)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const update = vi
      .fn<(text: string) => Promise<void>>()
      // Initial + retry both reject for the first flush.
      .mockRejectedValueOnce(new Error("429"))
      .mockRejectedValueOnce(new Error("429"))
      // Subsequent flush succeeds.
      .mockResolvedValue(undefined);
    const s = new MessageStream({ update, minIntervalMs: 0 });

    s.append("first answer");
    await expect(s.finish()).resolves.toBeUndefined();
    // Initial + one retry, both failed and swallowed.
    expect(update).toHaveBeenCalledTimes(2);

    // posted was NOT advanced, so a new append+flush still attempts the write.
    s.append("second answer");
    await s.finish();
    expect(update).toHaveBeenCalledTimes(3);
    expect(update).toHaveBeenLastCalledWith("second answer");

    errSpy.mockRestore();
  });
});

describe("MessageStream throttle", () => {
  it("waits out the throttle before the final flush and before its retry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    try {
      const at: number[] = [];
      const update = vi.fn(async () => {
        at.push(Date.now());
        // The final write is rate-limited once, then succeeds.
        if (at.length === 2) throw new Error("429");
      });
      const s = new MessageStream({ update, minIntervalMs: 1000 });
      s.append("partial");
      await vi.advanceTimersByTimeAsync(0); // first flush, at once
      s.append("partial and the rest");
      const done = s.finish();
      await vi.advanceTimersByTimeAsync(5000);
      await done;
      expect(at).toEqual([10_000, 11_000, 12_000]);
      expect(update).toHaveBeenLastCalledWith("partial and the rest");
    } finally {
      vi.useRealTimers();
    }
  });
});
