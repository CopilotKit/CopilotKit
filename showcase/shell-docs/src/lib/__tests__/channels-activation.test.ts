import { describe, expect, it } from "vitest";
import {
  CHANNELS_ACTIVATION_CHANNELS,
  CHANNELS_ONBOARDING_INSTALL_COMMAND,
  CHANNELS_ONBOARDING_SKILL,
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

  // The prompt is a pointer to one skill, not a copy of the workflow. Six
  // surfaces across three repos each carried their own prose version, drifted,
  // and went stale against the CLI; these assertions pin the corrections that
  // drift produced so they cannot be quietly undone here.
  describe("activation prompt", () => {
    const prompt = buildChannelsActivationPrompt({
      channelLabel: "Microsoft Teams",
      backendLabel: "Mastra",
    });

    it("names the picker's channel and backend", () => {
      expect(prompt).toContain("Microsoft Teams using Mastra");
    });

    it("names the one skill to install rather than leaving it to a picker", () => {
      expect(prompt).toContain(`--skill ${CHANNELS_ONBOARDING_SKILL}`);
      expect(prompt).toContain(CHANNELS_ONBOARDING_INSTALL_COMMAND);
    });

    it("installs non-interactively so the agent can run it unattended", () => {
      expect(CHANNELS_ONBOARDING_INSTALL_COMMAND).toMatch(/ -y$/);
    });

    it("pins the CLI to @latest so a cached older binary cannot shadow it", () => {
      expect(CHANNELS_ONBOARDING_INSTALL_COMMAND).toContain(
        "npx copilotkit@latest",
      );
      expect(CHANNELS_ONBOARDING_INSTALL_COMMAND).not.toMatch(
        /npx copilotkit(?!@latest)/,
      );
    });

    it("stays a pointer instead of re-embedding the workflow", () => {
      expect(prompt.split("\n")).toHaveLength(1);
      expect(prompt.length).toBeLessThan(240);
    });
  });
});
