import type { RenderActivityMessageConfig } from "../../activity-renderer";

export interface PickActivityRendererOptions {
  activityType: string;
  agentId?: string;
  renderers: readonly RenderActivityMessageConfig[];
}

/**
 * Resolve the activity renderer for an activity type.
 *
 * Precedence (first match wins within each tier, in registration order):
 * 1. a renderer for `activityType` registered for `agentId`
 * 2. a renderer for `activityType` without an `agentId` (global)
 * 3. the `"*"` wildcard renderer
 *
 * Note that the wildcard is matched regardless of its `agentId`, which differs
 * from `pickToolCallHandler`, where the wildcard is agent-scoped as well. This
 * preserves the behaviour `CopilotChatMessageView` has always had.
 *
 * Kept internal for now (not part of the public API); it can be exposed later
 * without a breaking change if there is demand for a headless resolver.
 */
export function pickActivityRenderer(
  options: PickActivityRendererOptions,
): RenderActivityMessageConfig | undefined {
  const { activityType, agentId, renderers } = options;
  const matches = renderers.filter(
    (candidate) => candidate.activityType === activityType,
  );

  return (
    matches.find((candidate) => candidate.agentId === agentId) ??
    matches.find((candidate) => candidate.agentId === undefined) ??
    renderers.find((candidate) => candidate.activityType === "*")
  );
}
