import { describe, expect, it } from "vitest";
import {
  CHANNELS_ACTIVATION_CHANNELS,
  buildChannelsActivationPrompt,
  getChannelsActivationGuideHref,
} from "../channels-activation-contracts";
import { getChannelsActivationBackendOptions } from "../channels-activation-options";
import { getDocsMode, getIntegrations } from "../registry";
import { resolveBundledSetupConcept } from "../setup-content";
import type { SetupContentBundle } from "../setup-content";
import setupContentData from "@/data/setup-content.json";

const setupContent = setupContentData as SetupContentBundle;

describe("Channels activation documentation options", () => {
  it("derives the backend list from public Shell Docs entries with setup guides", () => {
    const expected = getIntegrations()
      .filter(
        ({ slug }) =>
          getDocsMode(slug) !== "hidden" &&
          resolveBundledSetupConcept(
            slug,
            "channels-agent-setup",
            setupContent,
          ) !== null,
      )
      .map(({ slug }) => slug)
      .sort();
    const actual = getChannelsActivationBackendOptions()
      .map(({ slug }) => slug)
      .sort();

    expect(actual).toEqual(expected);
    expect(actual).toHaveLength(19);
  });

  it("maps every documented channel and backend to its canonical connect guide", () => {
    const backends = getChannelsActivationBackendOptions();

    for (const backend of backends) {
      for (const channel of CHANNELS_ACTIVATION_CHANNELS) {
        const href = getChannelsActivationGuideHref(channel.id, backend);
        const expectedPrefix =
          backend.slug === "built-in-agent"
            ? `/${channel.id}`
            : `/${channel.id}/${backend.slug}`;

        expect(href, `${channel.id}/${backend.slug}`).toBe(
          `${expectedPrefix}/connect`,
        );
      }
    }
  });

  it("builds a concise prompt around the verified guide URL", () => {
    const prompt = buildChannelsActivationPrompt({
      channelLabel: "Microsoft Teams",
      backendLabel: "Mastra",
      guideUrl: "https://docs.copilotkit.ai/teams/mastra/connect",
    });

    expect(prompt).toContain("Microsoft Teams using Mastra");
    expect(prompt).toContain("https://docs.copilotkit.ai/teams/mastra/connect");
    expect(prompt).toContain("preserve its agent architecture");
  });
});
