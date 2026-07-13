import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PendingInteractions } from "./pending-interactions.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function fakeInteraction() {
  return {
    id: "i1",
    deferred: false,
    replied: false,
    deferUpdate: vi.fn(async function (this: any) {
      this.deferred = true;
    }),
    showModal: vi.fn(async () => {}),
  };
}

describe("PendingInteractions", () => {
  it("auto-defers at the deadline when nothing responds", async () => {
    const reg = new PendingInteractions({
      ackBufferMs: 2500,
      defer: (i) => (i as any).deferUpdate(),
    });
    const i = fakeInteraction();
    reg.register(i as any);
    await vi.advanceTimersByTimeAsync(2500);
    expect(i.deferUpdate).toHaveBeenCalledTimes(1);
  });

  it("respondWith runs the responder and cancels the deferral", async () => {
    const reg = new PendingInteractions({
      ackBufferMs: 2500,
      defer: (i) => (i as any).deferUpdate(),
    });
    const i = fakeInteraction();
    const tid = reg.register(i as any);
    const ok = await reg.respondWith(tid, (live) =>
      (live as any).showModal({}),
    );
    expect(ok).toBe(true);
    expect(i.showModal).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(i.deferUpdate).not.toHaveBeenCalled();
  });

  it("respondWith returns false once the interaction was already acked", async () => {
    const reg = new PendingInteractions({
      ackBufferMs: 2500,
      defer: (i) => (i as any).deferUpdate(),
    });
    const i = fakeInteraction();
    const tid = reg.register(i as any);
    await vi.advanceTimersByTimeAsync(2500); // auto-defer fires
    const ok = await reg.respondWith(tid, (live) =>
      (live as any).showModal({}),
    );
    expect(ok).toBe(false);
    expect(i.showModal).not.toHaveBeenCalled();
  });

  it("settle acks an unresponded interaction immediately (fast handler path)", async () => {
    const reg = new PendingInteractions({
      ackBufferMs: 2500,
      defer: (i) => (i as any).deferUpdate(),
    });
    const i = fakeInteraction();
    const tid = reg.register(i as any);
    await reg.settle(tid);
    expect(i.deferUpdate).toHaveBeenCalledTimes(1);
  });

  it("re-registering the same id clears the old timer so defer fires at most once", async () => {
    const defer = vi.fn(async () => {});
    const reg = new PendingInteractions({ ackBufferMs: 2500, defer });
    const i = { id: "dup", deferred: false, replied: false };
    // Register twice with the same id — simulates a re-registration race
    reg.register(i as any);
    reg.register(i as any);
    // Advance past the ackBufferMs — both timers would fire if the first wasn't cleared
    await vi.advanceTimersByTimeAsync(5000);
    expect(defer).toHaveBeenCalledTimes(1);
  });
});
