// @vitest-environment jsdom

// The hero placement's own cases, retargeted at <OnboardingPromptButton> with
// `variant="hero"` after the standalone hero button was folded into it. The
// canonical-prompt copy, the graph-slug reporting, the omitted-key rule and
// the blocked-clipboard path are all exercised in `onboarding-prompt-button.
// test.tsx` already — that logic runs identically regardless of `variant`, so
// re-covering it here would only re-run the same code path under a different
// label. What is left here is specific to the framework-root hero surface:
// `docs_framework_hero`, the surface name that placement actually passes,
// which nothing in the main file names.

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
import {
  RUN_ID_PATTERN,
  stubClipboard,
} from "@/test-utils/onboarding-clipboard";

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

/** The surface name the framework-root hero placement is registered under. */
const FRAMEWORK_HERO_SURFACE = "docs_framework_hero";

it("appends the framework sentence and carries the real surface name, on the framework-root hero", async () => {
  const writeText = stubClipboard();

  const { container } = render(
    <OnboardingPromptButton
      variant="hero"
      surface={FRAMEWORK_HERO_SURFACE}
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
  expect(copied.endsWith(suffix)).toBe(true);

  const runId = copied.match(/onboard start --run (\S+) --coding-agent/)?.[1];
  expect(runId).toMatch(RUN_ID_PATTERN);

  // The bug this guards against: the placement passes `docs_framework_hero`,
  // and a pinned-but-wrong surface name in a test would never catch it
  // spelling something else.
  expect(
    container.querySelector("button")?.getAttribute("data-docs-copy-surface"),
  ).toBe(FRAMEWORK_HERO_SURFACE);
});

it("stays canonical on the framework-root hero for a framework the onboarding graph does not cover", async () => {
  const writeText = stubClipboard();

  render(
    <OnboardingPromptButton
      variant="hero"
      surface={FRAMEWORK_HERO_SURFACE}
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
