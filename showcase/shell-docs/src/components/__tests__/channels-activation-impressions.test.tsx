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
import { ChannelsActivationStrip } from "../channels-activation-strip";
import { ChannelsStartPrompt } from "../channels-start-prompt";
import { DocsPromptActionsProvider } from "../docs-prompt-actions";
import {
  CHANNELS_ACTIVATION_EVENTS,
  CHANNELS_ACTIVATION_SURFACES,
} from "@/lib/channels-activation-contracts";
import type { ChannelsActivationBackendOption } from "@/lib/channels-activation-contracts";

const analytics = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock("posthog-js/react", () => ({ usePostHog: () => analytics }));
vi.mock("next/navigation", () => ({ usePathname: () => "/channels" }));

let intersectionCallback: IntersectionObserverCallback | null = null;

class TestIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "0px";
  readonly thresholds = [0.5];

  constructor(callback: IntersectionObserverCallback) {
    intersectionCallback = callback;
  }

  disconnect() {}
  observe() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  unobserve() {}
}

function intersect(target: Element, isIntersecting: boolean) {
  if (!intersectionCallback) {
    throw new Error("IntersectionObserver was not initialized");
  }
  const rect = target.getBoundingClientRect();
  intersectionCallback(
    [
      {
        boundingClientRect: rect,
        intersectionRatio: isIntersecting ? 1 : 0,
        intersectionRect: rect,
        isIntersecting,
        rootBounds: null,
        target,
        time: 0,
      } as IntersectionObserverEntry,
    ],
    {} as IntersectionObserver,
  );
}

const backends: ChannelsActivationBackendOption[] = [
  {
    slug: "built-in-agent",
    label: "CopilotKit's built-in agent",
    logo: null,
    guideHrefs: { slack: "/slack/connect", teams: "/teams/connect" },
  },
];

beforeEach(() => {
  analytics.capture.mockReset();
  intersectionCallback = null;
  vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
});

afterEach(() => {
  cleanup();
});

// The copy event is the numerator of the only real question about these
// surfaces — does anyone use them. Without an impression there is no
// denominator, so a panel nobody scrolls to and a panel everybody ignores look
// identical in PostHog. `surface` is what keeps the two docs entry points (and
// copilotkit.ai/channels, which sends its own event name with the same
// property) separable inside one funnel.
describe("Channels activation impressions", () => {
  it.each(["slack", "teams"])(
    "copies generic onboarding with the %s page context",
    async (frontend) => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText },
      });
      HTMLDialogElement.prototype.showModal = function () {
        this.open = true;
      };
      render(
        <DocsPromptActionsProvider
          value={{ markdownUrl: `/${frontend}.mdx`, githubUrl: "", frontend }}
        >
          <ChannelsStartPrompt frontend={frontend} />
        </DocsPromptActionsProvider>,
      );
      expect(
        screen.getByRole("region", {
          name: /Set up .* with your coding agent/,
        }),
      ).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: /Copy prompt/i }));
      await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
      const prompt = writeText.mock.calls[0][0];
      expect(prompt).toContain("onboard start");
      expect(prompt).not.toContain("add-channels");
      expect(prompt).toContain(
        `The developer copied this prompt from https://docs.copilotkit.ai/${frontend}.mdx.`,
      );
    },
  );

  it("reports the landing strip the first time it is seen", () => {
    render(
      <ChannelsActivationStrip
        backends={backends}
        docsBaseUrl="https://docs.copilotkit.ai"
      />,
    );
    const strip = screen.getByRole("region", {
      name: /Channels SDK brings your agents/i,
    });

    expect(analytics.capture).not.toHaveBeenCalled();

    intersect(strip, true);

    expect(analytics.capture).toHaveBeenCalledWith(
      CHANNELS_ACTIVATION_EVENTS.viewed,
      {
        channel: "slack",
        backend: "built-in-agent",
        from_path: "/channels",
        surface: CHANNELS_ACTIVATION_SURFACES.docsLandingStrip,
      },
    );
  });

  it("reports the overview panel with its own surface", () => {
    render(<ChannelsStartPrompt frontend="teams" />);
    const panel = screen.getByTestId("channels-start-prompt");

    intersect(panel, true);

    expect(analytics.capture).toHaveBeenCalledWith(
      CHANNELS_ACTIVATION_EVENTS.viewed,
      {
        channel: "teams",
        backend: "built-in-agent",
        from_path: "/channels",
        surface: CHANNELS_ACTIVATION_SURFACES.docsChannelsOverview,
      },
    );
  });

  it("does not re-fire when a surface scrolls back into view", () => {
    render(<ChannelsStartPrompt />);
    const panel = screen.getByTestId("channels-start-prompt");

    intersect(panel, true);
    intersect(panel, false);
    intersect(panel, true);

    const impressions = analytics.capture.mock.calls.filter(
      ([event]) => event === CHANNELS_ACTIVATION_EVENTS.viewed,
    );
    expect(impressions).toHaveLength(1);
  });

  // Regression: the clipboard write and the capture call used to share one try
  // block, so a throwing analytics client reported "Copy blocked" for a prompt
  // that had already reached the clipboard. Only the write decides the state.
  it("still reports a successful copy when analytics throws", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    analytics.capture.mockImplementation(() => {
      throw new Error("posthog unavailable");
    });

    HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
    render(<ChannelsStartPrompt />);
    fireEvent.click(screen.getByRole("button", { name: /Copy prompt/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Prompt copied")).toBeTruthy();
    expect(screen.queryByText("Copy blocked")).toBeNull();
  });

  it("reports a blocked clipboard as blocked", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });

    HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
    render(<ChannelsStartPrompt />);
    fireEvent.click(screen.getByRole("button", { name: /Copy prompt/i }));

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("Copy blocked"),
    );
    expect(
      analytics.capture.mock.calls.filter(
        ([event]) => event === CHANNELS_ACTIVATION_EVENTS.promptCopied,
      ),
    ).toEqual([]);
  });

  it("stays silent while a surface is below the fold", () => {
    render(<ChannelsStartPrompt />);
    const panel = screen.getByTestId("channels-start-prompt");

    intersect(panel, false);

    expect(analytics.capture).not.toHaveBeenCalled();
  });
});

vi.mock("fumadocs-core/framework", () => ({
  usePathname: () => "/quickstart",
}));

vi.mock("@/lib/runtime-config.client", () => ({
  getRuntimeConfig: () => ({ baseUrl: "https://docs.copilotkit.ai" }),
}));
