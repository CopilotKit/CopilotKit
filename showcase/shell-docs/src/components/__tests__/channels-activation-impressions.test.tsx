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
import { ChannelsStartPrompt } from "../channels-start-prompt";
import {
  CHANNELS_ACTIVATION_EVENTS,
  CHANNELS_ACTIVATION_SURFACES,
} from "@/lib/channels-activation-contracts";

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

    render(<ChannelsStartPrompt />);
    fireEvent.click(screen.getByRole("button", { name: /Copy prompt/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Copied")).toBeTruthy();
    expect(screen.queryByText("Copy blocked")).toBeNull();
  });

  it("reports a blocked clipboard as blocked", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });

    render(<ChannelsStartPrompt />);
    fireEvent.click(screen.getByRole("button", { name: /Copy prompt/i }));

    expect(await screen.findByText("Copy blocked")).toBeTruthy();
    expect(
      analytics.capture.mock.calls.filter(
        ([event]) => event === CHANNELS_ACTIVATION_EVENTS.promptCopied,
      ),
    ).toEqual([]);
  });

  // The panel renders on 36 backend-scoped `/slack/<framework>` and
  // `/teams/<framework>` pages. It used to report a fixed `built-in-agent`
  // literal on every one of them, so the funnel could not tell which backend a
  // reader was actually looking at when they copied the prompt.
  it("reports the backend the URL selects, not a fixed literal", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });

    render(<ChannelsStartPrompt frontend="slack" backend="mastra" />);
    fireEvent.click(screen.getByRole("button", { name: /copy prompt/i }));

    await waitFor(() => expect(analytics.capture).toHaveBeenCalled());

    const call = analytics.capture.mock.calls.find(
      ([event]) => event === CHANNELS_ACTIVATION_EVENTS.promptCopied,
    );
    expect((call?.[1] as Record<string, unknown>).backend).toBe("mastra");
  });

  it("stays silent while a surface is below the fold", () => {
    render(<ChannelsStartPrompt />);
    const panel = screen.getByTestId("channels-start-prompt");

    intersect(panel, false);

    expect(analytics.capture).not.toHaveBeenCalled();
  });
});
