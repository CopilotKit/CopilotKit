/**
 * D5 representative map -- selects which D5FeatureType literals are
 * eligible for D5 spot-check runs.
 *
 * D5 and D6 share the same fixture set. D5 picks one representative
 * per feature category; D6 runs all files. This map controls which
 * feature types D5 includes -- any D5FeatureType NOT present here is
 * filtered out before the driver's iteration loop.
 *
 * Keys are actual D5FeatureType literals (not category names) so the
 * driver can filter with a simple `D5_REPRESENTATIVES[ft] !== undefined`.
 * The value is the representative fixture filename in d6/<slug>/.
 */

import type { D5FeatureType } from "./d5-registry.js";

/** Maps D5FeatureType literal to the representative fixture filename in d6/<slug>/. */
export const D5_REPRESENTATIVES: Readonly<
  Partial<Record<D5FeatureType, string>>
> = {
  "agent-config": "agent-config.json",
  "agentic-chat": "agentic-chat.json",
  auth: "auth.json",
  "beautiful-chat-bar-chart": "beautiful-chat.json",
  "beautiful-chat-pie-chart": "beautiful-chat.json",
  "beautiful-chat-schedule-meeting": "beautiful-chat.json",
  "beautiful-chat-search-flights": "beautiful-chat.json",
  "beautiful-chat-toggle-theme": "beautiful-chat.json",
  byoc: "_from-feature-parity.json",
  "chat-css": "chat-css.json",
  "chat-slots": "chat-slots.json",
  "frontend-tools": "frontend-tools.json",
  "frontend-tools-async": "frontend-tools-async.json",
  "gen-ui-a2ui-fixed": "render-a2ui.json",
  "gen-ui-agent": "gen-ui-agent.json",
  "gen-ui-custom": "render-a2ui.json", // pie chart fixtures shared with render-a2ui
  "gen-ui-declarative": "gen-ui-tool-based.json",
  "a2ui-recovery": "a2ui-recovery.json",
  "gen-ui-headless-complete": "headless-complete.json",
  "gen-ui-interrupt": "hitl-in-chat.json", // schedule_meeting fixtures shared with hitl
  "gen-ui-open": "gen-ui-custom.json",
  "gen-ui-open-advanced": "gen-ui-custom.json",
  "headless-simple": "headless-simple.json",
  "hitl-approve-deny": "hitl-approve-deny.json",
  "hitl-text-input": "hitl-in-chat.json",
  "interrupt-headless": "hitl-in-chat.json", // schedule_meeting fixtures shared with hitl
  "mcp-apps": "mcp-apps.json",
  multimodal: "agentic-chat.json",
  "prebuilt-popup": "agentic-chat.json",
  "prebuilt-sidebar": "agentic-chat.json",
  "readonly-state-context": "readonly-state.json",
  "reasoning-display": "reasoning-display.json",
  "shared-state-read": "shared-state-read.json",
  "shared-state-streaming": "shared-state-streaming.json",
  "shared-state-write": "shared-state-write.json",
  subagents: "subagents.json",
  "tool-rendering": "tool-rendering.json",
  "tool-rendering-custom-catchall": "tool-rendering.json",
  "tool-rendering-default-catchall": "tool-rendering-default-catchall.json",
  "tool-rendering-reasoning-chain": "tool-rendering-reasoning-chain.json",
  voice: "voice.json",
};

/**
 * Look up the representative fixture filename for a feature type.
 * Returns undefined if the feature type has no configured representative.
 */
export function getD5Representative(
  featureType: D5FeatureType,
): string | undefined {
  return D5_REPRESENTATIVES[featureType];
}
