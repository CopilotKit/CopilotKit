// @vitest-environment jsdom

// The hero placement's own cases, retargeted at <OnboardingPromptButton> with
// `variant="hero"` after the standalone hero button was folded into it. What
// is pinned here is the hero surface's contract — the prompt it copies, the
// run id inside it, the analytics it reports, and how it behaves when the
// clipboard says no — none of which may change just because the appearance
// now comes from a shared component.

import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { frameworkPromptSuffix } from "@/lib/intelligence-onboarding-framework";
import { createIntelligenceOnboardingPrompt } from "@/lib/intelligence-onboarding-prompt";
import { OnboardingPromptButton } from "../onboarding-prompt-button";

const analytics = vi.hoisted(() => ({ capture: vi.fn() }));

// `usePathname` comes from `fumadocs-core/framework`, not `next/navigation`:
// the shared component renders inside the Fumadocs docs shell.
vi.mock("fumadocs-core/framework", () => ({
  usePathname: () => "/",
}));

vi.mock("posthog-js/react", () => ({
  usePostHog: () => analytics,
}));

// Never read on this surface — the hero names no page, so no page sentence is
// composed — but stubbed so the client config module stays out of the test.
vi.mock("@/lib/runtime-config.client", () => ({
  getRuntimeConfig: () => ({ baseUrl: "https://docs.copilotkit.ai" }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

function mockClipboard(writeText: ReturnType<typeof vi.fn>) {
  Object.assign(navigator, { clipboard: { writeText } });
  return writeText;
}

it("renders the onboarding copy label", () => {
  mockClipboard(vi.fn().mockResolvedValue(undefined));

  render(<OnboardingPromptButton variant="hero" surface="docs-home-hero" />);

  expect(
    screen.getByRole("button", { name: /copy agent prompt/i }),
  ).toBeTruthy();
});

it("copies the CLI onboarding prompt and confirms by swapping the icon", async () => {
  // Success swaps only the icon and announces itself politely. A "Copied"
  // label is narrower than the idle one and would shunt the Quickstart button
  // beside it sideways for the duration, so the label deliberately stays put.
  const writeText = mockClipboard(vi.fn().mockResolvedValue(undefined));

  const { container } = render(
    <OnboardingPromptButton variant="hero" surface="docs-home-hero" />,
  );
  fireEvent.click(screen.getByRole("button"));

  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));

  const copied = writeText.mock.calls[0][0] as string;
  expect(copied).toContain("npx --yes copilotkit@latest onboard start --run");

  await waitFor(() => expect(screen.getByText("Prompt copied")).toBeTruthy());
  // The idle label survives the success state; the icon is what changed.
  expect(
    screen.getByRole("button", { name: /copy agent prompt/i }),
  ).toBeTruthy();
  expect(screen.getByRole("button").textContent).not.toContain("Copied");
  expect(container.querySelector("svg.lucide-check")).toBeTruthy();
});

it("embeds a run id the CLI accepts", async () => {
  // The CLI rejects any run id that is not exactly 12 URL-safe characters, so a
  // malformed id makes the pasted command fail before onboarding starts.
  const writeText = mockClipboard(vi.fn().mockResolvedValue(undefined));

  render(<OnboardingPromptButton variant="hero" surface="docs-home-hero" />);
  fireEvent.click(screen.getByRole("button"));

  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));

  const copied = writeText.mock.calls[0][0] as string;
  const runId = copied.match(/onboard start --run (\S+) --coding-agent/)?.[1];
  expect(runId).toMatch(/^[A-Za-z0-9_-]{12}$/);
});

it("reports a blocked clipboard instead of throwing", async () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  mockClipboard(vi.fn().mockRejectedValue(new Error("clipboard blocked")));

  render(<OnboardingPromptButton variant="hero" surface="docs-home-hero" />);
  fireEvent.click(screen.getByRole("button"));

  await waitFor(() =>
    expect(screen.getByRole("button").textContent).toContain("Copy blocked"),
  );
  expect(analytics.capture).not.toHaveBeenCalled();
  // The rejection is swallowed rather than re-thrown, so the console line is
  // the only trace a blocked copy leaves.
  expect(consoleError).toHaveBeenCalled();
});

it("copies the canonical prompt unchanged when no framework is given", async () => {
  // The docs home has no meaningful framework selection, and the canonical
  // wording is shared with two other surfaces, so nothing may be appended.
  const writeText = mockClipboard(vi.fn().mockResolvedValue(undefined));

  render(<OnboardingPromptButton variant="hero" surface="docs-home-hero" />);
  fireEvent.click(screen.getByRole("button"));

  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));

  const copied = writeText.mock.calls[0][0] as string;
  const runId = copied.match(
    /onboard start --run (\S+) --coding-agent/,
  )?.[1] as string;
  expect(copied).toBe(createIntelligenceOnboardingPrompt(runId));
  expect(copied.endsWith("until onboarding is complete.")).toBe(true);
});

it("appends the framework sentence without disturbing the CLI command", async () => {
  const writeText = mockClipboard(vi.fn().mockResolvedValue(undefined));

  render(
    <OnboardingPromptButton
      variant="hero"
      surface="framework-hero"
      framework={{ slug: "mastra", name: "Mastra" }}
    />,
  );
  fireEvent.click(screen.getByRole("button"));

  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));

  // Guard: if mastra ever stopped mapping, the endsWith below would pass on an
  // empty suffix and quietly assert nothing.
  const suffix = frameworkPromptSuffix("mastra", "Mastra");
  expect(suffix).not.toBe("");

  const copied = writeText.mock.calls[0][0] as string;
  expect(copied).toContain("npx --yes copilotkit@latest onboard start --run");
  expect(copied.endsWith(suffix)).toBe(true);
});

it("keeps the run id intact when the framework sentence is appended", async () => {
  const writeText = mockClipboard(vi.fn().mockResolvedValue(undefined));

  render(
    <OnboardingPromptButton
      variant="hero"
      surface="framework-hero"
      framework={{ slug: "mastra", name: "Mastra" }}
    />,
  );
  fireEvent.click(screen.getByRole("button"));

  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));

  const copied = writeText.mock.calls[0][0] as string;
  const runId = copied.match(/onboard start --run (\S+) --coding-agent/)?.[1];
  expect(runId).toMatch(/^[A-Za-z0-9_-]{12}$/);
});

it("reports the graph framework slug to analytics", async () => {
  mockClipboard(vi.fn().mockResolvedValue(undefined));

  render(
    <OnboardingPromptButton
      variant="hero"
      surface="framework-hero"
      framework={{ slug: "mastra", name: "Mastra" }}
    />,
  );
  fireEvent.click(screen.getByRole("button"));

  await waitFor(() => expect(analytics.capture).toHaveBeenCalledTimes(1));

  expect(analytics.capture.mock.calls[0][1]).toStrictEqual({
    from_path: "/",
    onboarding_run_id: expect.stringMatching(/^[A-Za-z0-9_-]{12}$/),
    surface: "framework-hero",
    agent_framework: "mastra",
  });
});

it("sends no framework property when no framework is given", async () => {
  mockClipboard(vi.fn().mockResolvedValue(undefined));

  render(<OnboardingPromptButton variant="hero" surface="docs-home-hero" />);
  fireEvent.click(screen.getByRole("button"));

  await waitFor(() => expect(analytics.capture).toHaveBeenCalledTimes(1));

  const props = analytics.capture.mock.calls[0][1];
  expect(props).not.toHaveProperty("agent_framework");
  expect(props).toStrictEqual({
    from_path: "/",
    onboarding_run_id: expect.stringMatching(/^[A-Za-z0-9_-]{12}$/),
    surface: "docs-home-hero",
  });
});

it("stays canonical for a framework the onboarding graph does not cover", async () => {
  const writeText = mockClipboard(vi.fn().mockResolvedValue(undefined));

  render(
    <OnboardingPromptButton
      variant="hero"
      surface="framework-hero"
      framework={{ slug: "langroid", name: "Langroid" }}
    />,
  );
  fireEvent.click(screen.getByRole("button"));

  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));

  const copied = writeText.mock.calls[0][0] as string;
  const runId = copied.match(
    /onboard start --run (\S+) --coding-agent/,
  )?.[1] as string;
  expect(copied).toBe(createIntelligenceOnboardingPrompt(runId));

  await waitFor(() => expect(analytics.capture).toHaveBeenCalledTimes(1));
  expect(analytics.capture.mock.calls[0][1]).not.toHaveProperty(
    "agent_framework",
  );
});
