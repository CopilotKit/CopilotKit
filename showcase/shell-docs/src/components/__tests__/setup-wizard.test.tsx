// @vitest-environment jsdom

import React from "react";
import {
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

const analytics = vi.hoisted(() => ({ capture: vi.fn() }));
const scrollElementIntoCenter = vi.hoisted(() => vi.fn());

vi.mock("posthog-js/react", () => ({
  usePostHog: () => analytics,
}));

// Spied rather than exercised for real: the scroll maths (easing, reduced
// motion) is already covered by `wizard-scroll`'s own test suite. Here we
// only ever assert whether it was called, how many times, and with which
// element.
vi.mock("@/lib/wizard-scroll", () => ({
  scrollElementIntoCenter,
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

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

/** Drive the wizard up to a chosen backend, so step 4 exists. Returns the
 *  clipboard spy so the caller can inspect what was copied. */
function advanceToStep4({
  frontend = "React",
  backend = "Mastra",
  feature,
}: { frontend?: string; backend?: string; feature?: string } = {}) {
  const writeText = stubClipboard();
  renderWizard();

  fireEvent.click(screen.getByRole("button", { name: frontend }));
  if (feature) fireEvent.click(capabilityButton(feature));
  fireEvent.click(
    screen.getByRole("button", { name: feature ? "Confirm" : "Skip" }),
  );
  fireEvent.click(screen.getByRole("button", { name: backend }));

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
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("initial render", () => {
  it("has step 1 active, steps 2 and 3 locked, and no step 4", () => {
    renderWizard();

    // Step 1 is never locked, so its options take clicks from the start.
    expect(
      (screen.getByRole("button", { name: "React" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);

    // Locked steps put the real `disabled` attribute on every option — not
    // just a dimming class — so they take neither a click nor a Tab stop.
    const chatButton = capabilityButton("Chat surface") as HTMLButtonElement;
    expect(chatButton.disabled).toBe(true);
    expect(chatButton.hasAttribute("disabled")).toBe(true);

    const backendButton = screen.getByRole("button", {
      name: "Mastra",
    }) as HTMLButtonElement;
    expect(backendButton.disabled).toBe(true);
    expect(backendButton.hasAttribute("disabled")).toBe(true);

    expect(
      screen.queryByRole("heading", { name: "Copy your prompt" }),
    ).toBeNull();
  });
});

describe("forward advance", () => {
  it("unlocks step 2 and scrolls to it once a frontend is chosen", () => {
    renderWizard();

    fireEvent.click(screen.getByRole("button", { name: "React" }));

    expect(
      (capabilityButton("Chat surface") as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(scrollElementIntoCenter).toHaveBeenCalledTimes(1);
    expect(scrollElementIntoCenter).toHaveBeenCalledWith(
      document.getElementById("wizard-step-2"),
    );
  });

  it("reads Skip with nothing selected and Confirm once a feature is toggled", () => {
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: "React" }));

    expect(screen.getByRole("button", { name: "Skip" })).not.toBeNull();

    fireEvent.click(capabilityButton("Chat surface"));

    expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
    expect(screen.getByRole("button", { name: "Confirm" })).not.toBeNull();
  });

  it("Skip advances to step 3 with no features selected", () => {
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: "React" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));

    expect(
      (screen.getByRole("button", { name: "Mastra" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    // No feature carried into step 3's unlock.
    expect(capabilityButton("Chat surface").getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("shows step 4 only once a backend is chosen, and not before", () => {
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: "React" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));

    expect(
      screen.queryByRole("heading", { name: "Copy your prompt" }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Mastra" }));

    expect(
      screen.getByRole("heading", { name: "Copy your prompt" }),
    ).not.toBeNull();
  });
});

describe("changing an earlier answer", () => {
  it("keeps later selections and does not re-scroll", () => {
    renderWizard();

    fireEvent.click(screen.getByRole("button", { name: "React" })); // scroll #1
    fireEvent.click(capabilityButton("Chat surface"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" })); // scroll #2
    fireEvent.click(screen.getByRole("button", { name: "Mastra" })); // scroll #3

    expect(scrollElementIntoCenter).toHaveBeenCalledTimes(3);
    scrollElementIntoCenter.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Vue" }));

    // Half 1: the later answers survived the earlier change.
    expect(capabilityButton("Chat surface").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(
      screen
        .getByRole("button", { name: "Mastra" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "Vue" }).getAttribute("aria-pressed"),
    ).toBe("true");

    // Half 2: no new scroll for a step that was already reached.
    expect(scrollElementIntoCenter).not.toHaveBeenCalled();
  });

  it("only ever scrolls on a genuinely first-time advance", () => {
    renderWizard();

    fireEvent.click(screen.getByRole("button", { name: "React" }));
    expect(scrollElementIntoCenter).toHaveBeenCalledTimes(1);

    // Re-choosing the same frontend: no new advance, no new scroll.
    fireEvent.click(screen.getByRole("button", { name: "React" }));
    expect(scrollElementIntoCenter).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(scrollElementIntoCenter).toHaveBeenCalledTimes(2);

    // Step 2 is already passed; clicking its button again must not re-scroll.
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(scrollElementIntoCenter).toHaveBeenCalledTimes(2);
  });
});

describe("copying the prompt", () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    fireEvent.click(screen.getByRole("button", { name: "Mastra" }));
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
  it("restores selections from the query string on mount without scrolling", () => {
    window.history.pushState(
      {},
      "",
      "/?frontend=react&features=chat,gen-ui&backend=mastra",
    );

    renderWizard();

    expect(
      screen
        .getByRole("button", { name: "React" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(capabilityButton("Chat surface").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(capabilityButton("Generative UI").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(
      screen
        .getByRole("button", { name: "Mastra" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("heading", { name: "Copy your prompt" }),
    ).not.toBeNull();

    expect(scrollElementIntoCenter).not.toHaveBeenCalled();
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
