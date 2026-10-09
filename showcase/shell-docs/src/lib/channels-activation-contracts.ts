import type { FrontendIcon } from "./frontend-options";

export const CHANNELS_ACTIVATION_EVENTS = {
  channelSelected: "docs.channels_activation_channel_selected",
  backendSelected: "docs.channels_activation_backend_selected",
  setupGuideOpened: "docs.channels_activation_setup_guide_opened",
  promptCopied: "docs.channels_activation_prompt_copied",
  openTagClicked: "docs.channels_activation_opentag_clicked",
  /**
   * Impression, so `promptCopied` has a denominator. Both entry points sit
   * below the fold on their pages, so a surface nobody scrolls to and a surface
   * everybody ignores are indistinguishable without this. Emitted by both the
   * landing strip and the overview panel, separated by `surface`.
   */
  viewed: "docs.channels_activation_viewed",
} as const;

/**
 * Which road into onboarding an event came from. Every Channels entry point
 * emits the same events with one of these, including copilotkit.ai/channels,
 * which sends its own event name with the same property so the two can be
 * unioned into one funnel.
 */
export const CHANNELS_ACTIVATION_SURFACES = {
  docsLandingStrip: "docs_landing_strip",
  docsChannelsOverview: "docs_channels_overview",
} as const;

export const CHANNELS_ACTIVATION_CHANNELS = [
  { id: "slack", label: "Slack", icon: "slack" },
  { id: "teams", label: "Microsoft Teams", icon: "teams" },
] as const satisfies readonly {
  id: ChannelsActivationChannelId;
  label: string;
  icon: FrontendIcon;
}[];

export const CHANNELS_OPENTAG_HREF = "https://github.com/CopilotKit/OpenTag";

export type ChannelsActivationChannelId = "slack" | "teams";

export interface ChannelsActivationBackendOption {
  slug: string;
  label: string;
  logo: string | null;
  guideHrefs: Record<ChannelsActivationChannelId, string>;
}

export function getChannelsActivationGuideHref(
  channel: ChannelsActivationChannelId,
  backend: ChannelsActivationBackendOption,
): string {
  return backend.guideHrefs[channel];
}

/**
 * The onboarding guide every Channels entry point points at — the docs surfaces,
 * copilotkit.ai/channels, and the channels-sdk README. Hosted on the marketing
 * site so it is one file fetched at the moment an agent needs it, rather than a
 * workflow copied into six places that drift apart.
 */
export const CHANNELS_GUIDE_URL = "https://copilotkit.ai/channels-guide.md";

/*
 * `CHANNELS_BUILD_PROMPT` used to live here: a pointer at the guide above,
 * deliberately unparameterised, because the CLI had no Channels route and a
 * prompt naming one would have promised a path it could not walk.
 *
 * The Channels intent route replaces it. Every docs surface now copies
 * `createChannelsOnboardingAttempt` from `channels-onboarding-prompt.ts`, which
 * reaches the graph, carries a run id, and reports friction back — none of
 * which a fetched Markdown file could do.
 *
 * `CHANNELS_GUIDE_URL` is kept rather than deleted: its remaining consumers are
 * outside this repo (the marketing site, the channels-sdk README, and a skill),
 * and retiring the hosted guide is a decision for whoever owns those, not a
 * side effect of this change.
 */
