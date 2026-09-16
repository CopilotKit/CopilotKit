import { describe, expect, it } from "vitest";
import {
  CHANNEL_ONBOARDING_IDS,
  createChannelsOnboardingAttempt,
  createChannelsOnboardingPrompt,
  isChannelOnboardingId,
} from "../channels-onboarding-prompt";
import { INTELLIGENCE_ONBOARDING_PROMPT } from "../intelligence-onboarding-prompt";

describe("channels onboarding prompt", () => {
  it("is the same small prompt as every other CTA", () => {
    expect(createChannelsOnboardingPrompt("abc123abc123")).toBe(
      INTELLIGENCE_ONBOARDING_PROMPT.replace("<run-id>", "abc123abc123"),
    );
  });

  it("does not use --intent or name Slack or Teams", () => {
    const prompt = createChannelsOnboardingPrompt("abc123abc123");
    expect(prompt).not.toContain("--intent");
    expect(prompt).not.toMatch(/slack|teams/i);
  });

  it("does not name an agent framework", () => {
    const prompt = createChannelsOnboardingPrompt("abc123abc123");
    expect(prompt).not.toMatch(/framework|built-in|mastra|langgraph/i);
  });

  it("recognises only Slack and Teams Channel pages", () => {
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
    const first = createChannelsOnboardingAttempt();
    const second = createChannelsOnboardingAttempt();

    expect(first.runId).toMatch(/^[0-9a-f]{12}$/);
    expect(second.runId).not.toBe(first.runId);
    expect(first.prompt).toContain(`--run ${first.runId}`);
  });
});
