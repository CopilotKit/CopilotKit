// @vitest-environment jsdom

import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SetupWizard } from "../setup-wizard";
import type { MapCapability, MapPick } from "@/lib/homepage-map";
import { composeWizardOnboardingPrompt } from "@/lib/wizard-onboarding-prompt";
import type * as WizardStepperParts from "@/components/wizard-stepper-parts";

const analytics = vi.hoisted(() => ({ capture: vi.fn() }));

vi.mock("posthog-js/react", () => ({
  usePostHog: () => analytics,
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

/**
 * The wizard's own `handleJump` refuses a step past `furthest` independently
 * of `WizardProgress`'s `disabled` attribute — but a disabled React button
 * never dispatches its click handler in the first place (React consults the
 * `disabled` prop it last rendered with, not the live DOM node, so toggling
 * the DOM attribute by hand does not bypass it). The only way to exercise
 * the wizard's own guard is to call the `onJump` callback directly, the same
 * way a legitimately-enabled rail button would. This wraps the real
 * `WizardProgress` — preserving every rendered-semantics assertion below —
 * purely to capture that callback.
 */
let capturedOnJump: ((step: number, pointerActivated: boolean) => void) | null =
  null;

/**
 * Same idea as `capturedOnJump` above, for `WizardNav`'s `onBack` — the only
 * way to invoke a `handleBack` closure captured in an earlier render (before
 * a later step change) instead of the one the currently-rendered footer
 * would dispatch to on a real click. Used by the stale-handler regression
 * tests below (`currentRef`/`furthestRef` in `setup-wizard.tsx`).
 */
let capturedOnBack: ((pointerActivated: boolean) => void) | null = null;

/** The `Element.prototype.animate` stub installed in `beforeEach`, kept
 *  reachable so a test can inspect what the component actually passed to
 *  `animate()` — e.g. that no call ever asks for `fill: "forwards"` — since
 *  the mocked WAAPI otherwise has no observable effect on the DOM. */
let animateSpy: ReturnType<typeof vi.fn>;

vi.mock("@/components/wizard-stepper-parts", async (importOriginal) => {
  const actual = await importOriginal<typeof WizardStepperParts>();
  return {
    ...actual,
    WizardProgress: (
      props: React.ComponentProps<typeof actual.WizardProgress>,
    ) => {
      capturedOnJump = props.onJump;
      return <actual.WizardProgress {...props} />;
    },
    WizardNav: (props: React.ComponentProps<typeof actual.WizardNav>) => {
      capturedOnBack = props.onBack ?? null;
      return <actual.WizardNav {...props} />;
    },
  };
});

// Deliberately carries no `summary` — `PickGrid`'s `size="card"` folds the
// summary into the button's accessible name (name plus summary, like
// `CapabilityGrid`'s title-plus-body), which would break every exact-name
// `getByRole("button", { name: "React" })` query used throughout this file.
// The "PickGrid size per step" tests below use their own, separate fixture
// with a summary for exactly that reason, rather than putting one here.
const FRONTENDS: readonly MapPick[] = [
  { id: "react", name: "React", logo: { kind: "frontend", icon: "react" } },
  { id: "vue", name: "Vue", logo: { kind: "frontend", icon: "vue" } },
];

const CAPABILITIES: readonly MapCapability[] = [
  {
    id: "chat",
    title: "Chat surface",
    body: "Drop in a ready-made chat, sidebar, or popup.",
    icon: "MessageSquare",
  },
  {
    id: "gen-ui",
    title: "Generative UI",
    body: "Your agent returns real React components, not just text.",
    icon: "Paintbrush",
  },
];

const BACKENDS: readonly MapPick[] = [
  {
    id: "mastra",
    name: "Mastra",
    logo: { kind: "framework", slug: "mastra" },
  },
  {
    id: "langgraph-python",
    name: "LangGraph (Python)",
    logo: { kind: "framework", slug: "langgraph-python" },
  },
];

function renderWizard() {
  return render(
    <SetupWizard
      frontends={FRONTENDS}
      capabilities={CAPABILITIES}
      backends={BACKENDS}
    />,
  );
}

/** `CapabilityGrid`'s accessible name is title-followed-by-body (see
 *  `docs-map-parts.tsx`), so an exact-string query would no longer match
 *  once a body is attached. Anchor on the title instead. */
function capabilityButton(title: string) {
  return screen.getByRole("button", {
    name: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
  });
}

/** `ChoiceGrid`'s accessible name is label-followed-by-description (the same
 *  shape `PickGrid`'s `size="card"` and `CapabilityGrid` use), so the
 *  project step's Yes/No buttons need the same prefix-anchored query as
 *  `capabilityButton` above rather than an exact-string match. */
function projectButton(label: "Yes" | "No") {
  return screen.getByRole("button", { name: new RegExp(`^${label}`) });
}

/** Install a resolving clipboard stub and hand back its spy. */
function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  return writeText;
}

/** Drive the wizard from step 1 all the way to step 5 (project -> Continue
 *  -> frontend -> Continue -> backend -> Continue -> features ->
 *  Skip/Continue), the step order. Returns the clipboard spy so the caller
 *  can inspect what was copied. */
function advanceToStep5({
  project = "Yes",
  frontend = "React",
  backend = "Mastra",
  feature,
}: {
  project?: "Yes" | "No";
  frontend?: string;
  backend?: string;
  feature?: string;
} = {}) {
  const writeText = stubClipboard();
  renderWizard();

  fireEvent.click(projectButton(project));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: frontend }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: backend }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  if (feature) fireEvent.click(capabilityButton(feature));
  fireEvent.click(
    screen.getByRole("button", { name: feature ? "Continue" : "Skip" }),
  );

  return writeText;
}

/** The run id the component reported for the copy it just made. */
function reportedRunId(callIndex = 0): string {
  const [, properties] = analytics.capture.mock.calls[callIndex] as [
    string,
    Record<string, unknown>,
  ];
  return properties.onboarding_run_id as string;
}

beforeEach(() => {
  window.history.pushState({}, "", "/");
  capturedOnJump = null;
  capturedOnBack = null;
  // jsdom has no WAAPI at all — `Element.prototype.animate` doesn't exist,
  // so every call the component makes would throw without this stub. The
  // component's own transition logic (`wizard-step-transition.ts`) has its
  // own dedicated unit tests; here we only need calls into `animate` not to
  // blow up.
  //
  // Deliberately inert: `onfinish` is never invoked and `.finished` never
  // resolves. A previous version of the component relied on `onfinish` to
  // remove a cloned outgoing card from the DOM, but `onfinish` does not fire
  // while the tab is hidden (the animation never progresses) or for a
  // cancelled/replaced animation — that gap is exactly what leaked clones
  // into the wrapper in production, and a stub that fires `onfinish`
  // synchronously would hide the bug instead of reproducing it. The
  // regression tests below must pass against this inert stub.
  animateSpy = vi.fn().mockReturnValue({
    onfinish: null,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Element.prototype as any).animate = animateSpy;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (Element.prototype as any).animate;
});

describe("initial render", () => {
  it("shows only step 1's card, the project question", () => {
    renderWizard();

    expect(
      screen.getByRole("heading", { name: "Do you already have a project?" }),
    ).not.toBeNull();
    expect(projectButton("Yes")).not.toBeNull();
    expect(projectButton("No")).not.toBeNull();

    // Every other step's option list doesn't exist in the DOM at all —
    // this is a single-card-at-a-time stepper, not a scrolling page with
    // locked-but-present sections.
    expect(screen.queryByRole("button", { name: "React" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Mastra" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Chat surface/ })).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "Ready to set up" }),
    ).toBeNull();
  });

  it("shows five items on the rail and the Step 1 of 5 kicker", () => {
    renderWizard();

    expect(screen.getByText("Step 1 of 5")).not.toBeNull();
    expect(screen.getByRole("button", { name: /Project/ })).not.toBeNull();
    expect(screen.getByRole("button", { name: /Frontend/ })).not.toBeNull();
    expect(screen.getByRole("button", { name: /Backend/ })).not.toBeNull();
    expect(screen.getByRole("button", { name: /Features/ })).not.toBeNull();
    expect(screen.getByRole("button", { name: /Prompt/ })).not.toBeNull();
  });
});

// Continue used to carry the real `disabled` attribute until an answer was
// given. It no longer does — the button is always enabled (see
// `wizard-stepper-parts.tsx`'s header comment) — so a click with nothing
// selected must now be caught here instead: it does not advance, shows an
// inline hint, and moves focus into the option list so a keyboard user
// lands where the work is. These are the behaviours the old "disables
// Continue" test protected, expressed the new way.
describe("step 1: project question", () => {
  it("does not advance and shows a hint when Continue is clicked with nothing selected", () => {
    renderWizard();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      screen.getByRole("heading", { name: "Do you already have a project?" }),
    ).not.toBeNull();
    // The hint must actually reach assistive technology, not just be
    // visible text — asserted here via the live region it renders in.
    const hintRow = document.querySelector('[aria-live="polite"]');
    expect(hintRow?.textContent).toBe("Answer this question first");
  });

  it("moves focus into the project option list when the click is blocked", () => {
    renderWizard();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(document.activeElement).toBe(projectButton("Yes"));
  });

  it("clears the hint once answered, and the next click advances, with Back returning with the answer intact", () => {
    renderWizard();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Answer this question first")).not.toBeNull();

    fireEvent.click(projectButton("Yes"));
    expect(screen.queryByText("Answer this question first")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      screen.getByRole("heading", { name: "Your frontend" }),
    ).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(
      screen.getByRole("heading", { name: "Do you already have a project?" }),
    ).not.toBeNull();
    expect(projectButton("Yes").getAttribute("aria-pressed")).toBe("true");
  });
});

// Same shape as step 1's block above, for step 2's own required choice and
// wording.
describe("step 2: frontend", () => {
  it("does not advance and shows a hint when Continue is clicked with nothing selected", () => {
    renderWizard();
    fireEvent.click(projectButton("Yes"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      screen.getByRole("heading", { name: "Your frontend" }),
    ).not.toBeNull();
    const hintRow = document.querySelector('[aria-live="polite"]');
    expect(hintRow?.textContent).toBe("Choose your frontend first");
  });

  it("moves focus into the frontend option list when the click is blocked", () => {
    renderWizard();
    fireEvent.click(projectButton("Yes"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "React" }),
    );
  });

  it("clears the hint once a frontend is picked, and the next click advances", () => {
    renderWizard();
    fireEvent.click(projectButton("Yes"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Choose your frontend first")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "React" }));
    expect(screen.queryByText("Choose your frontend first")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      screen.getByRole("heading", { name: "Your agent backend" }),
    ).not.toBeNull();
  });
});

// Same shape again, for step 3's agent backend choice.
describe("step 3: agent backend", () => {
  it("does not advance and shows a hint when Continue is clicked with nothing selected", () => {
    renderWizard();
    fireEvent.click(projectButton("Yes"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "React" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      screen.getByRole("heading", { name: "Your agent backend" }),
    ).not.toBeNull();
    const hintRow = document.querySelector('[aria-live="polite"]');
    expect(hintRow?.textContent).toBe("Choose your agent backend first");
  });

  it("moves focus into the backend option list when the click is blocked", () => {
    renderWizard();
    fireEvent.click(projectButton("Yes"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "React" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Mastra" }),
    );
  });

  it("clears the hint once a backend is picked, and the next click advances", () => {
    renderWizard();
    fireEvent.click(projectButton("Yes"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "React" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Choose your agent backend first")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Mastra" }));
    expect(screen.queryByText("Choose your agent backend first")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      screen.getByRole("heading", { name: "What you want to build" }),
    ).not.toBeNull();
  });
});

describe("Continue is never disabled", () => {
  // One guard across all five steps, including the three with a required
  // choice still unmet — there is no `continueDisabled` prop left to drive
  // the `disabled` attribute, so nothing here should ever set it.
  it("never renders the primary button with the disabled attribute, on any step", () => {
    renderWizard();

    expect(
      (
        screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement
      ).hasAttribute("disabled"),
    ).toBe(false);

    fireEvent.click(projectButton("Yes"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      (
        screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement
      ).hasAttribute("disabled"),
    ).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "React" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      (
        screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement
      ).hasAttribute("disabled"),
    ).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Mastra" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      (
        screen.getByRole("button", { name: "Skip" }) as HTMLButtonElement
      ).hasAttribute("disabled"),
    ).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(
      (
        screen.getByRole("button", {
          name: "Copy prompt",
        }) as HTMLButtonElement
      ).hasAttribute("disabled"),
    ).toBe(false);
  });
});

// The card has a fixed floor with the footer pinned to its bottom edge, and
// the hint must not move it. `WizardNav` reserves the hint's row
// unconditionally (see its own tests), so the way to prove that here is not
// a pixel measurement — jsdom reports every box as zero-sized, which would
// make a geometry assertion vacuous — but that the row's DOM node is the
// same node before and after the hint appears, i.e. it was never
// conditionally mounted.
describe("hint row does not move the footer", () => {
  it("keeps the same hint row node before and after a blocked click shows the hint", () => {
    renderWizard();

    const hintRowBefore = document.querySelector('[aria-live="polite"]');
    expect(hintRowBefore).not.toBeNull();
    expect(hintRowBefore!.textContent).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    const hintRowAfter = document.querySelector('[aria-live="polite"]');
    expect(hintRowAfter).toBe(hintRowBefore);
    expect(hintRowAfter!.textContent).toBe("Answer this question first");
  });
});

describe("navigation", () => {
  it("Continue advances to the agent backend step, and Back returns with the frontend kept", () => {
    renderWizard();

    fireEvent.click(projectButton("Yes"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "React" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      screen.getByRole("heading", { name: "Your agent backend" }),
    ).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(
      screen.getByRole("heading", { name: "Your frontend" }),
    ).not.toBeNull();
    expect(
      screen
        .getByRole("button", { name: "React" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("reads Skip with nothing selected and Continue once a feature is toggled, and both advance", () => {
    renderWizard();
    fireEvent.click(projectButton("Yes"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "React" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Mastra" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      screen.getByRole("heading", { name: "What you want to build" }),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "Skip" })).not.toBeNull();

    fireEvent.click(capabilityButton("Chat surface"));

    expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
    expect(screen.getByRole("button", { name: "Continue" })).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      screen.getByRole("heading", { name: "Ready to set up" }),
    ).not.toBeNull();
  });

  it("Skip also advances, with no features selected", () => {
    renderWizard();
    fireEvent.click(projectButton("Yes"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "React" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Mastra" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));

    expect(
      screen.getByRole("heading", { name: "Ready to set up" }),
    ).not.toBeNull();
  });
});

describe("changing an earlier answer", () => {
  it("keeps the backend and the features when the frontend changes", () => {
    renderWizard();

    fireEvent.click(projectButton("Yes"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "React" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Mastra" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(capabilityButton("Chat surface"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      screen.getByRole("heading", { name: "Ready to set up" }),
    ).not.toBeNull();

    // Jump back to step 2 via the progress rail and pick a different
    // frontend.
    fireEvent.click(screen.getByRole("button", { name: /Frontend/ }));
    expect(
      screen.getByRole("heading", { name: "Your frontend" }),
    ).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Vue" }));
    expect(
      screen.getByRole("button", { name: "Vue" }).getAttribute("aria-pressed"),
    ).toBe("true");

    // The later answers must have survived the earlier change — assert
    // both explicitly by visiting their steps again.
    fireEvent.click(screen.getByRole("button", { name: /Backend/ }));
    expect(
      screen
        .getByRole("button", { name: "Mastra" })
        .getAttribute("aria-pressed"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: /Features/ }));
    expect(capabilityButton("Chat surface").getAttribute("aria-pressed")).toBe(
      "true",
    );
  });
});

describe("progress rail", () => {
  it("jumps back to a reached step, and disables buttons for steps beyond furthest", () => {
    renderWizard();
    fireEvent.click(projectButton("Yes"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "React" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    const promptRailButton = screen.getByRole("button", {
      name: /Prompt/,
    }) as HTMLButtonElement;
    expect(promptRailButton.disabled).toBe(true);

    const projectRailButton = screen.getByRole("button", {
      name: /Project/,
    }) as HTMLButtonElement;
    expect(projectRailButton.disabled).toBe(false);

    fireEvent.click(projectRailButton);
    expect(
      screen.getByRole("heading", { name: "Do you already have a project?" }),
    ).not.toBeNull();
  });

  it("refuses to jump past furthest even when asked to directly", () => {
    renderWizard();
    fireEvent.click(projectButton("Yes"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "React" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" })); // furthest = 3, current = 3

    expect(capturedOnJump).not.toBeNull();
    // Call the wizard's own `onJump` handler directly with a step past
    // `furthest` — the same call an enabled rail button would make, but
    // without going through the rail's `disabled` attribute at all. This is
    // the only way to exercise `handleJump`'s own guard, since React never
    // dispatches a click to a button it rendered as disabled in the first
    // place (see the mock above). Wrapped in `act` since this bypasses
    // `fireEvent`'s own act-wrapping — without it, the state update this
    // triggers would not have flushed yet by the time the assertions below
    // run, making them pass regardless of whether the guard exists.
    act(() => {
      capturedOnJump?.(5, false);
    });

    expect(
      screen.getByRole("heading", { name: "Your agent backend" }),
    ).not.toBeNull();
    expect(
      screen.queryByRole("heading", { name: "Ready to set up" }),
    ).toBeNull();
  });
});

describe("step 5: copy your prompt", () => {
  it("shows the copy button and the Set up manually link, and renders neither the prompt text nor a reset control", () => {
    advanceToStep5({ frontend: "React", backend: "Mastra" });

    expect(screen.getByRole("button", { name: "Copy prompt" })).not.toBeNull();
    const guideLink = screen.getByRole("link", { name: "Set up manually" });
    expect(guideLink.getAttribute("href")).toBe("/quickstart");
    expect(screen.queryByText(/--coding-agent/)).toBeNull();
    expect(screen.queryByRole("button", { name: /reset/i })).toBeNull();
  });

  it("writes the canonical CLI invocation plus the framework and frontend sentences", async () => {
    const writeText = advanceToStep5({ frontend: "React", backend: "Mastra" });

    fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));

    await waitFor(() => expect(analytics.capture).toHaveBeenCalled());

    const expected = composeWizardOnboardingPrompt(reportedRunId(), {
      frontend: { id: "react", name: "React" },
      backend: { id: "mastra", name: "Mastra" },
      featureTitles: [],
      project: "yes",
    });

    expect(expected).toContain("--coding-agent <coding-agent-slug>");
    expect(writeText).toHaveBeenCalledExactlyOnceWith(expected);
  });

  it("produces the identical string on a second copy in the same page view", async () => {
    const writeText = advanceToStep5();

    fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Copied" })).not.toBeNull(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Copied" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));

    expect(writeText.mock.calls[0][0]).toBe(writeText.mock.calls[1][0]);
  });

  it("shows the error state and reports no success when the clipboard write rejects", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.assign(navigator, { clipboard: { writeText } });
    renderWizard();

    fireEvent.click(projectButton("Yes"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "React" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Mastra" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Copy blocked" }),
      ).not.toBeNull(),
    );
    expect(analytics.capture).not.toHaveBeenCalled();
  });

  it("renders a Back button, and returns to the features step when clicked", () => {
    advanceToStep5({ frontend: "React", backend: "Mastra" });

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(
      screen.getByRole("heading", { name: "What you want to build" }),
    ).not.toBeNull();
  });

  // The copy button lives back in the footer's primary slot, exactly where
  // Continue sits on every other step — an earlier version centred it in
  // the card body instead, which the reader asked to have undone. This used
  // to be anchored on the shared container being the *same immediate
  // parent* as Back, but Copy is now grouped with "Set up manually" into
  // its own right-aligned pair (see the grouping test below), so it no
  // longer shares Back's immediate parent — a wrapper sits between them.
  // What this actually protects is that Copy still lives in the footer and
  // not back in the card body, so assert containment in the footer
  // container itself (`data-testid="wizard-footer"` on `WizardCard`'s
  // footer wrapper) rather than against a specific parent node.
  it("keeps the copy button in the footer, alongside Back", () => {
    advanceToStep5({ frontend: "React", backend: "Mastra" });

    const backButton = screen.getByRole("button", { name: "Back" });
    const copyButton = screen.getByRole("button", { name: "Copy prompt" });
    const footer = screen.getByTestId("wizard-footer");

    expect(footer.contains(backButton)).toBe(true);
    expect(footer.contains(copyButton)).toBe(true);
  });

  // Renamed from "Follow this guide" per the reviewer's request, and moved:
  // the footer row is `justify-between` with Back at one edge and (before
  // this change) three more independently-spaced items drifting across it,
  // which stranded this action midway between the hint and Copy prompt. It
  // now groups with Copy prompt as a single right-aligned pair (see
  // `wizard-stepper-parts.tsx`'s `secondaryAction` handling) — asserting
  // they share a parent, and that Back does not share it, is what would
  // catch a regression back to all three being independently spaced.
  it("shows a Set up manually action pointing at /quickstart, grouped with Copy prompt and not with Back", () => {
    advanceToStep5({ frontend: "React", backend: "Mastra" });

    const guideLink = screen.getByRole("link", { name: "Set up manually" });
    expect(guideLink.getAttribute("href")).toBe("/quickstart");

    const copyButton = screen.getByRole("button", { name: "Copy prompt" });
    const backButton = screen.getByRole("button", { name: "Back" });

    // `guideLink` sits one level deeper than `copyButton` — `WizardNav`
    // wraps `secondaryAction` in a span to carry its own mobile ordering
    // class (see that file), so `closest("div")` is what actually reaches
    // their shared grouping container, not `parentElement`.
    const sharedGroup = guideLink.closest("div");
    expect(sharedGroup).toBe(copyButton.parentElement);
    expect(sharedGroup).not.toBe(backButton.parentElement);
  });

  it("returns to Copy prompt after the reset delay following a successful copy", async () => {
    vi.useFakeTimers();
    try {
      const writeText = stubClipboard();
      renderWizard();

      fireEvent.click(projectButton("Yes"));
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      fireEvent.click(screen.getByRole("button", { name: "React" }));
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      fireEvent.click(screen.getByRole("button", { name: "Mastra" }));
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      fireEvent.click(screen.getByRole("button", { name: "Skip" }));

      fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
      // Flush the resolved clipboard promise before the "Copied" state
      // lands — `advanceTimersByTimeAsync` yields the event loop between
      // ticks, so this also drains that microtask.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("button", { name: "Copied" })).not.toBeNull();

      // The component's own reset delay after a successful copy is 1800ms.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1800);
      });
      expect(
        screen.getByRole("button", { name: "Copy prompt" }),
      ).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not change the copy button's width class when its label changes", async () => {
    vi.useFakeTimers();
    try {
      stubClipboard();
      renderWizard();

      fireEvent.click(projectButton("Yes"));
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      fireEvent.click(screen.getByRole("button", { name: "React" }));
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      fireEvent.click(screen.getByRole("button", { name: "Mastra" }));
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      fireEvent.click(screen.getByRole("button", { name: "Skip" }));

      const idleMinWidth = screen
        .getByRole("button", { name: "Copy prompt" })
        .className.match(/\bmin-w-\S+/)?.[0];
      expect(idleMinWidth).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      const copiedMinWidth = screen
        .getByRole("button", { name: "Copied" })
        .className.match(/\bmin-w-\S+/)?.[0];

      expect(copiedMinWidth).toBe(idleMinWidth);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("step 5: review list", () => {
  it("lists all four selections with their values", () => {
    advanceToStep5({
      project: "Yes",
      frontend: "Vue",
      backend: "Mastra",
      feature: "Chat surface",
    });

    // The review reads "Existing" for a yes answer, not the step's own
    // "Yes" — see the "step 1 vs. review wording" test below for the other
    // half of that guard.
    expect(screen.getByText("Existing")).not.toBeNull();
    expect(screen.getByText("Vue")).not.toBeNull();
    expect(screen.getByText("Mastra")).not.toBeNull();
    expect(screen.getByText("Chat surface")).not.toBeNull();
  });

  // The step itself keeps asking Yes/No; only the review rewords the answer
  // to Existing/New. Assert both halves in one flow so a change that renames
  // one place and not the other fails here rather than in two disconnected
  // tests that could each be updated independently. One of the five
  // mutation-checked guards: showing "No" instead of "New" in the review
  // must make this fail.
  it("step 1 vs. review wording: the step still says Yes/No, the review says Existing/New", () => {
    renderWizard();

    expect(projectButton("Yes")).not.toBeNull();
    expect(projectButton("No")).not.toBeNull();

    fireEvent.click(projectButton("No"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "React" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Mastra" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));

    expect(screen.getByText("New")).not.toBeNull();
    expect(screen.queryByText("No")).toBeNull();
  });

  // Features is the one optional step — skipping it must still leave a row
  // that reads clearly and still offers a way back to step 4, not a row
  // that silently disappears. Mutation (d): rendering nothing instead of
  // "None" leaves this `getByText("None")` with nothing to find.
  it("shows a muted None for features and still offers Change when none were chosen", () => {
    advanceToStep5({ frontend: "React", backend: "Mastra" });

    expect(screen.getByText("None")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Change features" }),
    ).not.toBeNull();
  });

  // Four separate assertions, one per button, each starting a fresh trip to
  // step 5 — asserting only the first `Change` button's destination would
  // pass even if the others were mutated to also point at step 1 (mutation
  // (d) below). Querying by the full `aria-label` also means a mutation
  // that gives every button the same accessible name makes `getByRole`
  // throw here for whichever name stops being unique.
  it("Change project returns to step 1", () => {
    advanceToStep5({
      frontend: "Vue",
      backend: "Mastra",
      feature: "Chat surface",
    });

    fireEvent.click(screen.getByRole("button", { name: "Change project" }));

    expect(
      screen.getByRole("heading", { name: "Do you already have a project?" }),
    ).not.toBeNull();
  });

  it("Change frontend returns to step 2, animating as a backward step", () => {
    advanceToStep5({
      frontend: "Vue",
      backend: "Mastra",
      feature: "Chat surface",
    });

    fireEvent.click(screen.getByRole("button", { name: "Change frontend" }));

    expect(
      screen.getByRole("heading", { name: "Your frontend" }),
    ).not.toBeNull();
  });

  it("Change agent backend returns to step 3", () => {
    advanceToStep5({
      frontend: "Vue",
      backend: "Mastra",
      feature: "Chat surface",
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Change agent backend" }),
    );

    expect(
      screen.getByRole("heading", { name: "Your agent backend" }),
    ).not.toBeNull();
  });

  it("Change features returns to step 4", () => {
    advanceToStep5({
      frontend: "Vue",
      backend: "Mastra",
      feature: "Chat surface",
    });

    fireEvent.click(screen.getByRole("button", { name: "Change features" }));

    expect(
      screen.getByRole("heading", { name: "What you want to build" }),
    ).not.toBeNull();
  });

  it("shows the updated value after changing a selection and returning to step 5", () => {
    advanceToStep5({ frontend: "React", backend: "Mastra" });

    fireEvent.click(screen.getByRole("button", { name: "Change frontend" }));
    fireEvent.click(screen.getByRole("button", { name: "Vue" }));

    // Furthest is already 5, so the progress rail can jump straight back
    // without walking Continue through steps 3 and 4 again.
    fireEvent.click(screen.getByRole("button", { name: /Prompt/ }));

    expect(
      screen.getByRole("heading", { name: "Ready to set up" }),
    ).not.toBeNull();
    expect(screen.getByText("Vue")).not.toBeNull();
    expect(screen.queryByText("React")).toBeNull();
  });
});

// Asserted on a couple of stable words rather than the whole sentence, so a
// later wording tweak does not fail this for nothing — the requirement is
// that the description covers both points (what follows are the reader's
// answers, and what is left to do), not its exact phrasing.
describe("step 5: description", () => {
  it("mentions both the answers below it and copying the prompt", () => {
    advanceToStep5({ frontend: "React", backend: "Mastra" });

    expect(screen.getByText(/chose/i)).not.toBeNull();
    expect(screen.getByText(/copy the prompt/i)).not.toBeNull();
  });
});

// Step 2's frontends fill the card as larger tiles with their summary line
// (`size="card"`); step 3's nineteen backends stay a dense, compact list.
// Asserted through rendered output, not through a prop spy on `PickGrid`.
//
// Uses its own fixture, carrying `summary` on both a frontend and a
// backend, rather than the shared `FRONTENDS`/`BACKENDS` above: `size="card"`
// folds the summary into the option button's accessible name (name plus
// summary, the same shape as `CapabilityGrid`'s title-plus-body), which
// would break every exact-name `getByRole("button", { name: "React" })`
// query the rest of this file relies on. Giving the backend a `summary` too
// is what makes "no summary text on step 3" meaningful rather than vacuous
// — the data is there, and compact size is what keeps it off the screen.
describe("PickGrid size per step", () => {
  const SUMMARY_FRONTENDS: readonly MapPick[] = [
    {
      id: "react",
      name: "SummaryFrontend",
      logo: { kind: "frontend", icon: "react" },
      summary: "The frontend summary line.",
    },
  ];
  const SUMMARY_BACKENDS: readonly MapPick[] = [
    {
      id: "mastra",
      name: "SummaryBackend",
      logo: { kind: "framework", slug: "mastra" },
      summary: "The backend summary line.",
    },
  ];

  it("shows frontend summaries on step 2 and omits backend summaries on step 3", () => {
    render(
      <SetupWizard
        frontends={SUMMARY_FRONTENDS}
        capabilities={CAPABILITIES}
        backends={SUMMARY_BACKENDS}
      />,
    );

    fireEvent.click(projectButton("Yes"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByText("The frontend summary line.")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^SummaryFrontend/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      screen.getByRole("heading", { name: "Your agent backend" }),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "SummaryBackend" }),
    ).not.toBeNull();
    expect(screen.queryByText("The backend summary line.")).toBeNull();
  });
});

describe("URL state", () => {
  it("restores all four selections and lands on step 5 when project, frontend, features and backend are all present", () => {
    window.history.pushState(
      {},
      "",
      "/?project=yes&frontend=react&features=chat,gen-ui&backend=mastra",
    );

    renderWizard();

    expect(
      screen.getByRole("heading", { name: "Ready to set up" }),
    ).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Project/ }));
    expect(projectButton("Yes").getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: /Frontend/ }));
    expect(
      screen
        .getByRole("button", { name: "React" })
        .getAttribute("aria-pressed"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: /Backend/ }));
    expect(
      screen
        .getByRole("button", { name: "Mastra" })
        .getAttribute("aria-pressed"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: /Features/ }));
    expect(capabilityButton("Chat surface").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(capabilityButton("Generative UI").getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("lands on step 3 when project and frontend are present but backend is not", () => {
    window.history.pushState({}, "", "/?project=yes&frontend=react");

    renderWizard();

    expect(
      screen.getByRole("heading", { name: "Your agent backend" }),
    ).not.toBeNull();
  });

  it("restoring an unknown project value degrades to unanswered rather than throwing", () => {
    window.history.pushState({}, "", "/?project=maybe&frontend=react");

    expect(() => renderWizard()).not.toThrow();

    // An unrecognized `project` is dropped, same as any other value outside
    // the allow-list, so `landingStep` treats it as unanswered and lands
    // back on step 1 regardless of what else was restored.
    expect(
      screen.getByRole("heading", { name: "Do you already have a project?" }),
    ).not.toBeNull();
  });

  // Regression coverage for the `furthest` bug: `landingStep` stops at the
  // first *unanswered* step (backend, here), so it correctly lands on step
  // 3 — but the old code also set `furthest` to that same landing step,
  // which disabled step 4 on the rail even though its answer (`features`)
  // is already sitting in state. Both halves are asserted since the landing
  // alone was already correct before this fix; only the rail's disabled
  // treatment was wrong.
  it("restoring project, frontend and features with no backend lands on step 3 and leaves the rail's step 4 enabled", () => {
    window.history.pushState(
      {},
      "",
      "/?project=yes&frontend=vue&features=gen-ui",
    );

    renderWizard();

    expect(
      screen.getByRole("heading", { name: "Your agent backend" }),
    ).not.toBeNull();

    const featuresRailButton = screen.getByRole("button", {
      name: /Features/,
    }) as HTMLButtonElement;
    expect(featuresRailButton.disabled).toBe(false);
  });

  // The fix must credit only the steps that actually have an answer, not
  // enable the whole rail — this is what catches a mutation that simply
  // sets `furthest` to the last step regardless of what was restored.
  it("restoring only project and frontend still leaves steps 4 and 5 disabled on the rail", () => {
    window.history.pushState({}, "", "/?project=yes&frontend=react");

    renderWizard();

    const featuresRailButton = screen.getByRole("button", {
      name: /Features/,
    }) as HTMLButtonElement;
    const promptRailButton = screen.getByRole("button", {
      name: /Prompt/,
    }) as HTMLButtonElement;
    expect(featuresRailButton.disabled).toBe(true);
    expect(promptRailButton.disabled).toBe(true);
  });

  it("writes with replaceState, never pushState, on a selection", () => {
    renderWizard();

    const replaceSpy = vi.spyOn(window.history, "replaceState");
    const pushSpy = vi.spyOn(window.history, "pushState");

    fireEvent.click(projectButton("Yes"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "React" }));

    expect(replaceSpy).toHaveBeenCalled();
    const [, , url] = replaceSpy.mock.calls.at(-1) as [unknown, string, string];
    expect(url).toContain("frontend=react");
    expect(pushSpy).not.toHaveBeenCalled();
  });

  // Pins the *timing* of the restore, not just its outcome (already covered
  // above): the restore must land before the browser paints, not after, or
  // a reader reloading with a query string briefly sees step 1 before the
  // jump to the restored step. `render` from `@testing-library/react`
  // flushes both layout *and* passive effects before returning, which
  // cannot tell those two timings apart — so this drives React directly
  // with `flushSync` instead. `flushSync` forces the synchronous commit
  // (layout effects included) to finish before it returns, but it does not
  // wait for passive effects: those are scheduled through React's own
  // scheduler and only run on a later microtask/macrotask that `flushSync`
  // never yields to. So the instant `flushSync` returns: a restore running
  // in a layout effect has already landed in `container`; a restore still
  // sitting in a passive effect (the pre-fix code) has not run yet, and the
  // DOM would still show step 1.
  it("restores the URL selection synchronously before paint, not in a later passive-effect flush", () => {
    window.history.pushState({}, "", "/?project=yes&frontend=react");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      flushSync(() => {
        root.render(
          <SetupWizard
            frontends={FRONTENDS}
            capabilities={CAPABILITIES}
            backends={BACKENDS}
          />,
        );
      });

      // Restored (project and frontend answered, backend missing) lands on
      // step 3 — see the "lands on step 3" test above for the same URL. If
      // the restore were still a passive effect, this would still read
      // "Do you already have a project?" (step 1) at this point instead.
      const heading = container.querySelector("h2");
      expect(heading?.textContent).toBe("Your agent backend");
    } finally {
      // `unmount` can itself trigger effect cleanup / state updates, so it
      // needs `act` even though the render above deliberately did not use
      // it — this is only teardown, not the behaviour under test.
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });
});

describe("focus management", () => {
  it("does not move focus on the first render", () => {
    renderWizard();

    expect(document.activeElement).not.toBe(
      screen.getByRole("heading", {
        name: "Do you already have a project?",
      }),
    );
  });

  it("moves focus to the card's heading on every step change", () => {
    renderWizard();

    fireEvent.click(projectButton("Yes"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "Your frontend" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "React" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "Your agent backend" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "Your frontend" }),
    );
  });
});

// The heading's focus ring is rendered via an explicit `focus:ring-2` class
// (see `wizard-stepper-parts.tsx`'s `HEADING_FOCUS_RING_CLASS`), toggled on
// by `showFocusRing` rather than left to the browser's own pointer/keyboard
// heuristic. `fireEvent.click`'s default `detail` is `0` — the same value a
// real keyboard-triggered click (Enter/Space) reports — so the keyboard
// case is exercised by every plain `fireEvent.click` used elsewhere in this
// file; the pointer case needs an explicit non-zero `detail` to be
// distinguishable, per this file's own instructions.
describe("heading focus ring depends on activation modality", () => {
  it("focuses the heading without the ring after a pointer-driven advance", () => {
    renderWizard();

    fireEvent.click(projectButton("Yes"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "React" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }), {
      detail: 1,
    });

    const heading = screen.getByRole("heading", {
      name: "Your agent backend",
    });
    expect(document.activeElement).toBe(heading);
    expect(heading.className).not.toMatch(/\bfocus:ring-2\b/);
  });

  it("focuses the heading with the ring after a keyboard-driven advance", () => {
    renderWizard();

    fireEvent.click(projectButton("Yes"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "React" }));
    // No `detail` override: fireEvent.click's default of 0 is the keyboard
    // branch (see the header comment above).
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    const heading = screen.getByRole("heading", {
      name: "Your agent backend",
    });
    expect(document.activeElement).toBe(heading);
    expect(heading.className).toMatch(/\bfocus:ring-2\b/);
  });
});

// Regression coverage for `currentRef`/`furthestRef` in `setup-wizard.tsx`:
// `handleBack` and `handleJump` must read the live step numbers, not the
// values closed over in the render that created the handler. Exercised by
// snapshotting a handler through the mocked `WizardNav`/`WizardProgress`
// (see `capturedOnBack`/`capturedOnJump` above) at an earlier point in the
// wizard's life, advancing further, and then invoking that stale reference —
// exactly the shape a reader clicking rapidly during the 240ms step-swap
// transition could trigger for real.
describe("stale handlers act on the live step, not the step captured when they were created", () => {
  it("a handleBack captured on step 3 still returns to the step before the current one after advancing further", () => {
    renderWizard();

    fireEvent.click(projectButton("Yes"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" })); // current = 2
    fireEvent.click(screen.getByRole("button", { name: "React" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" })); // current = 3

    // Snapshot Back's handler while `current` is still 3, before advancing
    // any further.
    const staleOnBack = capturedOnBack;
    expect(staleOnBack).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Mastra" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" })); // current = 4

    // A handler reading `current` from its own closure (captured at 3)
    // would compute 3 - 1 = 2 and land on step 2. Reading the live
    // `currentRef` instead computes 4 - 1 = 3 and lands back on step 3.
    act(() => {
      staleOnBack?.(false);
    });

    expect(
      screen.getByRole("heading", { name: "Your agent backend" }),
    ).not.toBeNull();
  });

  it("a handleJump captured while furthest was 2 still allows a jump to step 4 once furthest has advanced past it", () => {
    renderWizard();

    fireEvent.click(projectButton("Yes"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" })); // current = 2, furthest = 2

    // Snapshot the rail's jump handler while `furthest` is still 2.
    const staleOnJump = capturedOnJump;
    expect(staleOnJump).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "React" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" })); // current = 3, furthest = 3
    fireEvent.click(screen.getByRole("button", { name: "Mastra" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" })); // current = 4, furthest = 4
    fireEvent.click(screen.getByRole("button", { name: "Skip" })); // current = 5, furthest = 5

    // A handler reading `furthest` from its own closure (captured at 2)
    // would refuse step 4 (4 > 2) and leave the reader on step 5. Reading
    // the live `furthestRef` instead sees furthest = 5 and allows it.
    act(() => {
      staleOnJump?.(4, false);
    });

    expect(
      screen.getByRole("heading", { name: "What you want to build" }),
    ).not.toBeNull();
  });
});

/** The card wrapper (`div.relative`, holding `wrapperRef`) inside a render's
 *  `container`. No other element in this tree uses the `relative` class. */
function wrapperEl(container: HTMLElement): HTMLElement {
  const el = container.querySelector(".relative");
  if (!el) throw new Error("wizard wrapper not found");
  return el as HTMLElement;
}

/**
 * Regression coverage for the leaked-clone bug: an earlier version of the
 * transition cloned the outgoing card into the wrapper, positioned it
 * absolutely, and relied on the clone's own `onfinish` to remove it again.
 * Because the `Element.prototype.animate` stub above is deliberately inert
 * (see the comment on it), `onfinish` never fires here — exactly the
 * hidden-tab case that let clones pile up in production. These assertions
 * hold against that inert stub precisely because the fix renders only the
 * current card and never appends anything to the wrapper in the first
 * place; they would fail immediately against the old clone-and-append code.
 */
describe("step transition cleanup", () => {
  it("leaves exactly one card in the wrapper, and one step heading in the document, after advancing forward", () => {
    const { container } = renderWizard();

    fireEvent.click(projectButton("Yes"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(wrapperEl(container).querySelectorAll("section")).toHaveLength(1);
    expect(screen.getAllByRole("heading")).toHaveLength(1);
  });

  it("still leaves exactly one card after three transitions (forward, forward, back) — the defect compounded rather than showing after one", () => {
    const { container } = renderWizard();

    fireEvent.click(projectButton("Yes"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" })); // transition 1: forward, step 1 -> 2
    fireEvent.click(screen.getByRole("button", { name: "React" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" })); // transition 2: forward, step 2 -> 3
    fireEvent.click(screen.getByRole("button", { name: "Back" })); // transition 3: back, step 3 -> 2

    expect(wrapperEl(container).querySelectorAll("section")).toHaveLength(1);
    expect(screen.getAllByRole("heading")).toHaveLength(1);
  });

  it("leaves no aria-hidden sibling and no inline position:absolute directly in the wrapper after a transition", () => {
    // Scoped to the wrapper's *direct children*, not every descendant: the
    // card itself legitimately contains decorative `aria-hidden="true"`
    // icons several levels down (see `PickLogo` in `docs-map-parts.tsx`),
    // and that is correct, unrelated markup. The leaked clones this guards
    // against were always direct children of the wrapper — siblings of the
    // real `<section>` card, as shown in the bug report:
    //   wrapper
    //     SECTION                                 <- the real card
    //     DIV[aria-hidden] style="position: absolute; ..."  <- leaked clone
    const { container } = renderWizard();

    fireEvent.click(projectButton("Yes"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    const wrapper = wrapperEl(container);
    Array.from(wrapper.children).forEach((child) => {
      expect(child.getAttribute("aria-hidden")).not.toBe("true");
      expect((child as HTMLElement).style.position).not.toBe("absolute");
    });
  });

  it("leaves no inline height on the wrapper after a transition", () => {
    const { container } = renderWizard();

    fireEvent.click(projectButton("Yes"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(wrapperEl(container).style.height).toBe("");
  });

  it("never calls animate() with fill: 'forwards', including the wrapper's own height animation", () => {
    // `fill: "forwards"` is what would pin the wrapper's height (or the
    // incoming card's transform) at its end value once the animation
    // stops — safe only if something releases that pin afterwards. The
    // component releases nothing on purpose (see `runStepSwapAnimation`'s
    // header comment), so this has to hold for every `animate()` call, not
    // just the height one. The mocked WAAPI has no observable effect on the
    // DOM by itself, so this must be asserted against the call arguments
    // directly rather than against the wrapper's resulting style.
    //
    // jsdom's `getBoundingClientRect` always reports 0, and a from/to height
    // of 0/0 is treated as "nothing to animate" (see `planStepSwap`'s
    // wrapper-height guard), which would skip the height animation
    // entirely and leave this test blind to a regression there. Stubbed
    // here so `fromHeight` and `toHeight` differ, forcing that branch to
    // actually run.
    let call = 0;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () => ({ height: (call += 1) === 1 ? 220 : 480 }) as DOMRect,
    );

    renderWizard();

    fireEvent.click(projectButton("Yes"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(animateSpy.mock.calls.length).toBeGreaterThan(1);
    animateSpy.mock.calls.forEach(([, options]) => {
      expect((options as KeyframeAnimationOptions | undefined)?.fill).not.toBe(
        "forwards",
      );
    });
  });
});

// The persistent "Prefer to set it up yourself? Follow the manual
// quickstart." link used to sit below the whole wizard as the only way out
// for a reader with JavaScript disabled, stuck on step 1 with no working
// Continue. That justification no longer holds: the page now ends with the
// restored backend grid below the wizard, whose server-rendered HTML
// carries real anchors — `/quickstart` first among them — reachable with no
// script running at all (confirmed against the running app). This asserts
// the line is gone by its exact wording, not merely that some other
// quickstart link exists elsewhere (step 5's own "Set up manually" action
// does, and must not be confused for this one).
describe("persistent quickstart link", () => {
  it("no longer renders the persistent manual-quickstart line below the wizard", () => {
    renderWizard();

    expect(
      screen.queryByText(
        "Prefer to set it up yourself? Follow the manual quickstart.",
      ),
    ).toBeNull();
  });
});

// A reviewer named em-dashes explicitly as something to stop using in this
// wizard's copy. Walked across every step rather than pinned to one string,
// so a reworded sentence that still avoids em-dashes keeps passing, and a
// dash reintroduced on any step (not just the one most recently touched)
// gets caught here.
describe("no em-dashes in step copy", () => {
  it("renders no em-dash anywhere in the visible copy, on any step", () => {
    const { container } = renderWizard();

    function assertNoEmDash() {
      expect(container.textContent).not.toContain("—");
    }

    assertNoEmDash(); // step 1: project question

    fireEvent.click(projectButton("Yes"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    assertNoEmDash(); // step 2: frontend

    fireEvent.click(screen.getByRole("button", { name: "React" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    assertNoEmDash(); // step 3: agent backend

    fireEvent.click(screen.getByRole("button", { name: "Mastra" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    assertNoEmDash(); // step 4: features

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    assertNoEmDash(); // step 5: review
  });
});
