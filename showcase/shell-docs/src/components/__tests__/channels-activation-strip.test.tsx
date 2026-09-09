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
  CHANNELS_BUILD_PROMPT,
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
        /Copy this prompt and your coding agent builds your first\s+channel with you/,
      ),
    ).toBeTruthy();
  });

  it("announces a successful copy and emits telemetry after clipboard success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    renderStrip();

    fireEvent.click(screen.getByRole("button", { name: /Copy prompt/ }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const prompt = writeText.mock.calls[0][0] as string;
    // The copied text is a pointer at the hosted guide, not a copy of the
    // workflow, and it is the same for every selection. `guide_url` stays on the
    // telemetry below so the picker's destination is still measurable.
    expect(prompt).toBe(CHANNELS_BUILD_PROMPT);
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

    fireEvent.click(screen.getByRole("button", { name: /Copy prompt/ }));

    expect(await screen.findByText("Copy failed")).toBeTruthy();
    expect(analytics.capture).not.toHaveBeenCalledWith(
      CHANNELS_ACTIVATION_EVENTS.promptCopied,
      expect.anything(),
    );
  });

  it("tracks the OpenTag link with the current selection", () => {
    renderStrip();
    const link = screen.getByRole("link", { name: "clone OpenTag on GitHub" });

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
