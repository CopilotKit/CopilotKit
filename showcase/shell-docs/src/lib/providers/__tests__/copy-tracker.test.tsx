// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CopyTracker } from "../copy-tracker";
const analytics = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock("posthog-js/react", () => ({ usePostHog: () => analytics }));
beforeEach(() => {
  analytics.capture.mockReset();
});
afterEach(cleanup);
function mount(writeText: ReturnType<typeof vi.fn>) {
  Object.assign(navigator, { clipboard: { writeText } });
  render(
    <>
      <CopyTracker />
      <button data-docs-copy-surface="first">First</button>
      <button data-docs-copy-surface="second">Second</button>
    </>,
  );
  screen.getByText("First").focus();
}
test("only successful writes count and attribution survives focus changes", async () => {
  let finish!: () => void;
  mount(
    vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    ),
  );
  const copy = navigator.clipboard.writeText("npx copilotkit@latest init");
  expect(analytics.capture).not.toHaveBeenCalled();
  screen.getByText("Second").focus();
  await act(async () => {
    finish();
    await copy;
  });
  expect(analytics.capture.mock.calls).toEqual([
    [
      "cli_command_copied",
      { install_type: "npx", location: window.location.pathname },
    ],
    ["docs_conversion_copied", { surface: "first" }],
  ]);
});
test("rejected clipboard writes emit no success events and preserve rejection", async () => {
  mount(vi.fn().mockRejectedValue(new Error("denied")));
  await expect(navigator.clipboard.writeText("prompt")).rejects.toThrow(
    "denied",
  );
  expect(analytics.capture).not.toHaveBeenCalled();
});
test("analytics failure does not reject a successful write", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  mount(writeText);
  analytics.capture.mockImplementation(() => {
    throw new Error("analytics unavailable");
  });
  await expect(
    navigator.clipboard.writeText("prompt"),
  ).resolves.toBeUndefined();
  expect(writeText).toHaveBeenCalledOnce();
});
