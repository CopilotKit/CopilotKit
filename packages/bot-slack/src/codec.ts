import type { PlatformCodec } from "@copilotkit/bot";
import type { BotNode } from "@copilotkit/bot-ui";
import { renderSlackMessage } from "./render/block-kit.js";

/**
 * Pure Slack codec — the egress half (IR → Block Kit). Shared by the local
 * Slack adapter and, via the Connector Outbox (OSS-363), the managed reply
 * path, so rendering lives in one place. No Bolt, no Slack credentials.
 *
 * TODO(OSS-363): add `normalizeIngress` once the pure Slack event → neutral
 * mapping is extracted from the Bolt listener.
 */
export const slackCodec: PlatformCodec = {
  platform: "slack",
  renderEgress: (ir: BotNode[]) => renderSlackMessage(ir),
};
