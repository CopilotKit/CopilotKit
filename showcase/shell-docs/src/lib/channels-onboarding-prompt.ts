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
 * The graph's Channels route, from `ONBOARDING_INTENT_ROOTS` in the
 * Intelligence repo at `apps/cli/onboarding-intents.cjs`, where it maps to
 * `feature/channels/start`.
 */
export const CHANNELS_ONBOARDING_INTENT = "add-channels";

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
 * other surface's and only the route differs. `--intent` is inserted ahead of
 * `--run` to match the command `copilotkit channels setup` prints, which is the
 * canonical form of this one-liner; the flags compose in either order, and
 * agreeing on one keeps the four surfaces literally identical.
 *
 * It names neither the channel nor the agent framework, and that is the whole
 * point rather than an omission:
 *
 * - `feature/channels/start` asks Slack or Teams as its own scripted question.
 *   Answering it here pre-empts a choice the reader has not made — the same
 *   reason the retired pointer refused to name a provider.
 * - The same node spawns a read-only subagent that inspects the project for
 *   existing agent code, runtime, package manager and versions. It also states
 *   that empty folders, agent-only folders and existing CopilotKit apps are all
 *   valid starts. A framework sentence would assert a selection the reader
 *   never made — on a channel page the framework is the route default, not a
 *   choice — and would contradict that stance.
 */
export function createChannelsOnboardingPrompt(runId: string): string {
  return createIntelligenceOnboardingPrompt(runId).replace(
    "onboard start --run",
    `onboard start --intent ${CHANNELS_ONBOARDING_INTENT} --run`,
  );
}

/** Mints a run id and returns the prompt and id together, for one click. */
export function createChannelsOnboardingAttempt(): {
  runId: string;
  prompt: string;
} {
  const runId = createOnboardingRunId();
  return { runId, prompt: createChannelsOnboardingPrompt(runId) };
}
