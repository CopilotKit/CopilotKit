import { describe, it, expect, vi } from "vitest";
import { emojiTriage } from "../index.js";

function fakeThread() {
  return {
    react: vi.fn().mockResolvedValue({ ok: true }),
    runAgent: vi.fn().mockResolvedValue(undefined),
  };
}

describe("emojiTriage", () => {
  it("ignores reaction removals", async () => {
    const thread = fakeThread();
    await emojiTriage({
      added: false,
      emoji: "bug",
      messageId: "t1",
      thread,
    } as never);
    expect(thread.runAgent).not.toHaveBeenCalled();
    expect(thread.react).not.toHaveBeenCalled();
  });

  it("acks 👀, runs the bug-triage prompt, then acks ✅", async () => {
    const thread = fakeThread();
    await emojiTriage({
      added: true,
      emoji: "bug",
      messageId: "t1",
      user: { id: "U1" },
      thread,
    } as never);
    // pickup ack on the reacted message, then done ack
    expect(thread.react).toHaveBeenNthCalledWith(1, { id: "t1" }, "eyes");
    expect(thread.runAgent).toHaveBeenCalledTimes(1);
    const prompt = thread.runAgent.mock.calls[0]![0].prompt as string;
    expect(prompt).toMatch(/bug/i);
    expect(thread.react).toHaveBeenNthCalledWith(2, { id: "t1" }, "check");
  });

  it("fire emoji triggers a runAgent call", async () => {
    const thread = fakeThread();
    await emojiTriage({
      added: true,
      emoji: "fire",
      messageId: "t2",
      user: { id: "U1" },
      thread,
    } as never);
    expect(thread.runAgent).toHaveBeenCalledTimes(1);
    const prompt = thread.runAgent.mock.calls[0]![0].prompt as string;
    expect(prompt).toMatch(/escalat|urgent|high.priority/i);
  });

  it("check emoji triggers a runAgent call", async () => {
    const thread = fakeThread();
    await emojiTriage({
      added: true,
      emoji: "check",
      messageId: "t3",
      user: { id: "U1" },
      thread,
    } as never);
    expect(thread.runAgent).toHaveBeenCalledTimes(1);
    const prompt = thread.runAgent.mock.calls[0]![0].prompt as string;
    expect(prompt).toMatch(/triage|handled|acknowledge/i);
  });

  it("does nothing for an unmapped emoji", async () => {
    const thread = fakeThread();
    await emojiTriage({
      added: true,
      emoji: "heart",
      messageId: "t1",
      thread,
    } as never);
    expect(thread.runAgent).not.toHaveBeenCalled();
  });

  it("reacts with ⚠️ and does not throw when runAgent rejects", async () => {
    const thread = {
      react: vi.fn().mockResolvedValue({ ok: true }),
      runAgent: vi.fn().mockRejectedValue(new Error("agent down")),
    };
    // The handler must resolve (not rethrow) so the bot doesn't crash.
    await expect(
      emojiTriage({
        added: true,
        emoji: "bug",
        messageId: "t1",
        user: { id: "U1" },
        thread,
      } as never),
    ).resolves.toBeUndefined();
    // ⚠️ degradation ack must have been sent
    expect(thread.react).toHaveBeenCalledWith({ id: "t1" }, "warning");
    // ✅ must NOT have been sent on error
    expect(thread.react).not.toHaveBeenCalledWith({ id: "t1" }, "check");
  });
});
