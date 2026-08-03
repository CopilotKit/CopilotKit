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
import {
  CHANNELS_ACTIVATION_EVENTS,
  CHANNELS_OPENTAG_HREF,
} from "@/lib/channels-activation-contracts";
import type { ChannelsActivationBackendOption } from "@/lib/channels-activation-contracts";

const analytics = vi.hoisted(() => ({ capture: vi.fn() }));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

vi.mock("posthog-js/react", () => ({
  usePostHog: () => analytics,
}));

const backends: ChannelsActivationBackendOption[] = [
  {
    slug: "built-in-agent",
    label: "CopilotKit",
    logo: "/logos/built-in-agent.svg",
    guideHrefs: {
      slack: "/slack/connect",
      teams: "/teams/connect",
    },
  },
  {
    slug: "mastra",
    label: "Mastra",
    logo: "/logos/mastra.svg",
    guideHrefs: {
      slack: "/slack/mastra/connect",
      teams: "/teams/mastra/connect",
    },
  },
];

function renderStrip() {
  return render(
    <ChannelsActivationStrip
      backends={backends}
      docsBaseUrl="https://docs.copilotkit.ai"
    />,
  );
}

function setClipboard(writeText: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

afterEach(cleanup);

beforeEach(() => {
  analytics.capture.mockReset();
  setClipboard(vi.fn().mockResolvedValue(undefined));
});

describe("ChannelsActivationStrip", () => {
  it("introduces Channels before presenting the setup actions", () => {
    renderStrip();

    expect(
      screen.getByRole("region", {
        name: "The Channels SDK brings your agents where work happens.",
      }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        /Bring your agent into Slack or Microsoft Teams, with more platforms on the way\. Choose a channel and agent backend/,
      ),
    ).toBeTruthy();
  });

  it("updates the real guide route and captures only changed selections", () => {
    renderStrip();

    fireEvent.click(screen.getByRole("button", { name: "Choose a channel" }));
    fireEvent.click(screen.getByRole("option", { name: /Microsoft Teams/ }));

    let guide = screen.getByRole("link", { name: /Open setup guide/ });
    expect(guide.getAttribute("href")).toBe("/teams/connect");
    expect(analytics.capture).toHaveBeenCalledWith(
      CHANNELS_ACTIVATION_EVENTS.channelSelected,
      expect.objectContaining({
        channel: "teams",
        backend: "built-in-agent",
        destination_path: "/teams/connect",
      }),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Choose an agent backend" }),
    );
    fireEvent.click(screen.getByRole("option", { name: /Mastra/ }));

    guide = screen.getByRole("link", { name: /Open setup guide/ });
    expect(guide.getAttribute("href")).toBe("/teams/mastra/connect");
    expect(analytics.capture).toHaveBeenCalledWith(
      CHANNELS_ACTIVATION_EVENTS.backendSelected,
      expect.objectContaining({
        channel: "teams",
        backend: "mastra",
        destination_path: "/teams/mastra/connect",
      }),
    );

    const captureCount = analytics.capture.mock.calls.length;
    fireEvent.click(
      screen.getByRole("button", { name: "Choose an agent backend" }),
    );
    fireEvent.click(screen.getByRole("option", { name: /Mastra/ }));
    expect(analytics.capture).toHaveBeenCalledTimes(captureCount);

    fireEvent.click(guide);
    expect(analytics.capture).toHaveBeenCalledWith(
      CHANNELS_ACTIVATION_EVENTS.setupGuideOpened,
      expect.objectContaining({
        channel: "teams",
        backend: "mastra",
        destination_path: "/teams/mastra/connect",
      }),
    );
  });

  it("supports listbox keyboard navigation and restores trigger focus", () => {
    renderStrip();
    const channelTrigger = screen.getByRole("button", {
      name: "Choose a channel",
    });

    channelTrigger.focus();
    fireEvent.keyDown(channelTrigger, { key: "End" });
    const teamsOption = screen.getByRole("option", {
      name: /Microsoft Teams/,
    });
    expect(document.activeElement).toBe(teamsOption);
    fireEvent.keyDown(teamsOption, { key: "Enter" });
    expect(document.activeElement).toBe(channelTrigger);
    expect(channelTrigger.textContent).toContain("Microsoft Teams");

    fireEvent.keyDown(channelTrigger, { key: "ArrowDown" });
    expect(
      screen.getByRole("listbox", { name: "Choose a channel" }),
    ).toBeTruthy();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
    expect(document.activeElement).toBe(channelTrigger);
    expect(
      screen.queryByRole("listbox", { name: "Choose a channel" }),
    ).toBeNull();
  });

  it("announces a successful copy and emits telemetry after clipboard success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    renderStrip();

    fireEvent.click(
      screen.getByRole("button", { name: /Build with your agent/ }),
    );

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const prompt = writeText.mock.calls[0][0] as string;
    expect(prompt).toContain("https://docs.copilotkit.ai/slack/connect");
    expect(await screen.findByText("Prompt copied")).toBeTruthy();
    expect(analytics.capture).toHaveBeenCalledWith(
      CHANNELS_ACTIVATION_EVENTS.promptCopied,
      expect.objectContaining({
        channel: "slack",
        backend: "built-in-agent",
        guide_url: "https://docs.copilotkit.ai/slack/connect",
      }),
    );
  });

  it("shows copy failure without emitting success telemetry", async () => {
    setClipboard(vi.fn().mockRejectedValue(new Error("blocked")));
    renderStrip();

    fireEvent.click(
      screen.getByRole("button", { name: /Build with your agent/ }),
    );

    expect(await screen.findByText("Copy failed")).toBeTruthy();
    expect(analytics.capture).not.toHaveBeenCalledWith(
      CHANNELS_ACTIVATION_EVENTS.promptCopied,
      expect.anything(),
    );
  });

  it("tracks the OpenTag link with the current selection", () => {
    renderStrip();
    const link = screen.getByRole("link", { name: "Clone OpenTag on GitHub" });

    expect(link.getAttribute("href")).toBe(CHANNELS_OPENTAG_HREF);
    fireEvent.click(link);
    expect(analytics.capture).toHaveBeenCalledWith(
      CHANNELS_ACTIVATION_EVENTS.openTagClicked,
      expect.objectContaining({
        channel: "slack",
        backend: "built-in-agent",
        destination_url: CHANNELS_OPENTAG_HREF,
      }),
    );
  });
});
