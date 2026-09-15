import { describe, expect, it } from "vitest";
import {
  CHANNELS_ONBOARDING_INTENT,
  CHANNEL_ONBOARDING_IDS,
  createChannelsOnboardingAttempt,
  createChannelsOnboardingPrompt,
  isChannelOnboardingId,
} from "../channels-onboarding-prompt";
import { INTELLIGENCE_ONBOARDING_PROMPT } from "../intelligence-onboarding-prompt";

describe("channels onboarding prompt", () => {
  /**
   * The route the CLI actually ships, from `ONBOARDING_INTENT_ROOTS` in the
   * Intelligence repo. Pinned as a literal so a rename there fails here rather
   * than sending readers to an intent `onboard start` will refuse.
   */
  it("addresses the Channels route by its shipped name", () => {
    expect(CHANNELS_ONBOARDING_INTENT).toBe("add-channels");
  });

  /**
   * The instruction a reader pastes has to stay one sentence across every
   * surface — only the route may differ. Rebuilding it here instead of reusing
   * the canonical string is how six copies across three repos drifted apart the
   * last time.
   */
  it("reuses the canonical instruction and only adds the route", () => {
    expect(createChannelsOnboardingPrompt("abc123abc123")).toBe(
      INTELLIGENCE_ONBOARDING_PROMPT.replace(
        "onboard start --run <run-id>",
        `onboard start --intent ${CHANNELS_ONBOARDING_INTENT} --run abc123abc123`,
      ),
    );
  });

  /**
   * `copilotkit channels setup` prints `--intent` ahead of `--run`. The flags
   * compose in either order, so this pins the agreement rather than a
   * requirement: four surfaces printing one literally identical command is
   * worth more than the freedom to order two flags differently.
   */
  it("matches the flag order the CLI prints", () => {
    const commandLine = createChannelsOnboardingPrompt("abc123abc123")
      .split("\n")
      .find((line) => line.includes("npx"));
    expect(commandLine).toBe(
      `npx --yes copilotkit@latest onboard start --intent ${CHANNELS_ONBOARDING_INTENT} --run abc123abc123`,
    );
  });

  /**
   * Both omissions are the route's design, not an oversight here.
   *
   * `feature/channels/start` asks Slack or Teams as its own scripted question,
   * and it inspects the project for existing agent code rather than being told
   * a framework — it treats empty folders, agent-only folders and existing
   * CopilotKit apps as equally valid starts. Naming either would answer for a
   * developer who has not answered.
   */
  it("names neither the channel nor the agent framework", () => {
    const prompt = createChannelsOnboardingPrompt("abc123abc123");
    expect(prompt).not.toMatch(/slack|teams/i);
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
    const first = createChannelsOnboardingAttempt();
    const second = createChannelsOnboardingAttempt();

    expect(first.runId).toMatch(/^[0-9a-f]{12}$/);
    expect(second.runId).not.toBe(first.runId);
    expect(first.prompt).toContain(`--run ${first.runId}`);
  });
});
