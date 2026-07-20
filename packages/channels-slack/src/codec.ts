import type { PlatformCodec } from "@copilotkit/channels-core";
import { renderSlackMessage } from "./render/block-kit.js";
import { normalizeSlackEvent } from "./ingress-normalize.js";
import type { SlackNeutralEvent } from "./ingress-normalize.js";

/**
 * Pure Slack codec — both directions, no Bolt and no Slack credentials. Shared
 * by the local Slack adapter and (via the Connector Outbox / webhook ingress,
 * OSS-362/363) the managed path, so platform semantics live in one place:
 *
 * - `renderEgress`: IR → Block Kit.
 * - `normalizeIngress`: raw Slack payload (Events API envelope or slash-command
 *   body) → platform-neutral ingress event. `normalizeIngress` is a Slack
 *   extension on top of the generic egress-only {@link PlatformCodec}; the
 *   caller applies its own policy/entitlement gating and builds the route.
 */
export const slackCodec: PlatformCodec & {
  normalizeIngress: (
    body: Parameters<typeof normalizeSlackEvent>[0],
    botUserId?: string,
  ) => SlackNeutralEvent | undefined;
} = {
  platform: "slack",
  renderEgress: renderSlackMessage,
  normalizeIngress: normalizeSlackEvent,
};
