/**
 * Rules that pick which renderer draws a tool call, an activity message, or a
 * custom message.
 *
 * These functions hold no state and never call `render`. React, Vue, and
 * Angular call them so the three chat views pick the same renderer.
 */
import type { Message } from "@ag-ui/core";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import type { CopilotKitCore } from "../core/core";
import type {
  ActivityMessageRendererDef,
  CustomMessageRendererDef,
  CustomMessageRendererPosition,
  CustomMessageRenderProps,
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
 * does not try the next renderer. Use {@link ɵmatchActivityRenderer} to learn
 * why nothing matched.
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
  R extends ActivityMessageRendererDef<unknown>,
>(renderers: readonly R[], query: ɵActivityRendererQuery) {
  const match = ɵmatchActivityRenderer(renderers, query);
  if (!match.ok) return null;
  return { renderer: match.renderer, content: match.content };
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
  R extends CustomMessageRendererDef,
>(renderers: readonly R[], agentId: string) {
  const scoped = renderers.filter((renderer) => renderer.agentId === agentId);
  const unscoped = renderers.filter(
    (renderer) => renderer.agentId === undefined,
  );

  return [...scoped, ...unscoped];
}

/** What {@link ɵfindActivityRenderer} needs to know about the message. */
export type ɵActivityRendererLookup = Omit<ɵActivityRendererQuery, "content">;

/**
 * Find the renderer for an activity type, without validating any content.
 * The rules are those of {@link ɵresolveActivityRenderer}.
 *
 * @param renderers - Registered renderers in registration order.
 * @param lookup - The activity type and the current agent.
 * @returns The renderer, or `null` when none matches.
 */
export function ɵfindActivityRenderer<
  R extends { activityType: string; agentId?: string },
>(renderers: readonly R[], lookup: ɵActivityRendererLookup) {
  const { activityType, agentId } = lookup;
  const sameType = renderers.filter(
    (renderer) => renderer.activityType === activityType,
  );
  return (
    sameType.find((candidate) => candidate.agentId === agentId) ??
    sameType.find((candidate) => candidate.agentId === undefined) ??
    renderers.find((candidate) => candidate.activityType === WILDCARD) ??
    null
  );
}

/** Why {@link ɵmatchActivityRenderer} found nothing to draw. */
export type ɵActivityRendererFailureReason = "none" | "invalid" | "async";

/**
 * Find the renderer for an activity message and validate the content with
 * its `content` schema, saying why when nothing can draw.
 *
 * @param renderers - Registered renderers in registration order.
 * @param query - The activity type, the current agent, and the raw content.
 * @returns `{ ok: true, renderer, content }` with the validated content, or
 *   `{ ok: false, reason }`: `"none"` when no renderer matches, `"invalid"`
 *   when the content fails the schema (with its `issues`), `"async"` when the
 *   schema validates asynchronously, which the chat does not support.
 */
export function ɵmatchActivityRenderer<
  R extends ActivityMessageRendererDef<unknown>,
>(renderers: readonly R[], query: ɵActivityRendererQuery) {
  const renderer = ɵfindActivityRenderer(renderers, query);
  if (renderer === null) {
    return { ok: false, reason: "none" } as const;
  }
  const result = renderer.content["~standard"].validate(query.content);
  if (result instanceof Promise) {
    return { ok: false, reason: "async", renderer } as const;
  }
  if (result.issues) {
    return {
      ok: false,
      reason: "invalid",
      renderer,
      issues: result.issues,
    } as const;
  }
  return { ok: true, renderer, content: result.value } as const;
}

/**
 * The development warning for an activity message that has a renderer but
 * drew nothing, or `null` when no renderer matched (nothing to explain).
 *
 * @param activityType - The message's activity type.
 * @param failure - The failed result of {@link ɵmatchActivityRenderer}.
 * @returns `{ message, details }`: log `console.warn(message, ...details)`.
 *   `details` holds the schema issues when there are any.
 */
export function ɵdescribeActivityRendererFailure(
  activityType: string,
  failure: {
    reason: ɵActivityRendererFailureReason;
    issues?: readonly unknown[];
  },
) {
  switch (failure.reason) {
    case "none":
      return null;
    case "async":
      return {
        message: `[CopilotKit] Async content validation is not supported for activity message '${activityType}'.`,
        details: [],
      };
    case "invalid":
      return {
        message: `[CopilotKit] Failed to parse content for activity message '${activityType}':`,
        details: failure.issues ? [failure.issues] : [],
      };
  }
}

/**
 * The agent a chat's custom message renderers draw for, and the renderers to
 * try for it, in order (see {@link ɵresolveCustomMessageRenderers}). A chat
 * with no agent id, or an empty one, uses the default agent.
 *
 * Try each renderer in turn and show the first that draws something.
 *
 * @param renderers - Registered renderers in registration order.
 * @param chatAgentId - The agent the chat is configured for, if any.
 */
export function ɵresolveCustomMessageRenderContext<
  R extends CustomMessageRendererDef,
>(renderers: readonly R[], chatAgentId: string | undefined) {
  const agentId = chatAgentId || DEFAULT_AGENT_ID;
  return {
    agentId,
    renderers: ɵresolveCustomMessageRenderers(renderers, agentId),
  };
}

/** The run lookups {@link ɵgetCustomMessageRenderProps} needs from core. */
export type ɵCustomMessageRunSource = Pick<
  CopilotKitCore,
  "getRunIdForMessage" | "getRunIdsForThread" | "getStateByRun"
>;

/**
 * The props a custom message renderer gets for one message: the run that
 * produced it, its place in the conversation and in the run, and the agent
 * state of that run.
 *
 * When core knows no run for the message, the run is the thread's latest
 * run, and with no run at all `runId` reads `missing-run-id:<message id>`,
 * the message counts as the only one in its run, and `stateSnapshot` is
 * `undefined`. A message the agent does not hold has index 0.
 *
 * `stateSnapshot` is a getter that clones the run state on first read, so a
 * renderer that never reads it costs nothing. Spreading the props reads it.
 *
 * @param core - The core that recorded the runs.
 * @param params - The chat's agent (from
 *   {@link ɵresolveCustomMessageRenderContext}) and thread, the agent instance
 *   that holds the messages (if any), the message, and where the renderer
 *   draws.
 *
 * @example
 * ```ts
 * const props = ɵgetCustomMessageRenderProps(core, {
 *   agentId, threadId, agent: core.getAgent(agentId), message, position: "after",
 * });
 * ```
 */
export function ɵgetCustomMessageRenderProps(
  core: ɵCustomMessageRunSource,
  params: {
    agentId: string;
    threadId: string;
    agent: { messages: readonly Message[] } | undefined;
    message: Message;
    position: CustomMessageRendererPosition;
  },
) {
  const { agentId, threadId, agent, message, position } = params;
  const resolvedRunId =
    core.getRunIdForMessage(agentId, threadId, message.id) ??
    core.getRunIdsForThread(agentId, threadId).at(-1);
  const messages = agent?.messages ?? [];
  const messageIdsInRun =
    resolvedRunId === undefined
      ? [message.id]
      : messages
          .filter(
            (candidate) =>
              core.getRunIdForMessage(agentId, threadId, candidate.id) ===
              resolvedRunId,
          )
          .map((candidate) => candidate.id);
  const messageIndex = Math.max(
    0,
    messages.findIndex((candidate) => candidate.id === message.id),
  );

  let stateSnapshot: unknown;
  let isStateSnapshotRead = false;
  const props: CustomMessageRenderProps = {
    message,
    position,
    runId: resolvedRunId ?? `missing-run-id:${message.id}`,
    messageIndex,
    messageIndexInRun:
      resolvedRunId === undefined
        ? 0
        : Math.max(messageIdsInRun.indexOf(message.id), 0),
    numberOfMessagesInRun:
      resolvedRunId === undefined ? 1 : messageIdsInRun.length,
    agentId,
    get stateSnapshot() {
      if (!isStateSnapshotRead) {
        isStateSnapshotRead = true;
        stateSnapshot =
          resolvedRunId === undefined
            ? undefined
            : core.getStateByRun(agentId, threadId, resolvedRunId);
      }
      return stateSnapshot;
    },
  };
  return props;
}
