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
import {
  frameworkPromptSuffix,
  onboardingFrameworkSlug,
} from "@/lib/intelligence-onboarding-framework";
import {
  createIntelligenceOnboardingPrompt,
  createOnboardingRunId,
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * A framework the CLI's onboarding graph does have a node for, so the
 * framework sentence is non-empty and `agent_framework` is reportable.
 */
const MASTRA = { slug: "mastra", name: "Mastra" };
const PAGE_MARKDOWN_URL = "/mastra/generative-ui.mdx";
const PAGE_SENTENCE = ` The developer copied this prompt from ${DOCS_ORIGIN}${PAGE_MARKDOWN_URL}.`;

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

it("copies the canonical prompt plus the framework and page sentences", async () => {
  // A LOCAL guard only: the expected prompt comes from the same helper the
  // component calls, so this catches the component altering the canonical text
  // or appending anything beyond the two sentences below. It does NOT compare
  // against the Intelligence repo or the Inspector; keeping those three copies
  // byte-identical is not verified here.
  const writeText = stubClipboard();

  renderButton();
  clickCopy();

  await waitFor(() => expect(analytics.capture).toHaveBeenCalled());

  // Guard: if mastra ever stopped mapping to a graph node, the concatenation
  // below would still pass on an empty suffix and quietly assert nothing.
  const frameworkSentence = frameworkPromptSuffix(MASTRA.slug, MASTRA.name);
  expect(frameworkSentence).not.toBe("");

  expect(writeText).toHaveBeenCalledTimes(1);
  expect(writeText.mock.calls[0][0]).toBe(
    createIntelligenceOnboardingPrompt(reportedRunId()) +
      frameworkSentence +
      PAGE_SENTENCE,
  );
});

it("names the page's absolute .mdx URL as a statement of fact", async () => {
  const writeText = stubClipboard();

  renderButton();
  clickCopy();

  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));

  const copied = writeText.mock.calls[0][0] as string;
  // Absolute, not the path-only `markdownUrl` the row passes in: the receiving
  // agent has no origin to resolve a bare path against.
  expect(copied).toContain(`${DOCS_ORIGIN}${PAGE_MARKDOWN_URL}`);
  expect(copied.endsWith(PAGE_SENTENCE)).toBe(true);
});

it("reads the base URL on click and not during render", () => {
  // `getClientBaseUrl()` returns an SSR placeholder on the server. Reading it
  // while rendering would bake that placeholder into the server HTML and
  // produce a different string after hydration.
  stubClipboard();

  renderButton();

  expect(runtimeConfig.getRuntimeConfig).not.toHaveBeenCalled();

  clickCopy();

  expect(runtimeConfig.getRuntimeConfig).toHaveBeenCalled();
});

it("appends no framework sentence for a framework the graph does not know", async () => {
  // `built-in-agent` is one of the docs slugs the CLI's onboarding graph has
  // no node for. Naming it would promise a path the CLI cannot walk, so the
  // prompt stays silent about the framework and the page sentence — which has
  // to read correctly on its own — carries the whole of the added context.
  const writeText = stubClipboard();

  expect(frameworkPromptSuffix("built-in-agent", "Built-in Agent")).toBe("");

  renderButton({
    framework: { slug: "built-in-agent", name: "Built-in Agent" },
  });
  clickCopy();

  await waitFor(() => expect(analytics.capture).toHaveBeenCalled());

  expect(writeText.mock.calls[0][0]).toBe(
    createIntelligenceOnboardingPrompt(reportedRunId()) + PAGE_SENTENCE,
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

it("reports the shared onboarding event with the graph's framework slug", async () => {
  stubClipboard();

  renderButton();
  clickCopy();

  await waitFor(() => expect(analytics.capture).toHaveBeenCalled());

  const [event, properties] = analytics.capture.mock.calls[0] as [
    string,
    Record<string, unknown>,
  ];
  expect(event).toBe(INTELLIGENCE_ONBOARDING_EVENTS.promptCopied);
  // `agent_framework` carries the GRAPH slug, which is what the CLI reports
  // for the same run — not the docs registry slug the prop supplies. They
  // happen to agree for mastra; `crewai-crews` and `strands` do not.
  expect(onboardingFrameworkSlug(MASTRA.slug)).toBe("mastra");
  // No `feature` key. Every other emitter of this event sends a value of the
  // `IntelligenceOnboardingFeature` union ("learning" | "threads"); a fourth
  // value that is not a feature would muddy existing breakdowns of that
  // property. The distinction this button needs lives in `surface`.
  expect(properties).toEqual({
    from_path: "/mastra/generative-ui",
    onboarding_run_id: expect.stringMatching(/^[A-Za-z0-9_-]{12}$/),
    surface: "docs_page_tools_onboarding_prompt",
    agent_framework: "mastra",
  });
});

it("omits the framework property entirely when the graph has no slug", async () => {
  // Absence of the key, not an `undefined` value: a key present with no value
  // still shows up as a row in a PostHog breakdown.
  stubClipboard();

  renderButton({
    framework: { slug: "built-in-agent", name: "Built-in Agent" },
  });
  clickCopy();

  await waitFor(() => expect(analytics.capture).toHaveBeenCalled());

  const properties = analytics.capture.mock.calls[0][1] as Record<
    string,
    unknown
  >;
  expect(properties).not.toHaveProperty("agent_framework");
  expect(Object.keys(properties).sort()).toEqual([
    "from_path",
    "onboarding_run_id",
    "surface",
  ]);
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
  const suffix =
    frameworkPromptSuffix(MASTRA.slug, MASTRA.name) + PAGE_SENTENCE;
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
  const button = screen.getByRole("button");

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
    expect(screen.getByRole("button", { name: /copy blocked/i })).toBeTruthy(),
  );
  expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(
    false,
  );
});

it("keeps the label and swaps the icon on a successful copy", async () => {
  // "Copied" is ~45px narrower than the idle label, so swapping it would slide
  // "Copy Markdown" and "Open" leftward under the reader's cursor for 1800ms
  // and back. `MarkdownCopyButton` next to it avoids that the same way.
  stubClipboard();

  const { container } = renderButton();
  const before = container.querySelectorAll("svg").length;
  clickCopy();

  await waitFor(() => expect(screen.getByText("Prompt copied")).toBeTruthy());
  expect(
    screen.getByRole("button", { name: /copy agent prompt/i }),
  ).toBeTruthy();
  expect(container.querySelectorAll("svg").length).toBe(before);
});

it("uses a caller-supplied child as the idle label", () => {
  stubClipboard();

  renderButton({ children: "Set up with an agent" });

  expect(
    screen.getByRole("button", { name: /set up with an agent/i }),
  ).toBeTruthy();
});

it("does not report ITS OWN event when the clipboard rejects", async () => {
  // Scoped deliberately to this component's `docs.intelligence_onboarding_prompt_copied`
  // call: a run id that never reached a clipboard is an onboarding attempt
  // that cannot happen, so it must not enter the funnel as one.
  //
  // Other events may well have fired by then. The global tracker in
  // `lib/providers/copy-tracker.tsx` wraps `navigator.clipboard.writeText` and
  // captures `cli_command_copied` and `docs_conversion_copied` BEFORE it
  // delegates to the real `writeText` — so on a blocked copy those two have
  // already been reported. That tracker is not installed in this test.
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  const writeText = vi.fn().mockRejectedValue(new Error("denied"));
  Object.assign(navigator, { clipboard: { writeText } });

  renderButton();
  clickCopy();

  await waitFor(() =>
    expect(screen.getByRole("button", { name: /copy blocked/i })).toBeTruthy(),
  );
  expect(analytics.capture).not.toHaveBeenCalled();
  // The rejection is swallowed rather than re-thrown, so the console line is
  // the only trace a blocked copy leaves.
  expect(consoleError).toHaveBeenCalledWith(
    "[page-actions] Copy agent prompt failed",
    expect.any(Error),
  );
});

it("carries the conversion-surface attribute the global tracker looks for", () => {
  // Asserts the attribute is present on the button and spelled the same as the
  // `surface` event property. It does NOT exercise
  // `lib/providers/copy-tracker.tsx` — that the tracker resolves the value is
  // that module's own concern. The attribute is on the button rather than a
  // wrapper because this button is the only element of the page-tools row that
  // should count as this surface; `closest()` would find a wrapper just fine.
  stubClipboard();

  renderButton();

  expect(
    screen
      .getByRole("button", { name: /copy agent prompt/i })
      .getAttribute("data-docs-copy-surface"),
  ).toBe("docs_page_tools_onboarding_prompt");
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
