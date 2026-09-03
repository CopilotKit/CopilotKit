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
import { OnboardingPromptButton } from "../onboarding-prompt-button";
import { frameworkPromptSuffix } from "@/lib/intelligence-onboarding-framework";
import {
  frontendPromptSuffix,
  onboardingFrontendSlug,
} from "@/lib/intelligence-onboarding-frontend";
import {
  createIntelligenceOnboardingPrompt,
  INTELLIGENCE_ONBOARDING_EVENTS,
} from "@/lib/intelligence-onboarding-prompt";

const analytics = vi.hoisted(() => ({ capture: vi.fn() }));

const runtimeConfig = vi.hoisted(() => ({
  getRuntimeConfig: vi.fn(() => ({ baseUrl: "https://docs.copilotkit.ai" })),
}));

const DOCS_ORIGIN = "https://docs.copilotkit.ai";

// `usePathname` comes from `fumadocs-core/framework`, not `next/navigation`:
// this component renders inside the Fumadocs docs shell.
vi.mock("fumadocs-core/framework", () => ({
  usePathname: () => "/mastra/generative-ui",
}));

vi.mock("posthog-js/react", () => ({
  usePostHog: () => analytics,
}));

vi.mock("@/lib/runtime-config.client", () => runtimeConfig);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

/** A framework the CLI's onboarding graph does have a node for. */
const MASTRA = { slug: "mastra", name: "Mastra" };

/** The docs' default frontend — the graph spells it `nextjs`. */
const REACT = { id: "react", name: "React" };

const SURFACE = "docs_page_tools_onboarding_prompt";
const PAGE_MARKDOWN_URL = "/mastra/generative-ui.mdx";
const PAGE_SENTENCE = ` The developer copied this prompt from ${DOCS_ORIGIN}${PAGE_MARKDOWN_URL}.`;

/** Install a resolving clipboard stub and hand back its spy. */
function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  return writeText;
}

/** Click the button by role alone, so the query does not depend on the label. */
function clickCopy() {
  fireEvent.click(screen.getByRole("button"));
}

/** The run id the component reported for the copy it just made. */
function reportedRunId(callIndex = 0): string {
  const [, properties] = analytics.capture.mock.calls[callIndex] as [
    string,
    Record<string, unknown>,
  ];
  return properties.onboarding_run_id as string;
}

it("composes the framework, frontend and page sentences in the graph's order", async () => {
  // The graph settles the agent framework first and the frontend second, so
  // the sentences are appended in that order and the page sentence closes.
  const writeText = stubClipboard();

  // Guards: if either mapping were lost, the concatenation below would still
  // pass on an empty suffix and quietly assert nothing.
  const frameworkSentence = frameworkPromptSuffix(MASTRA.slug, MASTRA.name);
  const frontendSentence = frontendPromptSuffix(REACT.id, REACT.name);
  expect(frameworkSentence).not.toBe("");
  expect(frontendSentence).not.toBe("");

  render(
    <OnboardingPromptButton
      variant="compact"
      surface={SURFACE}
      framework={MASTRA}
      frontend={REACT}
      markdownUrl={PAGE_MARKDOWN_URL}
    />,
  );
  clickCopy();

  await waitFor(() => expect(analytics.capture).toHaveBeenCalled());

  expect(writeText).toHaveBeenCalledTimes(1);
  expect(writeText.mock.calls[0][0]).toBe(
    createIntelligenceOnboardingPrompt(reportedRunId()) +
      frameworkSentence +
      frontendSentence +
      PAGE_SENTENCE,
  );
});

it("copies the canonical prompt alone when there is nothing to name", async () => {
  // Every one of the three sentences is "" independently, so a surface that
  // knows no framework, no frontend and no page copies exactly the canonical
  // prompt — no trailing space, no orphaned separator.
  const writeText = stubClipboard();

  render(<OnboardingPromptButton variant="compact" surface={SURFACE} />);
  clickCopy();

  await waitFor(() => expect(analytics.capture).toHaveBeenCalled());

  expect(writeText.mock.calls[0][0]).toBe(
    createIntelligenceOnboardingPrompt(reportedRunId()),
  );
});

it("carries the caller's surface as the conversion-surface attribute", () => {
  // The global tracker in `lib/providers/copy-tracker.tsx` resolves the
  // surface with `closest("[data-docs-copy-surface]")`. The attribute sits on
  // the button itself, and spells the same value the event reports.
  stubClipboard();

  render(
    <OnboardingPromptButton
      variant="compact"
      surface={SURFACE}
      markdownUrl={PAGE_MARKDOWN_URL}
    />,
  );

  expect(
    screen.getByRole("button").getAttribute("data-docs-copy-surface"),
  ).toBe(SURFACE);
});

it("reports the shared onboarding event with the graph's slugs", async () => {
  stubClipboard();

  render(
    <OnboardingPromptButton
      variant="compact"
      surface={SURFACE}
      framework={MASTRA}
      frontend={REACT}
      markdownUrl={PAGE_MARKDOWN_URL}
    />,
  );
  clickCopy();

  await waitFor(() => expect(analytics.capture).toHaveBeenCalled());

  const [event, properties] = analytics.capture.mock.calls[0] as [
    string,
    Record<string, unknown>,
  ];
  expect(event).toBe(INTELLIGENCE_ONBOARDING_EVENTS.promptCopied);
  // The GRAPH slug, not the docs id, so the property joins the value the CLI
  // records for the same run: `nextjs`, not `react`.
  expect(onboardingFrontendSlug(REACT.id)).toBe("nextjs");
  // No `feature` key: every other emitter of this event sends a value of the
  // `IntelligenceOnboardingFeature` union, and this button is neither.
  expect(properties).toEqual({
    from_path: "/mastra/generative-ui",
    onboarding_run_id: expect.stringMatching(/^[A-Za-z0-9_-]{12}$/),
    surface: SURFACE,
    agent_framework: "mastra",
    frontend: "nextjs",
  });
});

it("omits the framework and frontend keys when the caller names neither", async () => {
  // Absence of the key, not an `undefined` value: a key present with no value
  // still shows up as its own row in a PostHog breakdown.
  stubClipboard();

  render(
    <OnboardingPromptButton
      variant="compact"
      surface={SURFACE}
      markdownUrl={PAGE_MARKDOWN_URL}
    />,
  );
  clickCopy();

  await waitFor(() => expect(analytics.capture).toHaveBeenCalled());

  const properties = analytics.capture.mock.calls[0][1] as Record<
    string,
    unknown
  >;
  expect(Object.keys(properties).sort()).toEqual([
    "from_path",
    "onboarding_run_id",
    "surface",
  ]);
});

it("mints a fresh run id on every click", async () => {
  // Today's behaviour, carried over unchanged: one clipboard write is one
  // onboarding attempt, and the CLI closes out the id that was copied. A
  // hoisted id would collapse a reader's two attempts onto one funnel row.
  const writeText = stubClipboard();

  render(
    <OnboardingPromptButton
      variant="compact"
      surface={SURFACE}
      framework={MASTRA}
      markdownUrl={PAGE_MARKDOWN_URL}
    />,
  );

  clickCopy();
  await waitFor(() => expect(analytics.capture).toHaveBeenCalledTimes(1));
  clickCopy();
  await waitFor(() => expect(analytics.capture).toHaveBeenCalledTimes(2));

  const runIds = [reportedRunId(0), reportedRunId(1)];
  expect(runIds[0]).not.toBe(runIds[1]);
  expect(runIds[0]).toMatch(/^[A-Za-z0-9_-]{12}$/);

  // Each clipboard write carries its own id, not a re-used one.
  const suffix =
    frameworkPromptSuffix(MASTRA.slug, MASTRA.name) + PAGE_SENTENCE;
  expect(writeText.mock.calls[0][0]).toBe(
    createIntelligenceOnboardingPrompt(runIds[0]) + suffix,
  );
  expect(writeText.mock.calls[1][0]).toBe(
    createIntelligenceOnboardingPrompt(runIds[1]) + suffix,
  );
});
