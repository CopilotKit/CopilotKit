import type { PlatformCodec } from "@copilotkit/channels-core";
import type { ChannelNode } from "@copilotkit/channels-ui";
import { isPlainText, renderAdaptiveCard } from "./render/adaptive-card.js";
import { renderTeamsMarkdown } from "./render/markdown.js";

/** Credential-free Teams renderer for the managed Connector Outbox path. */
export const teamsCodec: PlatformCodec = {
  platform: "teams",
  renderEgress(ir: ChannelNode[]): { text: string } | { card: unknown } {
    return isPlainText(ir)
      ? { text: renderTeamsMarkdown(ir) }
      : { card: renderAdaptiveCard(ir) };
  },
};
