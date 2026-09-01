// @vitest-environment jsdom

import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { HeroOnboardingPromptButton } from "../hero-onboarding-prompt-button";

const analytics = vi.hoisted(() => ({ capture: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

vi.mock("posthog-js/react", () => ({
  usePostHog: () => analytics,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function mockClipboard(writeText: ReturnType<typeof vi.fn>) {
  Object.assign(navigator, { clipboard: { writeText } });
  return writeText;
}

it("renders the coding-agent copy label", () => {
  mockClipboard(vi.fn().mockResolvedValue(undefined));

  render(<HeroOnboardingPromptButton surface="docs-home-hero" />);

  expect(
    screen.getByRole("button", { name: /copy prompt for your coding agent/i }),
  ).toBeTruthy();
});

it("copies the CLI onboarding prompt and confirms with a Copied label", async () => {
  const writeText = mockClipboard(vi.fn().mockResolvedValue(undefined));

  render(<HeroOnboardingPromptButton surface="docs-home-hero" />);
  fireEvent.click(screen.getByRole("button"));

  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));

  const copied = writeText.mock.calls[0][0] as string;
  expect(copied).toContain("npx --yes copilotkit@latest onboard start --run");

  await waitFor(() =>
    expect(screen.getByRole("button").textContent).toContain("Copied"),
  );
});

it("embeds a run id the CLI accepts", async () => {
  // The CLI rejects any run id that is not exactly 12 URL-safe characters, so a
  // malformed id makes the pasted command fail before onboarding starts.
  const writeText = mockClipboard(vi.fn().mockResolvedValue(undefined));

  render(<HeroOnboardingPromptButton surface="docs-home-hero" />);
  fireEvent.click(screen.getByRole("button"));

  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));

  const copied = writeText.mock.calls[0][0] as string;
  const runId = copied.match(/onboard start --run (\S+) --coding-agent/)?.[1];
  expect(runId).toMatch(/^[A-Za-z0-9_-]{12}$/);
});

it("reports a blocked clipboard instead of throwing", async () => {
  mockClipboard(vi.fn().mockRejectedValue(new Error("clipboard blocked")));

  render(<HeroOnboardingPromptButton surface="docs-home-hero" />);
  fireEvent.click(screen.getByRole("button"));

  await waitFor(() =>
    expect(screen.getByRole("button").textContent).toContain("Copy blocked"),
  );
  expect(analytics.capture).not.toHaveBeenCalled();
});
