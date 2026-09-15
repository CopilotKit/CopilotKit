import { describe, expect, it } from "vitest";
import {
  CHANNELS_INTENT_IS_PROVISIONAL,
  CHANNELS_ONBOARDING_INTENT,
  CHANNEL_ONBOARDING_IDS,
  channelPromptSuffix,
  createChannelsOnboardingAttempt,
  createChannelsOnboardingPrompt,
  isChannelOnboardingId,
} from "../channels-onboarding-prompt";
import { INTELLIGENCE_ONBOARDING_PROMPT } from "../intelligence-onboarding-prompt";

describe("channels onboarding prompt", () => {
  /**
   * The ratchet on the PE-19 placeholder.
   *
   * The intent name cannot be verified until the CLI ships it, so this branch
   * carries a provisional one. Flipping the flag and this assertion together is
   * the single edit that declares it confirmed — which means an intent name
   * changed without that declaration fails here rather than shipping quietly.
   */
  it("still declares the intent name provisional", () => {
    expect(CHANNELS_INTENT_IS_PROVISIONAL).toBe(true);
    expect(CHANNELS_ONBOARDING_INTENT).toBe("add-channels");
  });

  it("follows the add-<feature> shape the other intents use", () => {
    expect(CHANNELS_ONBOARDING_INTENT).toMatch(/^add-[a-z0-9-]+$/);
  });

  /**
   * The instruction a reader pastes has to stay one sentence across every
   * surface — only the route may differ. Rebuilding it here instead of reusing
   * the canonical string is how six copies across three repos drifted apart the
   * last time.
   */
  it("reuses the canonical instruction and only adds the route", () => {
    const prompt = createChannelsOnboardingPrompt("abc123abc123");
    expect(prompt).toBe(
      `${INTELLIGENCE_ONBOARDING_PROMPT.replace("<run-id>", "abc123abc123")} --intent ${CHANNELS_ONBOARDING_INTENT}`,
    );
  });

  it("keeps --run and --intent on one command line", () => {
    const prompt = createChannelsOnboardingPrompt("abc123abc123");
    const commandLine = prompt.split("\n").find((line) => line.includes("npx"));
    expect(commandLine).toContain("--run abc123abc123");
    expect(commandLine).toContain(`--intent ${CHANNELS_ONBOARDING_INTENT}`);
  });

  it("names the channel so the run does not reopen a settled question", () => {
    expect(channelPromptSuffix("teams", "Microsoft Teams")).toBe(
      " The developer selected the Microsoft Teams channel (`teams`).",
    );
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
    const first = createChannelsOnboardingAttempt("slack", "Slack");
    const second = createChannelsOnboardingAttempt("slack", "Slack");

    expect(first.runId).toMatch(/^[0-9a-f]{12}$/);
    expect(second.runId).not.toBe(first.runId);
    expect(first.prompt).toContain(first.runId);
    expect(first.prompt).toContain("Slack channel (`slack`)");
  });
});
