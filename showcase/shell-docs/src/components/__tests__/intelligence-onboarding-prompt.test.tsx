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
import { IntelligenceOnboardingPrompt } from "../intelligence-onboarding-prompt";
import { INTELLIGENCE_ONBOARDING_EVENTS } from "@/lib/intelligence-onboarding-prompt";

const analytics = vi.hoisted(() => ({ capture: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/quickstart",
}));

vi.mock("posthog-js/react", () => ({
  usePostHog: () => analytics,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("names the copied run id the same way every other onboarding surface does", async () => {
  // The docs surface was the lone outlier: it minted a run id and reported it as
  // `run_id`, while the managed-service and inspector copy events and all six
  // `cli.onboarding.*` events call the same value `onboarding_run_id`. A join
  // written against the canonical name found nothing here, which is what made
  // this surface read as unmeasurable (OSS-1060 defect 6).
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });

  render(
    <IntelligenceOnboardingPrompt
      feature="threads"
      surface="docs-quickstart"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /copy/i }));

  await waitFor(() => expect(analytics.capture).toHaveBeenCalled());

  const [event, properties] = analytics.capture.mock.calls[0] as [
    string,
    Record<string, unknown>,
  ];
  expect(event).toBe(INTELLIGENCE_ONBOARDING_EVENTS.promptCopied);
  expect(properties).not.toHaveProperty("run_id");
  expect(properties.onboarding_run_id).toEqual(expect.any(String));
  // The id must be the one actually pasted into the prompt, or the join is to a
  // run that never existed.
  expect(writeText.mock.calls[0][0]).toContain(properties.onboarding_run_id);
});

it("reuses one run id across repeated clicks on the same mount", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });

  render(
    <IntelligenceOnboardingPrompt feature="learning" surface="docs_test" />,
  );
  const button = screen.getByRole("button", { name: /copy prompt/i });

  button.click();
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  button.click();
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));

  const ids = writeText.mock.calls.map(
    (call) => ((call[0] as string).match(/--run (\S+)/) ?? [])[1],
  );
  // Assert the shape first: if the prompt ever stops spelling `--run <id>`,
  // both extractions become `undefined` and a bare equality check passes
  // green while measuring nothing.
  expect(ids[0]).toMatch(/^[A-Za-z0-9_-]{12}$/);
  expect(ids[1]).toMatch(/^[A-Za-z0-9_-]{12}$/);
  expect(ids[0]).toBe(ids[1]);
});

it("reports the framework the page is about under the graph's slug", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });

  render(
    <IntelligenceOnboardingPrompt
      feature="threads"
      surface="docs_test"
      framework={{ slug: "mastra", name: "Mastra" }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /copy prompt/i }));

  await waitFor(() => expect(analytics.capture).toHaveBeenCalled());

  const [, properties] = analytics.capture.mock.calls[0] as [
    string,
    Record<string, unknown>,
  ];
  expect(properties.agent_framework).toBe("mastra");
});

it("omits the framework property entirely when the banner is given none", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });

  render(
    <IntelligenceOnboardingPrompt feature="threads" surface="docs_test" />,
  );
  fireEvent.click(screen.getByRole("button", { name: /copy prompt/i }));

  await waitFor(() => expect(analytics.capture).toHaveBeenCalled());

  const [, properties] = analytics.capture.mock.calls[0] as [
    string,
    Record<string, unknown>,
  ];
  // Absence of the key, not an `undefined` value: a key that is present with
  // no value still shows up as a row in a PostHog breakdown.
  expect(properties).not.toHaveProperty("agent_framework");
});

it("marks its copy button as a conversion surface the global tracker can name", () => {
  render(
    <IntelligenceOnboardingPrompt feature="threads" surface="docs_test" />,
  );

  expect(
    screen
      .getByRole("button", { name: /copy prompt/i })
      .getAttribute("data-docs-copy-surface"),
  ).toBe("docs_test");
});
