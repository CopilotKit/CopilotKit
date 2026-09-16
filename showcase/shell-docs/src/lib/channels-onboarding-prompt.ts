import {
  createIntelligenceOnboardingPrompt,
  createOnboardingRunId,
} from "./intelligence-onboarding-prompt";

/**
 * The Channels route into the CLI's onboarding graph.
 *
 * Channel pages already carried the generic `onboard start` prompt, and it
 * could not succeed. `onboardingFrontendSlug` maps `slack` and `teams` to
 * nothing on purpose — the graph had no node for either, and a prompt naming a
 * channel the CLI cannot reach promises a path it cannot walk. So the copied
 * text never said which channel the reader was on, and every run began by
 * asking what the page had already answered.
 *
 * `feature/channels/start` gives the graph that node. This module owns the one
 * string that reaches it, so the page-tools pill and the Channels overview card
 * copy the same text and cannot drift apart.
 *
 * The run id is minted per click by the callers, never here: one clipboard
 * write is one onboarding attempt, and a value hoisted to module scope would
 * collapse every reader's attempt into a single funnel row.
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

/** Whether a docs frontend id is served by the Channels intent route. */
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
