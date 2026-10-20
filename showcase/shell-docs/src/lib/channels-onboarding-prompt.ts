import {
  createIntelligenceOnboardingPrompt,
  createOnboardingRunId,
} from "./intelligence-onboarding-prompt";

/**
 * The prompt a Channel docs page copies.
 *
 * Same small `onboard start` command as the website CTA and the repo README.
 * No `--intent` and no extra Channel sentence. The root graph offers Slack
 * and Microsoft Teams when the project has no frontend, and it uses a Slack
 * or Teams docs page as the named frontend.
 *
 * This module owns that string so the page-tools pill and the Channels
 * overview card cannot drift apart. The run id is minted per click by the
 * callers, never here.
 */

/**
 * Docs frontend ids that are chat channels rather than application frontends.
 *
 * Kept as its own list rather than reusing `CHANNEL_FRONTENDS` from
 * `channel-guide-routes.ts`: that one answers which routes the channel guide
 * serves, this one answers which prompt a page hands its reader. They agree
 * today and may not forever — a channel can gain docs before the graph gains
 * an intent for it, and that page must keep the generic prompt until it does.
 */
export const CHANNEL_ONBOARDING_IDS = ["slack", "teams"] as const;

export type ChannelOnboardingId = (typeof CHANNEL_ONBOARDING_IDS)[number];

/** Whether a docs frontend id is a Slack or Teams Channel page. */
export function isChannelOnboardingId(
  id: string | undefined,
): id is ChannelOnboardingId {
  return (
    id !== undefined &&
    (CHANNEL_ONBOARDING_IDS as readonly string[]).includes(id)
  );
}

/**
 * The prompt a channel page copies.
 *
 * Same small onboard command as the website CTA and the repo README. No
 * `--intent` and no extra Channel sentence. The root graph offers Slack and
 * Microsoft Teams when it asks which frontend they want.
 */
export function createChannelsOnboardingPrompt(runId: string): string {
  return createIntelligenceOnboardingPrompt(runId);
}

/** Mints a run id and returns the prompt and id together, for one click. */
export function createChannelsOnboardingAttempt(): {
  runId: string;
  prompt: string;
} {
  const runId = createOnboardingRunId();
  return { runId, prompt: createChannelsOnboardingPrompt(runId) };
}
