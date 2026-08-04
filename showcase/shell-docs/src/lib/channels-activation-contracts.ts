import type { FrontendIcon } from "./frontend-options";

export const CHANNELS_ACTIVATION_EVENTS = {
  channelSelected: "docs.channels_activation_channel_selected",
  backendSelected: "docs.channels_activation_backend_selected",
  setupGuideOpened: "docs.channels_activation_setup_guide_opened",
  promptCopied: "docs.channels_activation_prompt_copied",
  openTagClicked: "docs.channels_activation_opentag_clicked",
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

export function buildChannelsActivationPrompt({
  channelLabel,
  backendLabel,
  guideUrl,
}: {
  channelLabel: string;
  backendLabel: string;
  guideUrl: string;
}): string {
  return `Build a working CopilotKit Channels integration for ${channelLabel} using ${backendLabel}.

Follow the Shell Docs setup guide: ${guideUrl}

Inspect the existing project before editing, preserve its agent architecture, implement the documented setup, run the relevant checks, and report any remaining provider credentials or platform configuration.`;
}
