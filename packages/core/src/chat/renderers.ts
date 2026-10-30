/**
 * Rules that pick which renderer draws a tool call, an activity message, or a
 * custom message.
 *
 * These functions hold no state and never call `render`. React, Vue, and
 * Angular call them so the three chat views pick the same renderer.
 */
import type {
  ActivityMessageRendererDef,
  CustomMessageRendererDef,
} from "./renderer-types";

/** Name or activity type that matches anything. */
const WILDCARD = "*";

/**
 * Find the renderer that draws a tool call.
 *
 * The first rule that matches wins:
 *
 * 1. A renderer for `toolName` with `agentId` equal to the current agent.
 * 2. A renderer for `toolName` with no `agentId`.
 * 3. The first renderer for `toolName` from any other agent.
 * 4. The first `"*"` renderer, from any agent.
 *
 * Inside each rule, the earlier renderer in the list wins.
 *
 * @param renderers - Registered renderers in registration order. If you
 *   build tiers (for example app renderers before built-in ones), flatten
 *   them into one ordered list first.
 * @param toolName - Name of the tool the agent called.
 * @param agentId - The agent that owns the chat. The caller picks the
 *   default: React and Vue pass `DEFAULT_AGENT_ID` when the chat has no
 *   agent. With `undefined`, rule 1 matches the same renderers as rule 2.
 * @returns The renderer, or `null` when no renderer matches. Draw nothing
 *   for `null`.
 *
 * @example
 * ```ts
 * const renderer = ɵresolveToolCallRenderer(
 *   core.renderToolCalls,
 *   toolCall.function.name,
 *   chatAgentId ?? DEFAULT_AGENT_ID,
 * );
 * ```
 */
export function ɵresolveToolCallRenderer<
  R extends { name: string; agentId?: string },
>(renderers: readonly R[], toolName: string, agentId: string | undefined) {
  const named = renderers.filter((renderer) => renderer.name === toolName);

  return (
    named.find((renderer) => renderer.agentId === agentId) ??
    named.find((renderer) => !renderer.agentId) ??
    named[0] ??
    renderers.find((renderer) => renderer.name === WILDCARD) ??
    null
  );
}

/** What {@link ɵresolveActivityRenderer} needs to know about the message. */
export interface ɵActivityRendererQuery {
  /** Activity type of the message. */
  activityType: string;
  /** The agent that owns the chat. Omit it when the chat has no agent. */
  agentId?: string;
  /** The message content, before validation. */
  content: unknown;
}

/**
 * Find the renderer that draws an activity message, and validate the
 * message content with that renderer's `content` schema.
 *
 * The first rule that matches picks the renderer:
 *
 * 1. A renderer for `activityType` with `agentId` equal to the current agent.
 * 2. A renderer for `activityType` with no `agentId`.
 * 3. The first `"*"` renderer, from any agent.
 *
 * A renderer for `activityType` that belongs to a different agent never
 * matches. Inside each rule, the earlier renderer in the list wins.
 *
 * Only the picked renderer validates the content. When validation fails, or
 * the schema validates asynchronously, the result is `null`. The function
 * does not try the next renderer.
 *
 * @param renderers - Registered renderers in registration order.
 * @param query - The activity type, the current agent, and the raw content.
 * @returns `{ renderer, content }`, where `content` is the value the schema
 *   returned. Pass that value to `render`, not the raw content. Returns
 *   `null` when no renderer matches or validation does not pass.
 *
 * @example
 * ```ts
 * const match = ɵresolveActivityRenderer(core.renderActivityMessages, {
 *   activityType: message.activityType,
 *   agentId,
 *   content: message.content,
 * });
 * if (match) draw(match.renderer.render, match.content);
 * ```
 */
export function ɵresolveActivityRenderer<
  R extends ActivityMessageRendererDef<unknown, unknown>,
>(renderers: readonly R[], query: ɵActivityRendererQuery) {
  const { activityType, agentId, content } = query;
  const sameType = renderers.filter(
    (renderer) => renderer.activityType === activityType,
  );
  const renderer =
    sameType.find((candidate) => candidate.agentId === agentId) ??
    sameType.find((candidate) => candidate.agentId === undefined) ??
    renderers.find((candidate) => candidate.activityType === WILDCARD);

  if (renderer === undefined) return null;

  const result = renderer.content["~standard"].validate(content);
  if (result instanceof Promise) return null;
  if (result.issues) return null;

  return { renderer, content: result.value };
}

/**
 * List the custom message renderers that apply to an agent, in the order to
 * try them.
 *
 * The list keeps renderers with no `agentId` and renderers for `agentId`.
 * Renderers for `agentId` come first. Inside each group, registration order
 * stays the same.
 *
 * The framework tries each renderer in this order and shows the first one
 * that draws something (a non-null result).
 *
 * @param renderers - Registered renderers in registration order.
 * @param agentId - The agent that owns the chat.
 * @returns A new array. Empty when no renderer applies.
 *
 * @example
 * ```ts
 * const candidates = ɵresolveCustomMessageRenderers(
 *   core.renderCustomMessages,
 *   agentId,
 * );
 * ```
 */
export function ɵresolveCustomMessageRenderers<
  R extends CustomMessageRendererDef<unknown>,
>(renderers: readonly R[], agentId: string) {
  const scoped = renderers.filter((renderer) => renderer.agentId === agentId);
  const unscoped = renderers.filter(
    (renderer) => renderer.agentId === undefined,
  );

  return [...scoped, ...unscoped];
}
