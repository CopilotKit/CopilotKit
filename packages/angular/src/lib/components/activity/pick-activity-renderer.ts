import { ɵresolveActivityRenderer } from "@copilotkit/core";
import { ɵanySchema } from "@copilotkit/shared";
import type { RenderActivityMessageConfig } from "../../activity-renderer";

export interface PickActivityRendererOptions {
  activityType: string;
  agentId?: string;
  renderers: readonly RenderActivityMessageConfig[];
}

/**
 * Resolve the activity renderer for an activity type, with the same rules as
 * React and Vue.
 *
 * Precedence (first match wins within each tier, in registration order):
 * 1. a renderer for `activityType` registered for `agentId`
 * 2. a renderer for `activityType` without an `agentId` (global)
 * 3. the first `"*"` wildcard renderer, from any agent
 *
 * This only picks the renderer. It does not validate the content: the caller
 * runs the renderer's `content.safeParse`, so it can report a failure.
 *
 * Kept internal for now (not part of the public API); it can be exposed later
 * without a breaking change if there is demand for a headless resolver.
 */
export function pickActivityRenderer(options: PickActivityRendererOptions) {
  const { activityType, agentId, renderers } = options;
  // Core validates with a Standard Schema. A pass-through schema keeps core to
  // the lookup and leaves validation with the caller.
  const candidates = renderers.map((config) => ({
    activityType: config.activityType,
    agentId: config.agentId,
    content: ɵanySchema,
    render: config,
  }));
  const match = ɵresolveActivityRenderer(candidates, {
    activityType,
    agentId,
    content: undefined,
  });

  return match?.renderer.render;
}
