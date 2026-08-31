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
  });
  const secondSubmission = submitOnce({
    pending,
    action,
    onPendingChange: vi.fn(),
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

  await submitOnce({ pending, action, onPendingChange });
  await submitOnce({ pending, action, onPendingChange });

  expect(action).toHaveBeenCalledTimes(1);
  expect(pending.current).toBe(true);
  expect(onPendingChange).toHaveBeenCalledOnce();
  expect(onPendingChange).toHaveBeenCalledWith(true);
});

test("unlocks a failed submission so the user can retry", async () => {
  const action = vi.fn().mockRejectedValue(new Error("network unavailable"));
  const onPendingChange = vi.fn();
  const pending = { current: false };

  await expect(
    submitOnce({ pending, action, onPendingChange }),
  ).rejects.toThrow("network unavailable");

  expect(pending.current).toBe(false);
  expect(onPendingChange).toHaveBeenNthCalledWith(1, true);
  expect(onPendingChange).toHaveBeenNthCalledWith(2, false);
});
