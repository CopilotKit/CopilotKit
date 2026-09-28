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
  });
  const secondSubmission = submitResponse({
    pending,
    respond,
    result: "SEND",
    onPendingChange: vi.fn(),
  });
  await Promise.resolve();

  expect(respond).toHaveBeenCalledTimes(1);

  resolveResponse?.();
  await Promise.all([firstSubmission, secondSubmission]);
});

test("keeps the first response selected after the local promise resolves", async () => {
  const respond = vi.fn(async () => undefined);
  const onPendingChange = vi.fn();
  const pending = { current: false };

  await submitResponse({ pending, respond, result: "SEND", onPendingChange });
  await submitResponse({ pending, respond, result: "CANCEL", onPendingChange });

  expect(respond).toHaveBeenCalledExactlyOnceWith("SEND");
  expect(pending.current).toBe(true);
  expect(onPendingChange).toHaveBeenCalledExactlyOnceWith(true);
});
