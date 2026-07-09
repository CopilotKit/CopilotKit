import { describe, it, expect, vi } from "vitest";
import { TeamsMessageStream } from "./message-stream.js";

describe("TeamsMessageStream", () => {
  it("posts once with the final text for a single synchronous burst", async () => {
    const post = vi.fn(async () => "act-1");
    const update = vi.fn(async () => {});
    const typing = vi.fn(async () => {});
    const s = new TeamsMessageStream({ post, update, typing });

    s.append("Hello");
    s.append("Hello world");
    const id = await s.finish();

    expect(id).toBe("act-1");
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith("Hello world");
    expect(update).not.toHaveBeenCalled();
    expect(typing).toHaveBeenCalledTimes(1);
  });

  it("never posts for an empty stream", async () => {
    const post = vi.fn(async () => "x");
    const update = vi.fn(async () => {});
    const s = new TeamsMessageStream({ post, update });

    const id = await s.finish();

    expect(id).toBeUndefined();
    expect(post).not.toHaveBeenCalled();
  });

  it("posts first, then edits the same message as the buffer grows", async () => {
    vi.useFakeTimers();
    try {
      const post = vi.fn(async () => "act-1");
      const update = vi.fn(async () => {});
      const s = new TeamsMessageStream({ post, update, minIntervalMs: 100 });

      s.append("A");
      await vi.advanceTimersByTimeAsync(150); // let the throttled flush fire
      expect(post).toHaveBeenCalledWith("A");

      s.append("AB");
      const id = await s.finish();

      expect(id).toBe("act-1");
      expect(update).toHaveBeenCalledWith("act-1", "AB");
    } finally {
      vi.useRealTimers();
    }
  });
});
