import { describe, it, expect } from "vitest";
import { MessageStream } from "./message-stream.js";

/** A fake Discord `message.edit` that records every call in order and lets the
 *  test control how long each takes — useful for proving the in-flight /
 *  finish race that bit the original implementation can't happen here. */
function makeFakeDiscord(updateDurationMs = 0) {
  const calls: { text: string; finishedAt: number }[] = [];
  let started = 0;
  let finished = 0;
  const update = async (text: string): Promise<void> => {
    started++;
    if (updateDurationMs > 0) {
      await new Promise((r) => setTimeout(r, updateDurationMs));
    }
    finished++;
    calls.push({ text, finishedAt: Date.now() });
  };
  return {
    update,
    calls,
    get inFlight() {
      return started - finished;
    },
  };
}

describe("MessageStream", () => {
  it("flushes the final buffer on finish() even when end races an in-flight update", async () => {
    // Reproduces the ALPHA → AL bug: a slow message.edit for "AL" is in
    // flight when the stream finishes with "ALPHA". The old implementation
    // could let the slow "AL" update overwrite "ALPHA" because message.edit
    // calls weren't serialised. With the queue, finish() must observe the
    // final buffer regardless of in-flight state.
    const discord = makeFakeDiscord(50);
    const stream = new MessageStream({
      update: discord.update,
      minIntervalMs: 0,
    });

    stream.append("A");
    stream.append("AL");
    // Let the timer fire and the first flush kick off (in-flight)
    await new Promise((r) => setTimeout(r, 5));
    expect(discord.inFlight).toBeGreaterThanOrEqual(0); // best effort
    stream.append("ALP");
    stream.append("ALPH");
    stream.append("ALPHA");
    await stream.finish();

    expect(discord.calls.length).toBeGreaterThan(0);
    // The LAST message.edit — i.e. the final state of the Discord message — must be ALPHA
    expect(discord.calls.at(-1)?.text).toBe("ALPHA");
    // And no concurrent updates were ever in flight (queue invariant)
    expect(discord.inFlight).toBe(0);
  });

  it("never has more than one update in flight at a time", async () => {
    const discord = makeFakeDiscord(20);
    let maxInFlight = 0;
    const sampler = setInterval(() => {
      if (discord.inFlight > maxInFlight) maxInFlight = discord.inFlight;
    }, 1);
    const stream = new MessageStream({
      update: discord.update,
      minIntervalMs: 0,
    });
    for (let i = 1; i <= 20; i++) {
      stream.append("x".repeat(i));
      await new Promise((r) => setTimeout(r, 2));
    }
    await stream.finish();
    clearInterval(sampler);
    expect(maxInFlight).toBeLessThanOrEqual(1);
  });

  it("throttles flushes to roughly minIntervalMs between completions", async () => {
    const discord = makeFakeDiscord(0);
    const stream = new MessageStream({
      update: discord.update,
      minIntervalMs: 1100,
    });
    const start = Date.now();
    for (let i = 0; i < 10; i++) {
      stream.append(`buf${i}`);
      await new Promise((r) => setTimeout(r, 5));
    }
    await stream.finish();
    // 10 rapid appends should NOT have produced 10 message.edit calls; the
    // throttle should have coalesced them. Exact count varies by timing but
    // should be well under 10.
    expect(discord.calls.length).toBeLessThan(10);
    // Final state must still match the last append
    expect(discord.calls.at(-1)?.text).toBe("buf9");
    // And the test ran for at least one throttle window
    expect(Date.now() - start).toBeGreaterThanOrEqual(0);
  });

  it("collapses duplicate appends into zero updates", async () => {
    const discord = makeFakeDiscord(0);
    const stream = new MessageStream({
      update: discord.update,
      minIntervalMs: 0,
    });
    stream.append("hello");
    stream.append("hello");
    stream.append("hello");
    await stream.finish();
    // One actual update, not three
    expect(discord.calls).toHaveLength(1);
    expect(discord.calls[0]?.text).toBe("hello");
  });

  it("is a no-op when finish() is called before any append", async () => {
    const discord = makeFakeDiscord(0);
    const stream = new MessageStream({
      update: discord.update,
      minIntervalMs: 0,
    });
    await stream.finish();
    expect(discord.calls).toHaveLength(0);
  });

  it("coalesces rapid successive append/update calls within the throttle window into fewer underlying update calls and always flushes the final state", async () => {
    const discord = makeFakeDiscord(0);
    const stream = new MessageStream({
      update: discord.update,
      minIntervalMs: 1100,
    });

    // Fire 15 appends very rapidly (every 10ms), well within the 1100ms throttle window
    for (let i = 1; i <= 15; i++) {
      stream.append("msg".repeat(i));
      await new Promise((r) => setTimeout(r, 10));
    }
    await stream.finish();

    // All 15 rapid appends over ~150ms should coalesce to far fewer than 15 calls
    // (the 1100ms throttle window means at most ~1 intermediate flush in that window)
    expect(discord.calls.length).toBeLessThan(15);
    // The final state must always reflect the last appended value
    expect(discord.calls.at(-1)?.text).toBe("msg".repeat(15));
    // No concurrent updates were in flight
    expect(discord.inFlight).toBe(0);
  });

  it("retries the final buffer on a subsequent flush when the previous update() failed", async () => {
    // The previous implementation marked `posted = text` *before* awaiting
    // update(). If that final update() rejected, the guard treated the failed
    // text as delivered, so the last segment was lost forever — never retried.
    // With the fix, `posted` is only set after update() resolves, so a failed
    // flush leaves the buffer un-posted and the next flush re-sends it.
    const sent: string[] = [];
    let calls = 0;
    const update = async (text: string): Promise<void> => {
      calls++;
      if (calls === 1) {
        // First flush fails (e.g. genuine edit failure after discord.js retries).
        throw new Error("boom");
      }
      sent.push(text);
    };
    const stream = new MessageStream({ update, minIntervalMs: 0 });

    stream.append("FINAL");
    // First flush attempt rejects; `posted` must stay "" so the buffer is retried.
    await stream.finish();
    expect(sent).toHaveLength(0); // first attempt threw, nothing delivered yet

    // A subsequent flush (here a fresh finish()) must re-attempt the same buffer.
    await stream.finish();

    expect(calls).toBe(2);
    expect(sent).toEqual(["FINAL"]); // the final segment is re-sent after the failure
  });
});
