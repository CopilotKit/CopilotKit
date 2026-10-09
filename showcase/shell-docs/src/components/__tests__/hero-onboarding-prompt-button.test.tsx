// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createIntelligenceOnboardingPrompt } from "@/lib/intelligence-onboarding-prompt";
import { HeroOnboardingPromptButton } from "../hero-onboarding-prompt-button";

const analytics = vi.hoisted(() => ({
  capture: vi.fn(),
  actionCapture: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({
    capture: (...args: unknown[]) => {
      if (args[0] === "docs.intelligence_onboarding_prompt_action_clicked")
        return analytics.actionCapture(...args);
      return analytics.capture(...args);
    },
  }),
}));

HTMLDialogElement.prototype.showModal = function () {
  this.open = true;
};
HTMLDialogElement.prototype.close = function () {
  this.open = false;
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function mockClipboard(writeText: ReturnType<typeof vi.fn>) {
  Object.assign(navigator, { clipboard: { writeText } });
  return writeText;
}

it("embeds a run id the CLI accepts", async () => {
  // The CLI rejects any run id that is not exactly 12 URL-safe characters, so a
  // malformed id makes the pasted command fail before onboarding starts.
  const writeText = mockClipboard(vi.fn().mockResolvedValue(undefined));

  render(<HeroOnboardingPromptButton surface="docs-home-hero" />);
  fireEvent.click(screen.getByRole("button", { name: /^copy prompt$/i }));

  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));

  const copied = writeText.mock.calls[0][0] as string;
  const runId = copied.match(/onboarding-prompts\/([A-Za-z0-9_-]+)/)?.[1];
  expect(runId).toMatch(/^[A-Za-z0-9_-]{12}$/);
});

it("reports a blocked clipboard instead of throwing", async () => {
  mockClipboard(vi.fn().mockRejectedValue(new Error("clipboard blocked")));

  render(<HeroOnboardingPromptButton surface="docs-home-hero" />);
  fireEvent.click(screen.getByRole("button", { name: /^copy prompt$/i }));

  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain("Copy blocked"),
  );
  expect(analytics.capture).not.toHaveBeenCalled();
});

it("keeps the run id intact when the framework sentence is appended", async () => {
  const writeText = mockClipboard(vi.fn().mockResolvedValue(undefined));

  render(
    <HeroOnboardingPromptButton
      surface="framework-hero"
      framework={{ slug: "mastra", name: "Mastra" }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /^copy prompt$/i }));

  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));

  const copied = writeText.mock.calls[0][0] as string;
  const runId = copied.match(/onboarding-prompts\/([A-Za-z0-9_-]+)/)?.[1];
  expect(runId).toMatch(/^[A-Za-z0-9_-]{12}$/);
});

it("stays canonical for a framework the onboarding graph does not cover", async () => {
  const writeText = mockClipboard(vi.fn().mockResolvedValue(undefined));

  render(
    <HeroOnboardingPromptButton
      surface="framework-hero"
      framework={{ slug: "langroid", name: "Langroid" }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /^copy prompt$/i }));

  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));

  const copied = writeText.mock.calls[0][0] as string;
  const runId = copied.match(
    /onboarding-prompts\/([A-Za-z0-9_-]+)/,
  )?.[1] as string;
  expect(copied).toBe(createIntelligenceOnboardingPrompt(runId));

  await waitFor(() => expect(analytics.capture).toHaveBeenCalledTimes(1));
  expect(analytics.capture.mock.calls[0][1].agent_framework).toBeUndefined();
});
