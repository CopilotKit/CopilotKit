import type { KnownBlock } from "@slack/types";
import type { ActivityMessage } from "@ag-ui/core";
import type { StandardSchemaV1 } from "./standard-schema.js";

/**
 * The Slack-side analogue of `ReactActivityMessageRenderer` from
 * `@copilotkit/react-core`. Activity messages are the canonical AG-UI
 * primitive for "structured non-text agent output" — the agent emits
 * an `ActivityMessage` with `role: "activity"` and an `activityType`
 * discriminator, and a host renders it however that host renders UI.
 * A2UI is one well-known `activityType` (`"a2ui-surface"`); apps can
 * define their own.
 *
 * Renderers are looked up by `activityType` (with `"*"` as wildcard)
 * and, when set, by `agentId`. Exact `activityType` matches win over
 * `"*"`. Within a tie, agent-scoped renderers win over unscoped ones.
 * (Same precedence as the React-side registry.)
 */
export interface ActivityMessageRenderer<TContent = Record<string, unknown>> {
  /**
   * Activity type to match when rendering. Use `"*"` as a wildcard
   * (e.g. for a debug renderer that should fire on every activity
   * type that nothing else matched).
   */
  activityType: string;
  /**
   * Optional agent ID to scope the renderer to a particular agent.
   * Omit to match any agent.
   */
  agentId?: string;
  /**
   * Optional Standard Schema for the activity content payload. When
   * provided, the bridge validates the incoming `content` before calling
   * `render` so renderers see a typed payload. When omitted, the raw
   * `content` record is passed through as-is.
   */
  content?: StandardSchemaV1<unknown, TContent>;
  /**
   * Render the activity message as Slack Block Kit. The bridge posts
   * the returned blocks via `chat.postMessage` (or `chat.update` if
   * this is a follow-up snapshot for a known surface — see the A2UI
   * renderer's per-surface message caching).
   *
   * Pure: no side effects, no Slack-API calls. Delivery is the
   * bridge's job.
   */
  render(args: {
    activityType: string;
    content: TContent;
    message: ActivityMessage;
  }): KnownBlock[];
}

/**
 * Identity factory — returns the renderer back, but lets TypeScript
 * infer the generic content type from the schema so callers don't
 * have to write it out. Mirrors `defineSlackComponent` /
 * `defineHumanInTheLoop` ergonomics.
 */
export function defineActivityMessageRenderer<TContent>(
  r: ActivityMessageRenderer<TContent>,
): ActivityMessageRenderer<TContent> {
  return r;
}

/**
 * Pick the best-matching renderer for an activity message.
 *
 * Precedence (highest → lowest):
 *   1. activityType exact + agentId exact
 *   2. activityType exact + (no agentId on renderer)
 *   3. activityType "*"   + agentId exact
 *   4. activityType "*"   + (no agentId on renderer)
 *
 * Returns `undefined` if nothing matches.
 */
export function selectActivityRenderer(
  renderers: ReadonlyArray<ActivityMessageRenderer<any>>,
  activityType: string,
  agentId?: string,
): ActivityMessageRenderer<any> | undefined {
  const tiers: Array<(r: ActivityMessageRenderer<any>) => boolean> = [
    (r) => r.activityType === activityType && r.agentId === agentId,
    (r) => r.activityType === activityType && r.agentId == null,
    (r) => r.activityType === "*" && r.agentId === agentId,
    (r) => r.activityType === "*" && r.agentId == null,
  ];
  for (const tier of tiers) {
    const hit = renderers.find(tier);
    if (hit) return hit;
  }
  return undefined;
}
