// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  INTELLIGENCE_SIZZLE_VIDEO_URL,
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
  it("renders the hero headline, copy prompt, and connect action", () => {
    render(<IntelligenceOverview />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Ship durable agent experiences",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /copy onboarding prompt/i }),
    ).toBeTruthy();

    const connect = screen.getByRole("link", { name: /connect an app/i });
    expect(connect.getAttribute("href")).toBe(
      "/intelligence/connect-your-runtime",
    );
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
  });

  it("links each feature card to its guide", () => {
    render(<IntelligenceOverview />);

    expect(
      screen
        .getByRole("link", { name: "Open the Rich Threads guide" })
        .getAttribute("href"),
    ).toBe("/threads");
    expect(
      screen
        .getByRole("link", { name: "See Analytics on the product page" })
        .getAttribute("href"),
    ).toBe(
      "https://www.copilotkit.ai/copilotkit-intelligence#analytics-insights",
    );
    expect(
      screen
        .getByRole("link", {
          name: "See Automatic Learning on the product page",
        })
        .getAttribute("href"),
    ).toBe(
      "https://www.copilotkit.ai/copilotkit-intelligence#self-improvement",
    );
    expect(
      screen
        .getByRole("link", { name: "Open the self-hosting guide" })
        .getAttribute("href"),
    ).toBe("/intelligence/self-hosting");
  });

  it("links pricing out to the public pricing page", () => {
    render(<IntelligenceOverview />);

    expect(
      screen
        .getByRole("link", { name: "See CopilotKit Intelligence pricing" })
        .getAttribute("href"),
    ).toBe("https://www.copilotkit.ai/pricing");
  });
});
