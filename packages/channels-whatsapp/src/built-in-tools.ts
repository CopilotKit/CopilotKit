import type { ChannelTool } from "@copilotkit/channels-core";

/**
 * WhatsApp ships no built-in tools in v1. Unlike Slack (which provides
 * `lookup_slack_user` for @-mentions), WhatsApp exposes no user directory, so
 * there is nothing platform-generic to register. Apps add their own tools.
 */
export const defaultWhatsAppTools: ChannelTool[] = [];
