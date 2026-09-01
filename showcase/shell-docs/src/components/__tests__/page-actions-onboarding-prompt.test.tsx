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
import { OnboardingPromptCopyButton } from "../ai/page-actions";
import {
  createIntelligenceOnboardingPrompt,
  INTELLIGENCE_ONBOARDING_EVENTS,
} from "@/lib/intelligence-onboarding-prompt";

const analytics = vi.hoisted(() => ({ capture: vi.fn() }));

vi.mock("fumadocs-core/framework", () => ({
  usePathname: () => "/quickstart",
}));

vi.mock("posthog-js/react", () => ({
  usePostHog: () => analytics,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Install a resolving clipboard stub and hand back its spy. */
function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  return writeText;
}

/**
 * Click the button by role alone. Its accessible name is the label, which
 * changes to "Copied" after a successful copy, so a name-based query would
 * miss the second click of the per-click run-id test.
 */
function clickCopy() {
  fireEvent.click(screen.getByRole("button"));
}

it("copies the canonical prompt verbatim for the run id it reports", async () => {
  // The byte-identity guard. The same prompt text ships from Intelligence and
  // the Inspector, and the CLI parses the `--run <id>` it contains. Appending
  // page context here — a title, the page URL, a framework hint — would break
  // both the cross-surface diff and, if it landed after the flag, the parse.
  const writeText = stubClipboard();

  render(<OnboardingPromptCopyButton />);
  clickCopy();

  await waitFor(() => expect(analytics.capture).toHaveBeenCalled());

  const [, properties] = analytics.capture.mock.calls[0] as [
    string,
    Record<string, unknown>,
  ];
  const runId = properties.onboarding_run_id as string;

  expect(writeText).toHaveBeenCalledTimes(1);
  expect(writeText.mock.calls[0][0]).toBe(
    createIntelligenceOnboardingPrompt(runId),
  );
});

it("mints a run id in the shape the CLI validates", async () => {
  // `copilotkit onboard start --run <id>` rejects anything outside this
  // pattern, and it rejects silently as far as the docs reader is concerned:
  // the copy looks fine, the run never lands, the funnel loses the row.
  stubClipboard();

  render(<OnboardingPromptCopyButton />);
  clickCopy();

  await waitFor(() => expect(analytics.capture).toHaveBeenCalled());

  const [, properties] = analytics.capture.mock.calls[0] as [
    string,
    Record<string, unknown>,
  ];
  expect(properties.onboarding_run_id).toMatch(/^[A-Za-z0-9_-]{12}$/);
});

it("reports the shared onboarding event with all four properties", async () => {
  stubClipboard();

  render(<OnboardingPromptCopyButton />);
  clickCopy();

  await waitFor(() => expect(analytics.capture).toHaveBeenCalled());

  const [event, properties] = analytics.capture.mock.calls[0] as [
    string,
    Record<string, unknown>,
  ];
  expect(event).toBe(INTELLIGENCE_ONBOARDING_EVENTS.promptCopied);
  expect(properties).toEqual({
    feature: "onboarding",
    from_path: "/quickstart",
    onboarding_run_id: expect.stringMatching(/^[A-Za-z0-9_-]{12}$/),
    surface: "page-tools",
  });
});

it("mints a fresh run id on every click", async () => {
  // Documents the per-click decision. A run id hoisted to page load would let
  // one reader's two attempts collide onto a single funnel row, and the second
  // CLI run would report against a row the first already closed.
  const writeText = stubClipboard();

  render(<OnboardingPromptCopyButton />);

  clickCopy();
  await waitFor(() => expect(analytics.capture).toHaveBeenCalledTimes(1));
  clickCopy();
  await waitFor(() => expect(analytics.capture).toHaveBeenCalledTimes(2));

  const runIds = analytics.capture.mock.calls.map(
    (call) => (call[1] as Record<string, unknown>).onboarding_run_id,
  );
  expect(runIds[0]).not.toBe(runIds[1]);
  // Each clipboard write carries its own id, not a re-used one.
  expect(writeText.mock.calls[0][0]).toBe(
    createIntelligenceOnboardingPrompt(runIds[0] as string),
  );
  expect(writeText.mock.calls[1][0]).toBe(
    createIntelligenceOnboardingPrompt(runIds[1] as string),
  );
});

it("shows the blocked label and reports nothing when the clipboard rejects", async () => {
  // A run id that never reached a clipboard is an onboarding attempt that
  // cannot happen, so it must not enter the funnel as one.
  const writeText = vi.fn().mockRejectedValue(new Error("denied"));
  Object.assign(navigator, { clipboard: { writeText } });

  render(<OnboardingPromptCopyButton />);
  clickCopy();

  await waitFor(() =>
    expect(screen.getByRole("button", { name: /copy blocked/i })).toBeTruthy(),
  );
  expect(analytics.capture).not.toHaveBeenCalled();
});

it("marks itself as the page-tools conversion surface for the global tracker", () => {
  // `lib/providers/copy-tracker.tsx` resolves the surface with
  // `document.activeElement.closest("[data-docs-copy-surface]")`, so the
  // attribute has to be on the button, not on a wrapper around it.
  stubClipboard();

  render(<OnboardingPromptCopyButton />);

  expect(
    screen
      .getByRole("button", { name: /copy agent prompt/i })
      .getAttribute("data-docs-copy-surface"),
  ).toBe("docs_page_tools_onboarding_prompt");
});
