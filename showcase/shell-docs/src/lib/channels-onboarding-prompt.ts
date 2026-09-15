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
 * The Channels intent route gives the graph that node. This module owns the one
 * string that reaches it, so the page-tools pill and the Channels overview card
 * copy the same text and cannot drift apart.
 *
 * The run id is minted per click by the callers, never here: one clipboard
 * write is one onboarding attempt, and a value hoisted to module scope would
 * collapse every reader's attempt into a single funnel row.
 */

/* -------------------------------------------------------------------------
 * PLACEHOLDER — reconcile with the PE-19 CLI pull request before shipping.
 *
 * `CHANNELS_ONBOARDING_INTENT` is the only provisional value in this file;
 * everything below it is final. The source of truth is
 * `ONBOARDING_INTENT_ROOTS` in the Intelligence repo at
 * `apps/cli/onboarding-intents.cjs`. That map carries seven intents today and
 * none of them is Channels, so this name cannot be verified yet — it follows
 * the `add-<feature>` shape the other seven use.
 *
 * `channels-onboarding-prompt.test.ts` asserts the flag below, so the branch
 * stays green while it is provisional and fails the moment someone edits the
 * intent name without also declaring it confirmed.
 * ------------------------------------------------------------------------- */
export const CHANNELS_ONBOARDING_INTENT = "add-channels";

/** Set to false in the same commit that confirms the intent name against PE-19. */
export const CHANNELS_INTENT_IS_PROVISIONAL = true;

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
 * Built from `createIntelligenceOnboardingPrompt` rather than restating the
 * instruction, so the sentence a reader pastes stays byte-identical to every
 * other surface's and only the route differs. `--intent` composes with `--run`:
 * `onboard start` parses both, and the intent then rides along as a property on
 * every event the run reports.
 */
export function createChannelsOnboardingPrompt(runId: string): string {
  return `${createIntelligenceOnboardingPrompt(runId)} --intent ${CHANNELS_ONBOARDING_INTENT}`;
}

/**
 * The sentence naming which channel the reader is setting up.
 *
 * Shaped like `frameworkPromptSuffix` and `frontendPromptSuffix` and appended
 * after them, because the graph reads the selections in that order. Unlike the
 * frontend suffix this one never returns "": a caller only reaches it once
 * `isChannelOnboardingId` has confirmed the route exists.
 */
export function channelPromptSuffix(
  id: ChannelOnboardingId,
  displayName: string,
): string {
  return ` The developer selected the ${displayName} channel (\`${id}\`).`;
}

/** Mints a run id and returns the prompt and id together, for one click. */
export function createChannelsOnboardingAttempt(
  id: ChannelOnboardingId,
  displayName: string,
): { runId: string; prompt: string } {
  const runId = createOnboardingRunId();
  return {
    runId,
    prompt:
      createChannelsOnboardingPrompt(runId) +
      channelPromptSuffix(id, displayName),
  };
}
