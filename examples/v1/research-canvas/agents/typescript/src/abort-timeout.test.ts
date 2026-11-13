import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { withAbortTimeout } from "./abort-timeout";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test("keeps the abort timer active while the response body is pending", async () => {
  let finishBody: (() => void) | undefined;
  let observedSignal: AbortSignal | undefined;
  const pendingBody = new Promise<void>((resolve) => {
    finishBody = resolve;
  });

  const result = withAbortTimeout(5_000, async (signal) => {
    observedSignal = signal;
    await pendingBody;
    return "body consumed";
  });

  await vi.advanceTimersByTimeAsync(5_000);

  expect(observedSignal?.aborted).toBe(true);
  if (!finishBody) {
    throw new Error("Body consumer did not start");
  }
  finishBody();
  await expect(result).resolves.toBe("body consumed");
});

test("clears the abort timer after the response body finishes", async () => {
  let observedSignal: AbortSignal | undefined;

  await expect(
    withAbortTimeout(5_000, async (signal) => {
      observedSignal = signal;
      return "body consumed";
    }),
  ).resolves.toBe("body consumed");

  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(observedSignal?.aborted).toBe(false);
});
