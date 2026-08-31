import { expect, test, vi } from "vitest";
import { submitResponse } from "./response-submission";

test("blocks another response while the first response is pending", async () => {
  let resolveResponse: (() => void) | undefined;
  const response = new Promise<void>((resolve) => {
    resolveResponse = resolve;
  });
  const respond = vi.fn(() => response);
  const pending = { current: false };

  const firstSubmission = submitResponse({
    pending,
    respond,
    result: "CANCEL",
    onPendingChange: vi.fn(),
    onError: vi.fn(),
  });
  const secondSubmission = submitResponse({
    pending,
    respond,
    result: "SEND",
    onPendingChange: vi.fn(),
    onError: vi.fn(),
  });
  await Promise.resolve();

  expect(respond).toHaveBeenCalledTimes(1);

  resolveResponse?.();
  await Promise.all([firstSubmission, secondSubmission]);
});

test("reports a rejected response so the user can retry", async () => {
  const respond = vi.fn().mockRejectedValue(new Error("network unavailable"));
  const onError = vi.fn();
  const pending = { current: false };

  const submission = submitResponse({
    pending,
    respond,
    result: "SEND",
    onPendingChange: vi.fn(),
    onError,
  });

  await expect(submission).resolves.toBeUndefined();
  expect(onError).toHaveBeenCalledWith(
    "Could not send your response. Try again.",
    "SEND",
  );
  expect(pending.current).toBe(false);
});
