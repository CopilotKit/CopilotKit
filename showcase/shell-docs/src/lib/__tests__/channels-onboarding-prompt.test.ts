import { describe, expect, it } from "vitest";
import {
  CHANNEL_ONBOARDING_IDS,
  channelSetupSentence,
  createChannelsOnboardingAttempt,
  createChannelsOnboardingPrompt,
  isChannelOnboardingId,
} from "../channels-onboarding-prompt";
import { INTELLIGENCE_ONBOARDING_PROMPT } from "../intelligence-onboarding-prompt";

describe("channels onboarding prompt", () => {
  it("reuses the canonical command and names Slack or Teams", () => {
    expect(createChannelsOnboardingPrompt("abc123abc123", "slack")).toBe(
      INTELLIGENCE_ONBOARDING_PROMPT.replace("<run-id>", "abc123abc123") +
        " They want to set up Slack.",
    );
    expect(createChannelsOnboardingPrompt("abc123abc123", "teams")).toBe(
      INTELLIGENCE_ONBOARDING_PROMPT.replace("<run-id>", "abc123abc123") +
        " They want to set up Microsoft Teams.",
    );
  });

  it("does not use --intent", () => {
    const prompt = createChannelsOnboardingPrompt("abc123abc123", "slack");
    expect(prompt).not.toContain("--intent");
    expect(channelSetupSentence("slack")).toBe(" They want to set up Slack.");
  });

  it("does not name an agent framework", () => {
    const prompt = createChannelsOnboardingPrompt("abc123abc123", "slack");
    expect(prompt).not.toMatch(/framework|built-in|mastra|langgraph/i);
  });

  it("recognises only the channels the intent route serves", () => {
    for (const id of CHANNEL_ONBOARDING_IDS) {
      expect(isChannelOnboardingId(id)).toBe(true);
    }
    for (const id of ["react", "vue", "angular", "react-native", undefined]) {
      expect(isChannelOnboardingId(id)).toBe(false);
    }
  });

  /**
   * One clipboard write is one onboarding attempt. A run id hoisted to module
   * scope would give every reader of a cached page the same id and collapse the
   * whole funnel into a single row — worse than having none.
   */
  it("mints a distinct run id per attempt", () => {
    const first = createChannelsOnboardingAttempt("slack");
    const second = createChannelsOnboardingAttempt("slack");

    expect(first.runId).toMatch(/^[0-9a-f]{12}$/);
    expect(second.runId).not.toBe(first.runId);
    expect(first.prompt).toContain(`--run ${first.runId}`);
    expect(first.prompt).toContain("They want to set up Slack.");
  });
});
