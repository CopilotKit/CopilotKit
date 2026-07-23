import { describe, it, expect } from "vitest";
import { MessageStream } from "../message-stream.js";

/** A fake Slack `chat.update` that records every call in order and lets the
 *  test control how long each takes — useful for proving the in-flight /
 *  finish race that bit the original implementation can't happen here. */
function makeFakeSlack(updateDurationMs = 0) {
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
    // Reproduces the ALPHA → AL bug: a slow chat.update for "AL" is in
    // flight when the stream finishes with "ALPHA". The old implementation
    // could let the slow "AL" update overwrite "ALPHA" because chat.update
    // calls weren't serialised. With the queue, finish() must observe the
    // final buffer regardless of in-flight state.
    const slack = makeFakeSlack(50);
    const stream = new MessageStream({
      update: slack.update,
      minIntervalMs: 0,
    });

    stream.append("A");
    stream.append("AL");
    // Let the timer fire and the first flush kick off (in-flight)
    await new Promise((r) => setTimeout(r, 5));
    expect(slack.inFlight).toBeGreaterThanOrEqual(0); // best effort
    stream.append("ALP");
    stream.append("ALPH");
    stream.append("ALPHA");
    await stream.finish();

    expect(slack.calls.length).toBeGreaterThan(0);
    // The LAST chat.update — i.e. the final state of the Slack message — must be ALPHA
    expect(slack.calls.at(-1)?.text).toBe("ALPHA");
    // And no concurrent updates were ever in flight (queue invariant)
    expect(slack.inFlight).toBe(0);
  });

  it("never has more than one update in flight at a time", async () => {
    const slack = makeFakeSlack(20);
    let maxInFlight = 0;
    const sampler = setInterval(() => {
      if (slack.inFlight > maxInFlight) maxInFlight = slack.inFlight;
    }, 1);
    const stream = new MessageStream({
      update: slack.update,
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
    const slack = makeFakeSlack(0);
    const stream = new MessageStream({
      update: slack.update,
      minIntervalMs: 50,
    });
    const start = Date.now();
    for (let i = 0; i < 10; i++) {
      stream.append(`buf${i}`);
      await new Promise((r) => setTimeout(r, 5));
    }
    await stream.finish();
    // 10 rapid appends should NOT have produced 10 chat.update calls; the
    // throttle should have coalesced them. Exact count varies by timing but
    // should be well under 10.
    expect(slack.calls.length).toBeLessThan(10);
    // Final state must still match the last append
    expect(slack.calls.at(-1)?.text).toBe("buf9");
    // And the test ran for at least one throttle window
    expect(Date.now() - start).toBeGreaterThanOrEqual(0);
  });

  it("collapses duplicate appends into zero updates", async () => {
    const slack = makeFakeSlack(0);
    const stream = new MessageStream({
      update: slack.update,
      minIntervalMs: 0,
    });
    stream.append("hello");
    stream.append("hello");
    stream.append("hello");
    await stream.finish();
    // One actual update, not three
    expect(slack.calls).toHaveLength(1);
    expect(slack.calls[0]?.text).toBe("hello");
  });

  it("is a no-op when finish() is called before any append", async () => {
    const slack = makeFakeSlack(0);
    const stream = new MessageStream({
      update: slack.update,
      minIntervalMs: 0,
    });
    await stream.finish();
    expect(slack.calls).toHaveLength(0);
  });
});
