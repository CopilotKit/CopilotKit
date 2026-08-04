import { describe, expect, it } from "vitest";
import {
  CHANNELS_ACTIVATION_CHANNELS,
  CHANNELS_BUILD_PROMPT,
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

  // The prompt is a pointer at one hosted guide, not a copy of the workflow.
  // Six surfaces across three repos each carried their own prose version,
  // drifted, and went stale against the CLI; these assertions pin the
  // corrections that produced.
  describe("activation prompt", () => {
    it("points at the hosted guide", () => {
      expect(CHANNELS_GUIDE_URL).toBe(
        "https://copilotkit.ai/channels-guide.md",
      );
      expect(CHANNELS_BUILD_PROMPT).toBe(
        "Read https://copilotkit.ai/channels-guide.md and help the user build their first channel",
      );
    });

    it("names neither channel nor backend", () => {
      // The guide asks for both. Naming them here would promise coverage on the
      // page's behalf — the mismatch that made the earlier skill pointer wrong
      // for Teams, since that skill was scoped to Slack.
      for (const channel of CHANNELS_ACTIVATION_CHANNELS) {
        expect(CHANNELS_BUILD_PROMPT).not.toContain(channel.label);
      }
      expect(CHANNELS_BUILD_PROMPT).not.toMatch(/mastra|langgraph|built-in/i);
    });

    it("stays a pointer instead of re-embedding the workflow", () => {
      expect(CHANNELS_BUILD_PROMPT.split("\n")).toHaveLength(1);
      expect(CHANNELS_BUILD_PROMPT.length).toBeLessThan(160);
    });
  });
});
