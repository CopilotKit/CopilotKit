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
});
