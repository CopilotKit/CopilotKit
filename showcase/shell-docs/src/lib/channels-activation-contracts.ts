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
 * The skill that owns first-time Channels onboarding end to end. Canonical
 * source lives in `CopilotKit/channels-sdk` and is mirrored into this repo's
 * `skills/` directory, which is what `copilotkit skills install` distributes.
 */
export const CHANNELS_ONBOARDING_SKILL = "setup-slack-channel";

/**
 * Installs that skill without prompting. `-y` respects `--skill`, so this
 * installs exactly one skill rather than dropping the developer into a picker
 * of everything CopilotKit publishes. `@latest` is not optional: a globally
 * installed or npx-cached older CLI shadows the current one and fails with an
 * unrelated "unknown option" error.
 *
 * The installer detects the coding agent it is running inside, so `--agent` is
 * deliberately omitted.
 */
export const CHANNELS_ONBOARDING_INSTALL_COMMAND = `npx copilotkit@latest skills install --skill ${CHANNELS_ONBOARDING_SKILL} -y`;

/**
 * A pointer, deliberately not a workflow.
 *
 * This prompt used to carry the whole setup as prose, and so did five other
 * surfaces across three repos. They drifted apart, and each one went stale the
 * moment the CLI moved — which is how developers ended up being told to run
 * commands that no longer exist. Two sentences naming a skill cannot drift, and
 * the workflow they point at is corrected in exactly one place.
 */
export function buildChannelsActivationPrompt({
  channelLabel,
  backendLabel,
}: {
  channelLabel: string;
  backendLabel: string;
}): string {
  const { command, instruction } = buildChannelsActivationPromptParts({
    channelLabel,
    backendLabel,
  });

  return `Run \`${command}\`, then ${instruction}`;
}

/**
 * Split so the UI can show the command as a command and the ask as prose. A
 * single wrapped monospace paragraph reads like a rendering bug, and the two
 * halves are genuinely different things: one is typed by a machine, one is
 * addressed to it.
 *
 * `instruction` carries no leading word, so the clipboard string can join it
 * after a comma while the UI leads with a capitalised "Then" on its own line.
 */
export function buildChannelsActivationPromptParts({
  channelLabel,
  backendLabel,
}: {
  channelLabel: string;
  backendLabel: string;
}): { command: string; instruction: string } {
  return {
    command: CHANNELS_ONBOARDING_INSTALL_COMMAND,
    instruction: `follow that skill to build your first CopilotKit Channels agent and connect it to ${channelLabel} using ${backendLabel}.`,
  };
}
