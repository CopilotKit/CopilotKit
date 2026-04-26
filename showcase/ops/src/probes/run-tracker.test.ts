import { describe, it, expect } from "vitest";
import { ProbeRunTracker } from "./run-tracker.js";

function mkClock(start = 1_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    set: (v: number) => {
      t = v;
    },
  };
}

describe("ProbeRunTracker", () => {
  it("records constructor metadata (probeId, startedAt, triggered)", () => {
    const clock = mkClock(5_000);
    const tracker = new ProbeRunTracker({
      probeId: "smoke",
      triggered: true,
      now: clock.now,
    });
    expect(tracker.probeId).toBe("smoke");
    expect(tracker.startedAt).toBe(5_000);
    expect(tracker.triggered).toBe(true);
  });

  it("defaults triggered to false when not provided", () => {
    const tracker = new ProbeRunTracker({
      probeId: "smoke",
      now: () => 0,
    });
    expect(tracker.triggered).toBe(false);
  });

  it("uses Date.now() when now() is not injected", () => {
    const before = Date.now();
    const tracker = new ProbeRunTracker({ probeId: "smoke" });
    const after = Date.now();
    expect(tracker.startedAt).toBeGreaterThanOrEqual(before);
    expect(tracker.startedAt).toBeLessThanOrEqual(after);
  });

  it("enqueue adds a service in 'queued' state", () => {
    const tracker = new ProbeRunTracker({ probeId: "smoke", now: () => 0 });
    tracker.enqueue("smoke:a");
    const snap = tracker.snapshot();
    expect(snap.services).toHaveLength(1);
    expect(snap.services[0]).toMatchObject({ slug: "smoke:a", state: "queued" });
    expect(snap.counts).toEqual({
      queued: 1,
      running: 0,
      completed: 0,
      failed: 0,
      total: 1,
    });
  });

  it("enqueue is idempotent: calling twice doesn't reset state", () => {
    const clock = mkClock(0);
    const tracker = new ProbeRunTracker({
      probeId: "smoke",
      now: clock.now,
    });
    tracker.enqueue("smoke:a");
    clock.advance(10);
    tracker.start("smoke:a");
    clock.advance(5);
    // Re-enqueue should be a no-op while service is running.
    tracker.enqueue("smoke:a");
    const snap = tracker.snapshot();
    expect(snap.services).toHaveLength(1);
    expect(snap.services[0]!.state).toBe("running");
    expect(snap.services[0]!.startedAt).toBe(10);
  });

  it("start transitions queued -> running and sets startedAt", () => {
    const clock = mkClock(0);
    const tracker = new ProbeRunTracker({
      probeId: "smoke",
      now: clock.now,
    });
    tracker.enqueue("smoke:a");
    clock.advance(25);
    tracker.start("smoke:a");
    const snap = tracker.snapshot();
    expect(snap.services[0]!.state).toBe("running");
    expect(snap.services[0]!.startedAt).toBe(25);
    expect(snap.services[0]!.finishedAt).toBeUndefined();
  });

  it("complete transitions running -> completed with result and finishedAt", () => {
    const clock = mkClock(0);
    const tracker = new ProbeRunTracker({
      probeId: "smoke",
      now: clock.now,
    });
    tracker.enqueue("smoke:a");
    clock.advance(10);
    tracker.start("smoke:a");
    clock.advance(40);
    tracker.complete("smoke:a", "green");
    const snap = tracker.snapshot();
    expect(snap.services[0]).toMatchObject({
      slug: "smoke:a",
      state: "completed",
      startedAt: 10,
      finishedAt: 50,
      result: "green",
    });
    expect(snap.counts).toEqual({
      queued: 0,
      running: 0,
      completed: 1,
      failed: 0,
      total: 1,
    });
  });

  it("fail transitions running -> failed with error and finishedAt", () => {
    const clock = mkClock(0);
    const tracker = new ProbeRunTracker({
      probeId: "smoke",
      now: clock.now,
    });
    tracker.enqueue("smoke:a");
    clock.advance(10);
    tracker.start("smoke:a");
    clock.advance(20);
    tracker.fail("smoke:a", "kaboom");
    const snap = tracker.snapshot();
    expect(snap.services[0]).toMatchObject({
      slug: "smoke:a",
      state: "failed",
      startedAt: 10,
      finishedAt: 30,
      error: "kaboom",
    });
    expect(snap.counts).toEqual({
      queued: 0,
      running: 0,
      completed: 0,
      failed: 1,
      total: 1,
    });
  });

  it("snapshot reflects mixed states with correct counts", () => {
    const clock = mkClock(0);
    const tracker = new ProbeRunTracker({
      probeId: "smoke",
      now: clock.now,
    });
    tracker.enqueue("a");
    tracker.enqueue("b");
    tracker.enqueue("c");
    tracker.enqueue("d");
    clock.advance(5);
    tracker.start("a");
    tracker.start("b");
    tracker.start("c");
    clock.advance(10);
    tracker.complete("a", "green");
    tracker.fail("b", "boom");
    // c remains running, d remains queued.
    const snap = tracker.snapshot();
    expect(snap.counts).toEqual({
      queued: 1,
      running: 1,
      completed: 1,
      failed: 1,
      total: 4,
    });
    const bySlug = Object.fromEntries(
      snap.services.map((s) => [s.slug, s.state]),
    );
    expect(bySlug).toEqual({
      a: "completed",
      b: "failed",
      c: "running",
      d: "queued",
    });
  });

  it("snapshot.elapsedMs reflects time since startedAt via injected now()", () => {
    const clock = mkClock(1_000);
    const tracker = new ProbeRunTracker({
      probeId: "smoke",
      now: clock.now,
    });
    expect(tracker.snapshot().elapsedMs).toBe(0);
    clock.advance(250);
    expect(tracker.snapshot().elapsedMs).toBe(250);
    clock.advance(750);
    expect(tracker.snapshot().elapsedMs).toBe(1_000);
  });

  it("snapshot includes probeId, startedAt, and triggered", () => {
    const tracker = new ProbeRunTracker({
      probeId: "image-drift",
      triggered: true,
      now: () => 42,
    });
    const snap = tracker.snapshot();
    expect(snap.probeId).toBe("image-drift");
    expect(snap.startedAt).toBe(42);
    expect(snap.triggered).toBe(true);
  });

  it("tolerates illegal transitions: complete on a non-running service overwrites state", () => {
    // Contract choice: tolerate (not throw). Overwrite state, log nothing.
    const clock = mkClock(0);
    const tracker = new ProbeRunTracker({
      probeId: "smoke",
      now: clock.now,
    });
    tracker.enqueue("a");
    clock.advance(5);
    // No start() — go straight to complete.
    tracker.complete("a", "yellow");
    const snap = tracker.snapshot();
    expect(snap.services[0]).toMatchObject({
      slug: "a",
      state: "completed",
      finishedAt: 5,
      result: "yellow",
    });
    expect(snap.counts.completed).toBe(1);
    expect(snap.counts.queued).toBe(0);
  });

  it("tolerates fail on an unknown service by registering and finishing it", () => {
    const clock = mkClock(0);
    const tracker = new ProbeRunTracker({
      probeId: "smoke",
      now: clock.now,
    });
    clock.advance(7);
    tracker.fail("ghost", "never seen");
    const snap = tracker.snapshot();
    expect(snap.services).toHaveLength(1);
    expect(snap.services[0]).toMatchObject({
      slug: "ghost",
      state: "failed",
      finishedAt: 7,
      error: "never seen",
    });
  });

  it("complete after complete overwrites the result without throwing", () => {
    const clock = mkClock(0);
    const tracker = new ProbeRunTracker({
      probeId: "smoke",
      now: clock.now,
    });
    tracker.enqueue("a");
    clock.advance(5);
    tracker.start("a");
    clock.advance(5);
    tracker.complete("a", "green");
    clock.advance(10);
    tracker.complete("a", "red");
    const snap = tracker.snapshot();
    expect(snap.services[0]).toMatchObject({
      state: "completed",
      result: "red",
      finishedAt: 20,
    });
    expect(snap.counts.completed).toBe(1);
  });
});
