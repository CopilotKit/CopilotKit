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
import { Check, Copy } from "lucide-react";
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

/**
 * Spied rather than stubbed: one test asserts the base URL is read only on
 * click, because reading it during render would serialize the SSR placeholder
 * into the server HTML and mismatch on hydration.
 */
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

/** Every appearance the button can wear, so no test covers only one. */
const VARIANTS = ["compact", "hero"] as const;

const SURFACE = "docs_page_tools_onboarding_prompt";
/** The surface name the hero placement is registered under. */
const HERO_SURFACE = "docs_landing_hero";
const PAGE_MARKDOWN_URL = "/mastra/generative-ui.mdx";
const PAGE_SENTENCE = ` The developer copied this prompt from ${DOCS_ORIGIN}${PAGE_MARKDOWN_URL}.`;

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

/** Install a clipboard stub whose write always rejects. */
function stubRejectingClipboard() {
  const writeText = vi.fn().mockRejectedValue(new Error("denied"));
  Object.assign(navigator, { clipboard: { writeText } });
  return writeText;
}

/** Click the button by role alone, so the query does not depend on the label. */
function clickCopy() {
  fireEvent.click(screen.getByRole("button"));
}

/**
 * The geometry a lucide icon draws, which is what actually identifies it. The
 * `lucide-*` class names it also emits are not a contract, so the icon tests
 * compare against the icons themselves rather than against a class string.
 */
function iconGeometry(icon: React.ReactElement): string {
  const { container, unmount } = render(icon);
  const markup = container.querySelector("svg")?.innerHTML ?? "";
  unmount();
  return markup;
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

it("reads the base URL on click and not during render", () => {
  // `getClientBaseUrl()` returns an SSR placeholder on the server. Reading it
  // while rendering would bake that placeholder into the server HTML and
  // produce a different string after hydration.
  stubClipboard();

  render(
    <OnboardingPromptButton
      variant="compact"
      surface={SURFACE}
      markdownUrl={PAGE_MARKDOWN_URL}
    />,
  );

  expect(runtimeConfig.getRuntimeConfig).not.toHaveBeenCalled();

  clickCopy();

  expect(runtimeConfig.getRuntimeConfig).toHaveBeenCalled();
});

it("carries the caller's surface as the conversion-surface attribute", () => {
  // The global tracker in `lib/providers/copy-tracker.tsx` resolves the
  // surface with `closest("[data-docs-copy-surface]")`. The attribute sits on
  // the button itself, and spells the same value the event reports. Both
  // appearances carry it: `variant` decides how the button looks, never
  // whether the tracker can name what was copied.
  stubClipboard();

  for (const variant of VARIANTS) {
    const { container, unmount } = render(
      <OnboardingPromptButton
        variant={variant}
        surface={SURFACE}
        markdownUrl={PAGE_MARKDOWN_URL}
      />,
    );

    expect(
      container.querySelector("button")?.getAttribute("data-docs-copy-surface"),
    ).toBe(SURFACE);

    unmount();
  }
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

it("omits both keys when the caller names them and the graph knows neither", async () => {
  // A different path from naming nothing: here the caller DID supply both
  // props, and the CLI's onboarding graph has no node for either value. The
  // keys still have to be absent rather than present-and-undefined, because a
  // key with no value still shows up as its own row in a PostHog breakdown.
  const writeText = stubClipboard();

  // Guards: the assertions below only mean anything while the graph really
  // has no node for these two. If either gained one, they would pass while
  // asserting nothing.
  expect(frameworkPromptSuffix(SPRING_AI.slug, SPRING_AI.name)).toBe("");
  expect(frontendPromptSuffix(SLACK.id, SLACK.name)).toBe("");

  render(
    <OnboardingPromptButton
      variant="compact"
      surface={SURFACE}
      framework={SPRING_AI}
      frontend={SLACK}
      markdownUrl={PAGE_MARKDOWN_URL}
    />,
  );
  clickCopy();

  await waitFor(() => expect(analytics.capture).toHaveBeenCalled());

  const properties = analytics.capture.mock.calls[0][1] as Record<
    string,
    unknown
  >;
  expect(properties).not.toHaveProperty("agent_framework");
  expect(properties).not.toHaveProperty("frontend");
  expect(Object.keys(properties).sort()).toEqual([
    "from_path",
    "onboarding_run_id",
    "surface",
  ]);
  // And the prompt names neither: naming a framework or frontend the CLI has
  // no node for would promise a path it cannot walk, so the page sentence —
  // which has to read correctly on its own — carries the whole of the context.
  expect(writeText.mock.calls[0][0]).toBe(
    createIntelligenceOnboardingPrompt(reportedRunId()) + PAGE_SENTENCE,
  );
});

it("keeps one run id for the lifetime of a mount", async () => {
  // Repeated clicks on one button are one onboarding attempt, so they share
  // one id. Minting per click left an unclosable funnel row behind every click
  // but the last: only the id that survived on the clipboard ever reaches the
  // CLI, so no other id can be closed out.
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
  expect(runIds[0]).toBe(runIds[1]);
  expect(runIds[0]).toMatch(/^[A-Za-z0-9_-]{12}$/);

  // Both clipboard writes carry that one id, and it is the id reported.
  const suffix =
    frameworkPromptSuffix(MASTRA.slug, MASTRA.name) + PAGE_SENTENCE;
  expect(writeText.mock.calls[0][0]).toBe(
    createIntelligenceOnboardingPrompt(runIds[0]) + suffix,
  );
  expect(writeText.mock.calls[1][0]).toBe(
    createIntelligenceOnboardingPrompt(runIds[0]) + suffix,
  );
});

it("writes and reports once for two clicks while the first write is pending", async () => {
  // The in-flight guard. Both writes carry the mount's one run id, so without
  // it a double-click would report the same onboarding attempt twice — one
  // attempt reported as two, which double-counts the reader in the funnel.
  const { writeText } = stubPendingClipboard();

  render(
    <OnboardingPromptButton
      variant="compact"
      surface={SURFACE}
      markdownUrl={PAGE_MARKDOWN_URL}
    />,
  );
  const button = screen.getByRole("button");

  // Native `.click()` inside one `act` scope, so React has not re-rendered
  // (and applied `disabled`) between the two events. This exercises the ref
  // guard inside the handler, not the disabled attribute.
  await act(async () => {
    button.click();
    button.click();
  });

  expect(writeText).toHaveBeenCalledTimes(1);
  expect(analytics.capture).not.toHaveBeenCalled();
});

it("re-enables the button after a clipboard write rejects", async () => {
  // The disabled window must not get stuck on the failure path, or one blocked
  // copy would take the button out of service for the rest of the page view.
  vi.spyOn(console, "error").mockImplementation(() => {});
  stubRejectingClipboard();

  render(
    <OnboardingPromptButton
      variant="compact"
      surface={SURFACE}
      markdownUrl={PAGE_MARKDOWN_URL}
    />,
  );
  clickCopy();

  await waitFor(() =>
    expect(screen.getByRole("button", { name: /copy blocked/i })).toBeTruthy(),
  );
  expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(
    false,
  );
});

it("does not report ITS OWN event when the clipboard rejects", async () => {
  // A run id that never reached a clipboard is an onboarding attempt that
  // cannot happen, so it must not enter the funnel as one. Scoped to this
  // component's own capture: the global tracker in
  // `lib/providers/copy-tracker.tsx` reports before it delegates to the real
  // `writeText`, and it is not installed in this test.
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  stubRejectingClipboard();

  render(
    <OnboardingPromptButton
      variant="compact"
      surface={SURFACE}
      markdownUrl={PAGE_MARKDOWN_URL}
    />,
  );
  clickCopy();

  await waitFor(() =>
    expect(screen.getByRole("button", { name: /copy blocked/i })).toBeTruthy(),
  );
  expect(analytics.capture).not.toHaveBeenCalled();
  // The rejection is swallowed rather than re-thrown, so the console line is
  // the only trace a blocked copy leaves.
  expect(consoleError).toHaveBeenCalledWith(
    "[onboarding-prompt-button] Copy agent prompt failed",
    expect.any(Error),
  );
});

it("announces both outcomes in the aria-live region", async () => {
  // The icon swap is what a sighted reader sees; the polite region is what a
  // screen reader gets instead. Success keeps the idle label — "Copied" is
  // ~45px narrower and would slide the row's other buttons under the cursor —
  // so the announcement is the only signal on that path.
  vi.spyOn(console, "error").mockImplementation(() => {});
  stubClipboard();

  const { container, unmount } = render(
    <OnboardingPromptButton
      variant="compact"
      surface={SURFACE}
      markdownUrl={PAGE_MARKDOWN_URL}
    />,
  );
  const iconsBefore = container.querySelectorAll("svg").length;
  clickCopy();

  await waitFor(() => expect(screen.getByText("Prompt copied")).toBeTruthy());
  expect(
    screen.getByRole("button", { name: /copy agent prompt/i }),
  ).toBeTruthy();
  expect(container.querySelectorAll("svg").length).toBe(iconsBefore);

  unmount();
  stubRejectingClipboard();

  render(
    <OnboardingPromptButton
      variant="compact"
      surface={SURFACE}
      markdownUrl={PAGE_MARKDOWN_URL}
    />,
  );
  clickCopy();

  await waitFor(() =>
    expect(screen.getByText("Prompt copy failed. Try again.")).toBeTruthy(),
  );
});

it("swaps the copy icon for a check on a successful copy", async () => {
  // The label deliberately does not change on success, so the icon is the
  // whole of what a sighted reader sees. Counting the icons would not catch a
  // swap that never happened — this compares the rendered geometry against
  // both icons, so leaving `Copy` in place fails.
  stubClipboard();

  const copyIcon = iconGeometry(<Copy />);
  const checkIcon = iconGeometry(<Check />);
  // Guard: the comparison below is only meaningful while the two differ.
  expect(copyIcon).not.toBe(checkIcon);

  const { container } = render(
    <OnboardingPromptButton
      variant="compact"
      surface={SURFACE}
      markdownUrl={PAGE_MARKDOWN_URL}
    />,
  );
  const buttonIcon = () =>
    container.querySelector("button svg")?.innerHTML ?? "";

  expect(buttonIcon()).toBe(copyIcon);

  clickCopy();

  await waitFor(() => expect(screen.getByText("Prompt copied")).toBeTruthy());
  expect(buttonIcon()).toBe(checkIcon);
});

it("uses a caller-supplied child as the idle label", () => {
  // The row that hosts the compact button and the docs hero both relabel it,
  // so neither appearance may hard-code the default.
  stubClipboard();

  for (const variant of VARIANTS) {
    const { unmount } = render(
      <OnboardingPromptButton variant={variant} surface={SURFACE}>
        Set up with an agent
      </OnboardingPromptButton>,
    );

    expect(
      screen.getByRole("button", { name: /^set up with an agent$/i }),
    ).toBeTruthy();

    unmount();
  }
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

  const { unmount } = render(
    <OnboardingPromptButton
      variant="compact"
      surface={SURFACE}
      markdownUrl={PAGE_MARKDOWN_URL}
    />,
  );
  await act(async () => {
    screen.getByRole("button").click();
  });

  unmount();
  const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

  await act(async () => {
    resolveWrite();
  });

  expect(setTimeoutSpy).not.toHaveBeenCalled();
  expect(consoleError).not.toHaveBeenCalled();
});

it("composes the same prompt whichever appearance it wears", async () => {
  // `variant` picks an appearance and nothing else. The prompt is the product,
  // so the same props have to compose the same string on every surface — a
  // fork here would split one funnel into two halves nobody can compare.
  const composed: string[] = [];

  for (const variant of VARIANTS) {
    const writeText = stubClipboard();

    const { unmount } = render(
      <OnboardingPromptButton
        variant={variant}
        surface={SURFACE}
        framework={MASTRA}
        frontend={REACT}
        markdownUrl={PAGE_MARKDOWN_URL}
      />,
    );
    clickCopy();
    await waitFor(() => expect(analytics.capture).toHaveBeenCalled());

    // Compare the whole string, with only the per-mount run id neutralised —
    // that is the one part that is meant to differ between two mounts.
    composed.push(
      (writeText.mock.calls[0][0] as string).replaceAll(
        reportedRunId(),
        "<run-id>",
      ),
    );

    unmount();
    analytics.capture.mockClear();
  }

  expect(composed[0]).toBe(composed[1]);
  // Guard: the equality above is over a real composed prompt, not two blanks.
  expect(composed[0]).toContain(
    frameworkPromptSuffix(MASTRA.slug, MASTRA.name),
  );
  expect(composed[0]).toContain(PAGE_SENTENCE);
});

it("copies the canonical prompt alone from the hero surface", async () => {
  // The hero on the docs home names no framework, no frontend and no page, so
  // what it copies is exactly the canonical prompt the Intelligence repo and
  // the Inspector have to keep matching byte for byte.
  const writeText = stubClipboard();

  render(<OnboardingPromptButton variant="hero" surface={HERO_SURFACE} />);
  clickCopy();

  await waitFor(() => expect(analytics.capture).toHaveBeenCalled());

  expect(writeText.mock.calls[0][0]).toBe(
    createIntelligenceOnboardingPrompt(reportedRunId()),
  );
});

it("reserves the hero button's width with an invisible idle label", () => {
  // The status labels are shorter than the idle one, so a hero button that
  // rendered only the active label would collapse mid-interaction and shunt
  // the Quickstart button beside it sideways. The invisible copy holds the
  // width, and being `aria-hidden` it does not double the accessible name.
  stubClipboard();

  const hero = render(
    <OnboardingPromptButton variant="hero" surface={HERO_SURFACE} />,
  );

  const reserved = hero.container.querySelector("span.invisible");
  expect(reserved?.textContent).toBe("Copy agent prompt");
  expect(reserved?.getAttribute("aria-hidden")).toBe("true");
  expect(
    screen.getByRole("button", { name: /^copy agent prompt$/i }),
  ).toBeTruthy();

  hero.unmount();

  // The compact button sits in a row that does not need the reservation, so
  // it does not pay for it.
  const compact = render(
    <OnboardingPromptButton variant="compact" surface={SURFACE} />,
  );
  expect(compact.container.querySelector("span.invisible")).toBeNull();
});

it("sizes each appearance's icon on the button, not on the icon element", () => {
  // The icons render without a className of their own, and lucide-react
  // defaults to 24px — so the sizing has to ride along with the appearance.
  // The port of the hero shipped without it once, which rendered a 24px icon
  // where the button it replaced had a 16px one. Only the appearance-critical
  // tokens are pinned here; the rest of the class string stays free to move.
  stubClipboard();

  const hero = render(
    <OnboardingPromptButton variant="hero" surface={HERO_SURFACE} />,
  );
  const heroClasses =
    hero.container.querySelector("button")?.className.split(/\s+/) ?? [];
  expect(heroClasses).toContain("[&_svg]:size-4");
  // The hero disables itself while a write is pending, so it styles that state.
  expect(heroClasses).toContain("disabled:pointer-events-none");
  expect(heroClasses).toContain("disabled:opacity-50");

  hero.unmount();

  // The compact button sits in a row of buttons whose heights have to match, so
  // it carries its own, smaller icon size.
  const compact = render(
    <OnboardingPromptButton variant="compact" surface={SURFACE} />,
  );
  expect(
    compact.container.querySelector("button")?.className.split(/\s+/),
  ).toContain("[&_svg]:size-3.5");
});
