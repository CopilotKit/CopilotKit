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
let capturedOnJump: ((step: number) => void) | null = null;

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
  };
});

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

/** Install a resolving clipboard stub and hand back its spy. */
function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  return writeText;
}

/** Drive the wizard from step 1 all the way to step 4 (frontend -> Continue
 *  -> backend -> Continue -> features -> Skip/Continue), the new step
 *  order. Returns the clipboard spy so the caller can inspect what was
 *  copied. */
function advanceToStep4({
  frontend = "React",
  backend = "Mastra",
  feature,
}: { frontend?: string; backend?: string; feature?: string } = {}) {
  const writeText = stubClipboard();
  renderWizard();

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
  // jsdom has no WAAPI at all — `Element.prototype.animate` doesn't exist,
  // so every call the component makes would throw without this stub. The
  // component's own transition logic (`wizard-step-transition.ts`) has its
  // own dedicated unit tests; here we only need calls into `animate` not to
  // blow up.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Element.prototype as any).animate = vi.fn().mockReturnValue({
    onfinish: null,
  });
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
  it("shows only step 1's card", () => {
    renderWizard();

    expect(
      screen.getByRole("heading", { name: "Your frontend" }),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "React" })).not.toBeNull();

    // The backend and feature option lists don't exist in the DOM at all —
    // this is a single-card-at-a-time stepper, not a scrolling page with
    // locked-but-present sections.
    expect(screen.queryByRole("button", { name: "Mastra" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Chat surface/ })).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "Copy your prompt" }),
    ).toBeNull();
  });
});

describe("step 1: frontend", () => {
  it("disables Continue until a frontend is picked", () => {
    renderWizard();

    expect(
      (screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "React" }));

    expect(
      (screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
});

describe("navigation", () => {
  it("Continue advances to the agent backend step, and Back returns with the frontend kept", () => {
    renderWizard();

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
      screen.getByRole("heading", { name: "Copy your prompt" }),
    ).not.toBeNull();
  });

  it("Skip also advances, with no features selected", () => {
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: "React" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Mastra" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));

    expect(
      screen.getByRole("heading", { name: "Copy your prompt" }),
    ).not.toBeNull();
  });
});

describe("changing an earlier answer", () => {
  it("keeps the backend and the features when the frontend changes", () => {
    renderWizard();

    fireEvent.click(screen.getByRole("button", { name: "React" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Mastra" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(capabilityButton("Chat surface"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      screen.getByRole("heading", { name: "Copy your prompt" }),
    ).not.toBeNull();

    // Jump back to step 1 via the progress rail and pick a different
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
    fireEvent.click(screen.getByRole("button", { name: "React" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    const promptRailButton = screen.getByRole("button", {
      name: /Prompt/,
    }) as HTMLButtonElement;
    expect(promptRailButton.disabled).toBe(true);

    const frontendRailButton = screen.getByRole("button", {
      name: /Frontend/,
    }) as HTMLButtonElement;
    expect(frontendRailButton.disabled).toBe(false);

    fireEvent.click(frontendRailButton);
    expect(
      screen.getByRole("heading", { name: "Your frontend" }),
    ).not.toBeNull();
  });

  it("refuses to jump past furthest even when asked to directly", () => {
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: "React" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" })); // furthest = 2, current = 2

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
      capturedOnJump?.(4);
    });

    expect(
      screen.getByRole("heading", { name: "Your agent backend" }),
    ).not.toBeNull();
    expect(
      screen.queryByRole("heading", { name: "Copy your prompt" }),
    ).toBeNull();
  });
});

describe("step 4: copy your prompt", () => {
  it("shows the copy button and the quickstart link, and renders neither the prompt text nor a reset control", () => {
    advanceToStep4({ frontend: "React", backend: "Mastra" });

    expect(screen.getByRole("button", { name: "Copy prompt" })).not.toBeNull();
    expect(screen.getByRole("link", { name: /quickstart/i })).not.toBeNull();
    expect(screen.queryByText(/--coding-agent/)).toBeNull();
    expect(screen.queryByRole("button", { name: /reset/i })).toBeNull();
  });

  it("writes the canonical CLI invocation plus the framework and frontend sentences", async () => {
    const writeText = advanceToStep4({ frontend: "React", backend: "Mastra" });

    fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));

    await waitFor(() => expect(analytics.capture).toHaveBeenCalled());

    const expected = composeWizardOnboardingPrompt(reportedRunId(), {
      frontend: { id: "react", name: "React" },
      backend: { id: "mastra", name: "Mastra" },
      featureTitles: [],
    });

    expect(expected).toContain("--coding-agent <coding-agent-slug>");
    expect(writeText).toHaveBeenCalledExactlyOnceWith(expected);
  });

  it("produces the identical string on a second copy in the same page view", async () => {
    const writeText = advanceToStep4();

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
});

describe("URL state", () => {
  it("restores all three selections and lands on step 4 when frontend, features and backend are all present", () => {
    window.history.pushState(
      {},
      "",
      "/?frontend=react&features=chat,gen-ui&backend=mastra",
    );

    renderWizard();

    expect(
      screen.getByRole("heading", { name: "Copy your prompt" }),
    ).not.toBeNull();

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

  it("lands on step 2 when only the frontend is present", () => {
    window.history.pushState({}, "", "/?frontend=react");

    renderWizard();

    expect(
      screen.getByRole("heading", { name: "Your agent backend" }),
    ).not.toBeNull();
  });

  it("writes with replaceState, never pushState, on a selection", () => {
    renderWizard();

    const replaceSpy = vi.spyOn(window.history, "replaceState");
    const pushSpy = vi.spyOn(window.history, "pushState");

    fireEvent.click(screen.getByRole("button", { name: "React" }));

    expect(replaceSpy).toHaveBeenCalled();
    const [, , url] = replaceSpy.mock.calls.at(-1) as [unknown, string, string];
    expect(url).toContain("frontend=react");
    expect(pushSpy).not.toHaveBeenCalled();
  });
});

describe("focus management", () => {
  it("does not move focus on the first render", () => {
    renderWizard();

    expect(document.activeElement).not.toBe(
      screen.getByRole("heading", { name: "Your frontend" }),
    );
  });

  it("moves focus to the card's heading on every step change", () => {
    renderWizard();

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
