// @vitest-environment jsdom

import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { expect, test, vi } from "vitest";
import {
  RICH_THREADS_SETUP_PROMPT,
  RichThreadsSetupPrompt,
} from "../rich-threads-setup-prompt";

interface SetupResult {
  writeText: ReturnType<typeof vi.fn>;
  teardown: () => void;
}

interface DeferredCopy {
  promise: Promise<void>;
  resolve: () => void;
  reject: (reason?: unknown) => void;
}

/** Creates a clipboard promise whose settlement order the test controls. */
function createDeferredCopy(): DeferredCopy {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function setup(writeText = vi.fn().mockResolvedValue(undefined)): SetupResult {
  const originalClipboard = Object.getOwnPropertyDescriptor(
    navigator,
    "clipboard",
  );
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  render(<RichThreadsSetupPrompt />);

  return {
    writeText,
    teardown() {
      cleanup();
      if (originalClipboard) {
        Object.defineProperty(navigator, "clipboard", originalClipboard);
      } else {
        Reflect.deleteProperty(navigator, "clipboard");
      }
    },
  };
}

test("copies the canonical Rich Threads repair prompt and announces success", async () => {
  const { writeText, teardown } = setup();

  try {
    fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(RICH_THREADS_SETUP_PROMPT),
    );
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
    expect(screen.getByText("Prompt copied")).toBeTruthy();
  } finally {
    teardown();
  }
});

test("keeps the Rich Threads repair prompt anchored and safe for autonomous edits", () => {
  expect(RICH_THREADS_SETUP_PROMPT).toContain(
    "https://docs.copilotkit.ai/backend/runtime-endpoints#enable-rich-threads-routes",
  );
  expect(RICH_THREADS_SETUP_PROMPT).toContain(
    "existing server-verified signed-in application user",
  );
  expect(RICH_THREADS_SETUP_PROMPT).toContain(
    "Preserve existing authentication middleware and access checks",
  );
  expect(RICH_THREADS_SETUP_PROMPT).toContain(
    "Never use a fixed demo identity in production",
  );
  expect(RICH_THREADS_SETUP_PROMPT).toContain(
    "Home shows Intelligence connected",
  );
  expect(RICH_THREADS_SETUP_PROMPT).toContain("open Threads in Inspector");
  expect(RICH_THREADS_SETUP_PROMPT).toContain(
    "React Native does not include Inspector",
  );
});

test("reports a blocked Rich Threads prompt copy without claiming success", async () => {
  const { teardown } = setup(
    vi.fn().mockRejectedValue(new Error("clipboard denied")),
  );

  try {
    fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));

    expect(
      await screen.findByRole("button", { name: "Copy blocked" }),
    ).toBeTruthy();
    expect(screen.getByText("Prompt copy failed. Try again.")).toBeTruthy();
    expect(screen.queryByText("Prompt copied")).toBeNull();
  } finally {
    teardown();
  }
});

test("ignores an older Rich Threads clipboard failure", async () => {
  const firstCopy = createDeferredCopy();
  const writeText = vi
    .fn()
    .mockReturnValueOnce(firstCopy.promise)
    .mockResolvedValueOnce(undefined);
  const { teardown } = setup(writeText);

  try {
    fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();

    firstCopy.reject(new Error("stale clipboard rejection"));
    await Promise.resolve();
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
  } finally {
    teardown();
  }
});

test("does not schedule Rich Threads copy feedback after unmount", async () => {
  const pendingCopy = createDeferredCopy();
  const { teardown } = setup(vi.fn().mockReturnValue(pendingCopy.promise));

  fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
  teardown();
  const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

  try {
    pendingCopy.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(setTimeoutSpy).not.toHaveBeenCalled();
  } finally {
    setTimeoutSpy.mockRestore();
  }
});

test("labels each Rich Threads prompt instance with its own title", () => {
  render(
    <>
      <RichThreadsSetupPrompt />
      <RichThreadsSetupPrompt />
    </>,
  );

  try {
    const regions = screen.getAllByRole("region", {
      name: "Finish setup with your coding agent",
    });
    const titleIds = regions.map((region) =>
      region.getAttribute("aria-labelledby"),
    );

    expect(regions).toHaveLength(2);
    expect(new Set(titleIds).size).toBe(2);
    for (const titleId of titleIds) {
      expect(titleId).not.toBeNull();
      expect(document.getElementById(titleId ?? "")).not.toBeNull();
    }
  } finally {
    cleanup();
  }
});
