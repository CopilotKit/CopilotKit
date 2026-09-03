// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { WebMCPOnboardingPrompt } from "../webmcp-onboarding-prompt";
import { INTELLIGENCE_ONBOARDING_EVENTS } from "@/lib/intelligence-onboarding-prompt";

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

test("copies a run-bound WebMCP goal into the CLI onboarding path", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });

  render(<WebMCPOnboardingPrompt />);
  fireEvent.click(screen.getByRole("button", { name: "Copy setup prompt" }));

  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));

  const prompt = writeText.mock.calls[0]?.[0] as string;
  const runId = /onboard start --run ([0-9a-f]{12}) --coding-agent/.exec(
    prompt,
  )?.[1];

  expect(runId).toBeTruthy();
  expect(prompt).toContain("The goal of this onboarding run is to get WebMCP working");
  expect(prompt).toContain("A WebMCP call does not require a CopilotKit backend agent");
  expect(prompt).toContain("https://docs.copilotkit.ai/webmcp");
  expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
  expect(screen.getByText("Prompt copied")).toBeTruthy();
  expect(analytics.capture).toHaveBeenCalledWith(
    INTELLIGENCE_ONBOARDING_EVENTS.promptCopied,
    {
      from_path: "/webmcp",
      onboarding_run_id: runId,
      surface: "docs_webmcp_onboarding_prompt",
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

  render(<WebMCPOnboardingPrompt />);
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
