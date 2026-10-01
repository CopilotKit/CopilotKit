import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlatformRequestError } from "../client";
import type { RenewThreadLockResponse } from "../client";
import {
  isRetryableLockRenewalError,
  startThreadLockHeartbeat,
} from "../thread-lock-heartbeat";

const renewed: RenewThreadLockResponse = {
  threadId: "thread-1",
  runId: "run-1",
  ttlSeconds: 120,
  status: "renewed",
};

const serverError = () =>
  new PlatformRequestError("Intelligence platform error 500", 500, true);

const lockLost = () =>
  new PlatformRequestError("Intelligence platform error 409", 409, false);

describe("startThreadLockHeartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renews on the interval without overlapping requests", async () => {
    let resolvePending: ((value: RenewThreadLockResponse) => void) | undefined;
    const renew = vi.fn(
      () =>
        new Promise<RenewThreadLockResponse>((resolve) => {
          resolvePending = resolve;
        }),
    );
    const onLost = vi.fn();
    const heartbeat = startThreadLockHeartbeat({
      renew,
      intervalMs: 1_000,
      fallbackTtlSeconds: 120,
      onLost,
    });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(renew).toHaveBeenCalledTimes(1);

    // The first request is still in flight, so no second one starts.
    await vi.advanceTimersByTimeAsync(3_000);
    expect(renew).toHaveBeenCalledTimes(1);

    resolvePending?.(renewed);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(renew).toHaveBeenCalledTimes(2);

    heartbeat.stop();
    expect(onLost).not.toHaveBeenCalled();
  });

  it("retries a transient 500 and keeps the run alive when renewal recovers", async () => {
    const renew = vi
      .fn<() => Promise<RenewThreadLockResponse>>()
      .mockRejectedValueOnce(serverError())
      .mockResolvedValue(renewed);
    const onLost = vi.fn();
    const heartbeat = startThreadLockHeartbeat({
      renew,
      intervalMs: 15_000,
      fallbackTtlSeconds: 20,
      onLost,
    });

    await vi.advanceTimersByTimeAsync(15_000);
    expect(renew).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(renew).toHaveBeenCalledTimes(2);

    // Back on the regular cadence after the recovered renewal.
    await vi.advanceTimersByTimeAsync(15_000);
    expect(renew).toHaveBeenCalledTimes(3);
    expect(onLost).not.toHaveBeenCalled();

    heartbeat.stop();
  });

  it("aborts once retryable failures would outlast the returned TTL", async () => {
    const renew = vi
      .fn<() => Promise<RenewThreadLockResponse>>()
      .mockResolvedValueOnce({ ...renewed, ttlSeconds: 30 })
      .mockRejectedValue(serverError());
    const onLost = vi.fn();
    startThreadLockHeartbeat({
      renew,
      intervalMs: 10_000,
      fallbackTtlSeconds: 20,
      onLost,
    });

    // Success at t=10s sets the deadline to t=40s (returned ttlSeconds: 30).
    await vi.advanceTimersByTimeAsync(10_000);
    // First failure at t=20s, then retries at 21, 23, 27 and 35s. The next
    // backoff (8s) would land past the deadline minus the safety margin.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onLost).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(14_999);
    expect(onLost).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(renew).toHaveBeenCalledTimes(6);
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(onLost.mock.calls[0]?.[0]).toBeInstanceOf(PlatformRequestError);

    // Nothing more happens after the lock is declared lost.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(renew).toHaveBeenCalledTimes(6);
    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it("aborts immediately when the platform reports the lock lost", async () => {
    const renew = vi
      .fn<() => Promise<RenewThreadLockResponse>>()
      .mockRejectedValue(lockLost());
    const onLost = vi.fn();
    startThreadLockHeartbeat({
      renew,
      intervalMs: 1_000,
      fallbackTtlSeconds: 120,
      onLost,
    });

    await vi.advanceTimersByTimeAsync(1_000);

    expect(onLost).toHaveBeenCalledTimes(1);
    expect(onLost).toHaveBeenCalledWith(
      expect.objectContaining({ status: 409 }),
    );
    await vi.advanceTimersByTimeAsync(10_000);
    expect(renew).toHaveBeenCalledTimes(1);
  });

  it("never aborts when stopped during a retry backoff", async () => {
    const renew = vi
      .fn<() => Promise<RenewThreadLockResponse>>()
      .mockRejectedValue(serverError());
    const onLost = vi.fn();
    const heartbeat = startThreadLockHeartbeat({
      renew,
      intervalMs: 1_000,
      fallbackTtlSeconds: 20,
      onLost,
    });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(renew).toHaveBeenCalledTimes(1);

    heartbeat.stop();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(renew).toHaveBeenCalledTimes(1);
    expect(onLost).not.toHaveBeenCalled();
  });

  it("never aborts when stopped while a failing renewal is in flight", async () => {
    let rejectPending: ((error: unknown) => void) | undefined;
    const renew = vi.fn(
      () =>
        new Promise<RenewThreadLockResponse>((_resolve, reject) => {
          rejectPending = reject;
        }),
    );
    const onLost = vi.fn();
    const heartbeat = startThreadLockHeartbeat({
      renew,
      intervalMs: 1_000,
      fallbackTtlSeconds: 20,
      onLost,
    });

    await vi.advanceTimersByTimeAsync(1_000);
    heartbeat.stop();
    rejectPending?.(lockLost());
    await vi.advanceTimersByTimeAsync(60_000);

    expect(onLost).not.toHaveBeenCalled();
  });

  it("stops without aborting when the platform reports the run completed", async () => {
    const renew = vi
      .fn<() => Promise<RenewThreadLockResponse>>()
      .mockResolvedValue({ ...renewed, ttlSeconds: 0, status: "completed" });
    const onLost = vi.fn();
    startThreadLockHeartbeat({
      renew,
      intervalMs: 1_000,
      fallbackTtlSeconds: 20,
      onLost,
    });

    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(renew).toHaveBeenCalledTimes(1);
    expect(onLost).not.toHaveBeenCalled();
  });

  it("treats a renewal that never settles as a failure bounded by the deadline", async () => {
    const renew = vi.fn(() => new Promise<RenewThreadLockResponse>(() => {}));
    const onLost = vi.fn();
    startThreadLockHeartbeat({
      renew,
      intervalMs: 15_000,
      fallbackTtlSeconds: 20,
      onLost,
    });

    // Lock expires at t=20s; the hung request is given up at t=19s.
    await vi.advanceTimersByTimeAsync(18_999);
    expect(onLost).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(onLost).toHaveBeenCalledTimes(1);
    expect(renew).toHaveBeenCalledTimes(1);
  });

  it("falls back to the configured TTL when the response omits it", async () => {
    const renew = vi
      .fn<() => Promise<RenewThreadLockResponse>>()
      .mockResolvedValueOnce(undefined as unknown as RenewThreadLockResponse)
      .mockRejectedValue(serverError());
    const onLost = vi.fn();
    startThreadLockHeartbeat({
      renew,
      intervalMs: 5_000,
      fallbackTtlSeconds: 10,
      onLost,
    });

    // Success at t=5s → deadline t=15s. Failure at t=10s, retries at 11 and
    // 13s; the 4s backoff would pass t=14s, so the lock is declared lost.
    await vi.advanceTimersByTimeAsync(13_000);

    expect(renew).toHaveBeenCalledTimes(4);
    expect(onLost).toHaveBeenCalledTimes(1);
  });
});

describe("isRetryableLockRenewalError", () => {
  it("trusts the platform's retryable flag over the status", () => {
    expect(
      isRetryableLockRenewalError(new PlatformRequestError("x", 500, false)),
    ).toBe(false);
    expect(
      isRetryableLockRenewalError(new PlatformRequestError("x", 409, false)),
    ).toBe(false);
    expect(
      isRetryableLockRenewalError(new PlatformRequestError("x", 503, true)),
    ).toBe(true);
  });

  it("classifies by status when the platform sent no flag", () => {
    expect(
      isRetryableLockRenewalError(new PlatformRequestError("x", 502)),
    ).toBe(true);
    expect(
      isRetryableLockRenewalError(new PlatformRequestError("x", 429)),
    ).toBe(true);
    expect(
      isRetryableLockRenewalError(new PlatformRequestError("x", 409)),
    ).toBe(false);
    expect(
      isRetryableLockRenewalError(new PlatformRequestError("x", 404)),
    ).toBe(false);
  });

  it("retries network failures", () => {
    expect(isRetryableLockRenewalError(new TypeError("fetch failed"))).toBe(
      true,
    );
  });
});
