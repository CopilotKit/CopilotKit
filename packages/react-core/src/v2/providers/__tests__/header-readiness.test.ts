import { describe, expect, it } from "vitest";
import { HeaderReadinessBarrier } from "../header-readiness";

describe("HeaderReadinessBarrier", () => {
  it("releases pending callers when headers become ready", async () => {
    const barrier = new HeaderReadinessBarrier();
    let settled = false;
    const pending = barrier.wait().then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    barrier.ready();
    await pending;
    expect(settled).toBe(true);
  });

  it("rejects pending callers with the original initial failure", async () => {
    const barrier = new HeaderReadinessBarrier();
    const original = new Error("token unavailable");
    const pending = barrier.wait();
    barrier.failed(original);
    await expect(pending).rejects.toBe(original);
    await expect(barrier.wait()).rejects.toBe(original);
  });

  it("reopens after a failed source is replaced", async () => {
    const barrier = new HeaderReadinessBarrier();
    barrier.failed(new Error("expired"));
    barrier.pending();
    const pending = barrier.waitForRecovery();
    barrier.ready();
    await expect(pending).resolves.toBeUndefined();
  });

  it("publishes the latest concrete headers with readiness", () => {
    const barrier = new HeaderReadinessBarrier();
    const headers = { Authorization: "Bearer current" };
    barrier.ready(headers);
    expect(barrier.currentHeaders()).toBe(headers);
  });

  it("reopens a settled barrier for a later failure and recovery", async () => {
    const barrier = new HeaderReadinessBarrier();
    barrier.ready({ Authorization: "Bearer current" });
    barrier.failed(new Error("refresh failed"));
    barrier.pending();
    const pending = barrier.wait();
    barrier.ready({ Authorization: "Bearer refreshed" });
    await expect(pending).resolves.toBeUndefined();
    expect(barrier.currentHeaders()).toEqual({
      Authorization: "Bearer refreshed",
    });
  });

  it("rejects pending waiters when the provider is disposed", async () => {
    const barrier = new HeaderReadinessBarrier();
    const pending = barrier.wait();
    const reason = new Error("provider unmounted");
    barrier.dispose(reason);
    await expect(pending).rejects.toBe(reason);
  });
});
