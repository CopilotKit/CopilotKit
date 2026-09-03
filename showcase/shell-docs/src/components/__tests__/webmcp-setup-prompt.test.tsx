// @vitest-environment jsdom

import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { WebMCPSetupPrompt } from "../webmcp-setup-prompt";
import {
  WEBMCP_SETUP_EVENTS,
  WEBMCP_SETUP_PROMPT,
} from "@/lib/webmcp-setup-prompt";

const analytics = vi.hoisted(() => ({ capture: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/webmcp",
}));

vi.mock("posthog-js/react", () => ({
  usePostHog: () => analytics,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("copies the standalone WebMCP setup prompt", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });

  render(<WebMCPSetupPrompt />);
  fireEvent.click(screen.getByRole("button", { name: "Copy setup prompt" }));

  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));

  const prompt = writeText.mock.calls[0]?.[0] as string;
  expect(prompt).toBe(WEBMCP_SETUP_PROMPT);
  expect(prompt).not.toContain("onboard start");
  expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
  expect(screen.getByText("Prompt copied")).toBeTruthy();
  expect(analytics.capture).toHaveBeenCalledWith(
    WEBMCP_SETUP_EVENTS.promptCopied,
    {
      from_path: "/webmcp",
      surface: "docs_webmcp_setup_prompt",
    },
  );
});

test("disables the CTA while the clipboard write is pending", async () => {
  let finishCopy: (() => void) | undefined;
  const writeText = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finishCopy = resolve;
      }),
  );
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });

  render(<WebMCPSetupPrompt />);
  const button = screen.getByRole("button", { name: "Copy setup prompt" });

  fireEvent.click(button);

  await waitFor(() => expect(button).toHaveProperty("disabled", true));
  fireEvent.click(button);
  expect(writeText).toHaveBeenCalledTimes(1);

  finishCopy?.();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Copied" })).toHaveProperty(
      "disabled",
      false,
    ),
  );
});
