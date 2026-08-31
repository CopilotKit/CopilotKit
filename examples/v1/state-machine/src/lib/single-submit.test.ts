import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import { submitOnce } from "./single-submit";

test("runs only one submission while a response is pending", async () => {
  let resolveAction: (() => void) | undefined;
  const response = new Promise<void>((resolve) => {
    resolveAction = resolve;
  });
  const action = vi.fn(() => response);
  const pending = { current: false };

  const firstSubmission = submitOnce({
    pending,
    action,
    onPendingChange: vi.fn(),
    onError: vi.fn(),
  });
  const secondSubmission = submitOnce({
    pending,
    action,
    onPendingChange: vi.fn(),
    onError: vi.fn(),
  });
  await Promise.resolve();

  expect(action).toHaveBeenCalledTimes(1);

  resolveAction?.();
  await Promise.all([firstSubmission, secondSubmission]);
});

test("keeps a successful submission latched until the controls unmount", async () => {
  const action = vi.fn().mockResolvedValue(undefined);
  const onPendingChange = vi.fn();
  const pending = { current: false };

  await submitOnce({
    pending,
    action,
    onPendingChange,
    onError: vi.fn(),
  });
  await submitOnce({
    pending,
    action,
    onPendingChange,
    onError: vi.fn(),
  });

  expect(action).toHaveBeenCalledTimes(1);
  expect(pending.current).toBe(true);
  expect(onPendingChange).toHaveBeenCalledOnce();
  expect(onPendingChange).toHaveBeenCalledWith(true);
});

test("converts a rejected submission into retry state without rejecting", async () => {
  const action = vi.fn().mockRejectedValue(new Error("network unavailable"));
  const onPendingChange = vi.fn();
  const onError = vi.fn();
  const pending = { current: false };

  const submission = submitOnce({
    pending,
    action,
    onPendingChange,
    onError,
  });

  await expect(submission).resolves.toBeUndefined();
  expect(pending.current).toBe(false);
  expect(onPendingChange).toHaveBeenNthCalledWith(1, true);
  expect(onPendingChange).toHaveBeenNthCalledWith(2, false);
  expect(onError).toHaveBeenCalledWith({
    message: "Could not send your response. Try again.",
    retry: action,
  });
});

test("renders failed submissions as an accessible retry prompt", () => {
  const source = readFileSync(
    new URL("../components/generative-ui/confirm-order.tsx", import.meta.url),
    "utf8",
  );

  expect(source).toMatch(/role=["']alert["']/);
  expect(source).toMatch(/>\s*Retry\s*</);
});
