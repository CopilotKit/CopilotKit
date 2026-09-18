import { describe, expect, it } from "vitest";
import {
  CHANNELS_ACTIVATION_CHANNELS,
  CHANNELS_GUIDE_URL,
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

  // The hosted guide outlived the prompt that pointed at it: docs surfaces now
  // copy the Channels intent prompt instead, but the marketing site, the
  // channels-sdk README, and a skill still fetch this URL. It stays pinned here
  // until whoever owns those retires it.
  describe("hosted guide", () => {
    it("keeps the URL its out-of-repo consumers fetch", () => {
      expect(CHANNELS_GUIDE_URL).toBe(
        "https://copilotkit.ai/channels-guide.md",
      );
    });
  });
});
