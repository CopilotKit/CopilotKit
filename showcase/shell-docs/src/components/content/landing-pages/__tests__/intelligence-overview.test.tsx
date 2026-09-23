// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  INTELLIGENCE_SIZZLE_VIDEO_URL,
  IntelligenceFeatureCards,
  IntelligenceOverview,
} from "../intelligence-overview";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/intelligence/overview",
}));

vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: vi.fn() }),
}));

afterEach(() => {
  cleanup();
});

describe("IntelligenceOverview", () => {
  it("renders the product demo and its actions without a duplicate page heading", () => {
    render(<IntelligenceOverview />);

    expect(screen.queryByRole("heading")).toBeNull();
    expect(
      screen.queryByText(/CopilotKit Intelligence adds persistent threads/i),
    ).toBeNull();
    expect(screen.getByRole("button", { name: /^copy prompt$/i })).toBeTruthy();

    const quickstart = screen.getByRole("link", { name: /^quickstart$/i });
    expect(quickstart.getAttribute("href")).toBe("/intelligence/quickstart");
  });

  it("swallows autoplay rejection so the page still renders", async () => {
    const play = vi.fn().mockRejectedValue(new DOMException("blocked"));
    const originalPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = play;

    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as typeof window.matchMedia;

    const rejections: unknown[] = [];
    function onUnhandled(event: PromiseRejectionEvent) {
      rejections.push(event.reason);
    }
    window.addEventListener("unhandledrejection", onUnhandled);

    try {
      render(<IntelligenceOverview />);
      await waitFor(() => expect(play).toHaveBeenCalled());
      expect(rejections).toEqual([]);
      expect(
        screen.getByLabelText("CopilotKit Intelligence product demo"),
      ).toBeTruthy();
    } finally {
      window.removeEventListener("unhandledrejection", onUnhandled);
      HTMLMediaElement.prototype.play = originalPlay;
    }
  });

  it("renders the sizzle video with a pause control", () => {
    render(<IntelligenceOverview />);

    const video = screen.getByLabelText("CopilotKit Intelligence product demo");
    if (!(video instanceof HTMLVideoElement)) {
      throw new Error("expected a video element");
    }
    expect(video.getAttribute("src")).toBe(INTELLIGENCE_SIZZLE_VIDEO_URL);
    expect(video.controls).toBe(true);
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);

    const prompt = screen.getByRole("button", {
      name: /^copy prompt$/i,
    });
    expect(
      video.compareDocumentPosition(prompt) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("links each feature card to its guide", () => {
    render(<IntelligenceFeatureCards />);

    const expected: Array<[string, string]> = [
      ["Rich Threads", "/threads"],
      ["Channels", "/intelligence/channels"],
      ["User Memories", "/intelligence/memories"],
      ["Product Analytics", "/intelligence/analytics"],
      ["Automatic Learning", "/learning"],
      ["Inspector", "/inspector"],
    ];
    for (const [title, href] of expected) {
      const card = screen.getByRole("link", { name: new RegExp(title) });
      expect(card.getAttribute("href")).toBe(href);
      expect(card.querySelector("svg")).toBeTruthy();
    }
  });
});
