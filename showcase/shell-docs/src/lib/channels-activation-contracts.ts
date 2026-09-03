import type { FrontendIcon } from "./frontend-options";

export const CHANNELS_ACTIVATION_EVENTS = {
  channelSelected: "docs.channels_activation_channel_selected",
  backendSelected: "docs.channels_activation_backend_selected",
  setupGuideOpened: "docs.channels_activation_setup_guide_opened",
  promptCopied: "docs.channels_activation_prompt_copied",
  openTagClicked: "docs.channels_activation_opentag_clicked",
  /**
   * Impression, so `promptCopied` has a denominator. The entry point sits
   * below the fold on its page, so a surface nobody scrolls to and a surface
   * everybody ignores are indistinguishable without this. Emitted by the
   * overview panel.
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

/**
 * A pointer, deliberately not a workflow, and deliberately unparameterised.
 *
 * These surfaces used to carry the whole setup as prose — six copies across
 * three repos, which drifted and went stale against the CLI independently.
 *
 * The channel and backend the reader picked are not interpolated: the guide asks
 * for both itself. A pointer that named them would be promising coverage on the
 * page's behalf, which is exactly what made the earlier skill-based pointer
 * wrong for Teams — it named a skill scoped to Slack.
 */
export const CHANNELS_BUILD_PROMPT = `Read ${CHANNELS_GUIDE_URL} and help the user build their first channel`;
