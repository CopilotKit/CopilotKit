// @vitest-environment jsdom

import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OnboardingPromptCopyButton } from "../ai/page-actions";
import { frontendPromptSuffix } from "@/lib/intelligence-onboarding-frontend";
import {
  createIntelligenceOnboardingPrompt,
  createOnboardingRunId,
} from "@/lib/intelligence-onboarding-prompt";
import { createChannelsOnboardingPrompt } from "@/lib/channels-onboarding-prompt";

const analytics = vi.hoisted(() => ({
  capture: vi.fn(),
  actionCapture: vi.fn(),
}));

/**
 * Mocked so one test can serve a local base URL and assert that the prompt
 * still names the production origin (PE-309).
 */
const runtimeConfig = vi.hoisted(() => ({
  getRuntimeConfig: vi.fn(() => ({ baseUrl: "https://docs.copilotkit.ai" })),
}));

const DOCS_ORIGIN = "https://docs.copilotkit.ai";

vi.mock("fumadocs-core/framework", () => ({
  usePathname: () => "/mastra/generative-ui",
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

vi.mock("@/lib/runtime-config.client", () => runtimeConfig);

HTMLDialogElement.prototype.showModal = function () {
  this.open = true;
};
HTMLDialogElement.prototype.close = function () {
  this.open = false;
};

afterEach(() => {
  runtimeConfig.getRuntimeConfig.mockImplementation(() => ({
    baseUrl: DOCS_ORIGIN,
  }));
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * A framework the CLI's onboarding graph does have a node for, so the
 * framework sentence is non-empty and `agent_framework` is reportable.
 */
const MASTRA = { slug: "mastra", name: "Mastra" };

/**
 * A registered framework the graph has NO node for, so the framework sentence
 * is "" and `agent_framework` is left off the event entirely.
 */
const SPRING_AI = { slug: "spring-ai", name: "Spring AI" };

/**
 * A docs frontend the graph has NO node for: Slack is a chat channel, not an
 * application frontend. The frontend sentence is "" and `frontend` is left off
 * the event entirely.
 */
const SLACK = { id: "slack", name: "Slack" };
const PAGE_MARKDOWN_URL = "/mastra/generative-ui.mdx";
const PAGE_SENTENCE = ` I started from this CopilotKit docs page: ${DOCS_ORIGIN}/mastra/generative-ui.`;
const MASTRA_TOPIC = " The page covers the Mastra agent framework.";
const FEATURE = {
  cell: "agent-config",
  title: "Agent Config",
  description:
    "Let users change the agent's tone, expertise, and response length.",
};

/**
 * Render with the props every framework-scoped page supplies, so each test
 * only names the ones it actually cares about.
 */
function renderButton(
  props: Partial<React.ComponentProps<typeof OnboardingPromptCopyButton>> = {},
) {
  return render(
    <OnboardingPromptCopyButton
      framework={MASTRA}
      markdownUrl={PAGE_MARKDOWN_URL}
      {...props}
    />,
  );
}

/** Install a resolving clipboard stub and hand back its spy. */
function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  return writeText;
}

/**
 * Install a clipboard stub whose write stays pending until the returned
 * `resolveWrite` is called, so a test can act while a copy is in flight.
 */
function stubPendingClipboard() {
  let resolve: (() => void) | undefined;
  const writeText = vi.fn(
    () =>
      new Promise<void>((resolveWrite) => {
        resolve = resolveWrite;
      }),
  );
  Object.assign(navigator, { clipboard: { writeText } });
  return { writeText, resolveWrite: () => resolve?.() };
}

/**
 * Click the button by role alone, so the query does not depend on the label.
 */
function clickCopy() {
  fireEvent.click(screen.getByRole("button", { name: /^copy prompt$/i }));
}

/** The run id the component reported for the copy it just made. */
function reportedRunId(callIndex = 0): string {
  const [, properties] = analytics.capture.mock.calls[callIndex] as [
    string,
    Record<string, unknown>,
  ];
  return properties.onboarding_run_id as string;
}

it("asks for the Showcase-bound outcome after generic onboarding", async () => {
  const writeText = stubClipboard();

  renderButton({ feature: FEATURE });
  clickCopy();

  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));

  expect(writeText.mock.calls[0][0]).toContain(
    "After onboarding, implement the Showcase feature “Agent Config” in this app. Its goal: Let users change the agent's tone, expertise, and response length. Follow the linked guide.",
  );
});

it("leaves quickstarts and references generic without a feature binding", async () => {
  const writeText = stubClipboard();

  renderButton();
  clickCopy();

  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));

  expect(writeText.mock.calls[0][0]).not.toContain(
    "After onboarding, implement",
  );
});

it("mints a run id in the shape the CLI validates", async () => {
  // `copilotkit onboard start --run <id>` rejects anything outside this
  // pattern, and it rejects silently as far as the docs reader is concerned:
  // the copy looks fine, the run never lands, the funnel loses the row.
  stubClipboard();

  renderButton();
  clickCopy();

  await waitFor(() => expect(analytics.capture).toHaveBeenCalled());

  expect(reportedRunId()).toMatch(/^[A-Za-z0-9_-]{12}$/);
});

it("mints a fresh run id on every click", async () => {
  // Documents the per-click decision. A run id hoisted to page load would let
  // one reader's two attempts collide onto a single funnel row, and the second
  // CLI run would report against a row the first already closed.
  const writeText = stubClipboard();

  renderButton();

  clickCopy();
  await waitFor(() => expect(analytics.capture).toHaveBeenCalledTimes(1));
  clickCopy();
  await waitFor(() => expect(analytics.capture).toHaveBeenCalledTimes(2));

  const runIds = [reportedRunId(0), reportedRunId(1)];
  expect(runIds[0]).not.toBe(runIds[1]);
  const suffix = MASTRA_TOPIC + PAGE_SENTENCE;
  // Each clipboard write carries its own id, not a re-used one.
  expect(writeText.mock.calls[0][0]).toBe(
    createIntelligenceOnboardingPrompt(runIds[0]) + suffix,
  );
  expect(writeText.mock.calls[1][0]).toBe(
    createIntelligenceOnboardingPrompt(runIds[1]) + suffix,
  );
});

it("writes and reports once for two clicks while the first write is pending", async () => {
  // The in-flight guard. Without it a double-click mints two run ids and
  // reports two copies, while only the second write survives on the clipboard
  // — so the CLI can close out at most one of them and the other is a
  // permanently open funnel row.
  const { writeText, resolveWrite } = stubPendingClipboard();

  renderButton();
  const button = screen.getByRole("button", { name: /^copy prompt$/i });

  // Native `.click()` inside one `act` scope, so React has not re-rendered
  // (and applied `disabled`) between the two events. This exercises the ref
  // guard inside the handler, not the disabled attribute.
  await act(async () => {
    button.click();
    button.click();
  });
  expect(writeText).toHaveBeenCalledTimes(1);

  await act(async () => {
    resolveWrite();
  });
  await waitFor(() => expect(analytics.capture).toHaveBeenCalledTimes(1));
  expect(writeText).toHaveBeenCalledTimes(1);
});

it("re-enables the button after a clipboard write rejects", async () => {
  // The disabled window must not get stuck on the failure path, or one blocked
  // copy would take the button out of service for the rest of the page view.
  vi.spyOn(console, "error").mockImplementation(() => {});
  const writeText = vi.fn().mockRejectedValue(new Error("denied"));
  Object.assign(navigator, { clipboard: { writeText } });

  renderButton();
  clickCopy();

  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain("Copy blocked"),
  );
  expect(
    (
      screen.getByRole("button", {
        name: /^copy prompt$/i,
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
});

it("survives unmounting while the clipboard write is still pending", async () => {
  // The mounted/generation guards exist for exactly this: no state update and
  // no reset timer may run against a component that is gone. The analytics
  // call is deliberately still made — that write did reach the clipboard.
  //
  // React 19 no longer logs a "state update on an unmounted component"
  // warning, so the console assertion alone would pass even with every guard
  // deleted. The `setTimeout` assertion is the one with teeth: reaching
  // `scheduleReset` after unmount means the generation check was skipped.
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  const { resolveWrite } = stubPendingClipboard();

  const { unmount } = renderButton();
  await act(async () => {
    screen.getByRole("button", { name: /^copy prompt$/i }).click();
  });

  unmount();
  const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

  await act(async () => {
    resolveWrite();
  });

  expect(setTimeoutSpy).not.toHaveBeenCalled();
  expect(consoleError).not.toHaveBeenCalled();
});

it("mints a valid run id on all three createOnboardingRunId code paths", () => {
  const shape = /^[A-Za-z0-9_-]{12}$/;

  // 1. `crypto.randomUUID` — what jsdom and every current browser provide.
  expect(createOnboardingRunId()).toMatch(shape);

  // 2. `crypto.getRandomValues` only — older Safari, and any non-secure
  //    context where `randomUUID` is withheld.
  vi.stubGlobal("crypto", {
    getRandomValues: (array: Uint8Array) => {
      for (let i = 0; i < array.length; i += 1) array[i] = (i * 37) % 256;
      return array;
    },
  });
  expect(createOnboardingRunId()).toMatch(shape);

  // 3. No web crypto at all — the `Math.random` last resort.
  vi.stubGlobal("crypto", undefined);
  expect(createOnboardingRunId()).toMatch(shape);
});

// ---------------------------------------------------------------------------
// The frontend (OSS-1071). The copied text no longer names it (PE-309), but a
// Slack or Teams frontend still selects the Channels prompt, and every
// frontend still reaches the event as the graph's slug.
// ---------------------------------------------------------------------------

it("copies the generic prompt plus the page source on a Channel page", async () => {
  // Slack is not a graph frontend slug. The copied text is the same small
  // command as the website CTA, plus the standard page source sentence. The
  // graph uses that source URL to see Slack or Teams.
  const writeText = stubClipboard();

  expect(frontendPromptSuffix(SLACK.id, SLACK.name)).toBe("");

  renderButton({ frontend: SLACK });
  clickCopy();

  await waitFor(() => expect(analytics.capture).toHaveBeenCalled());

  // No framework sentence either, even though the page names one: on a channel
  // page the framework is the route default rather than a reader's choice, and
  // `feature/channels/start` inspects the project for it instead.
  expect(writeText.mock.calls[0][0]).toBe(
    createChannelsOnboardingPrompt(reportedRunId()) + PAGE_SENTENCE,
  );
});

it("ignores the page's framework entirely on a channel page", async () => {
  // Whether the route names a framework the graph knows (`mastra`, above) or
  // one it does not (`spring-ai`), a channel page copies the same command. The
  // route settles the framework by inspection, so neither case may leak into
  // the text.
  const writeText = stubClipboard();

  renderButton({ framework: SPRING_AI, frontend: SLACK });
  clickCopy();

  await waitFor(() => expect(analytics.capture).toHaveBeenCalled());

  expect(writeText.mock.calls[0][0]).toBe(
    createChannelsOnboardingPrompt(reportedRunId()) + PAGE_SENTENCE,
  );
});
