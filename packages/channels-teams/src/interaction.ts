/**
 * Adaptive Card `Action.Submit` decoding for the Teams adapter.
 *
 * A button rendered by {@link ../render/adaptive-card.renderButton} carries its
 * opaque minted action id (`ck:...`) and tiny `value` in the action's `data`.
 * When clicked, Teams delivers a **Message activity** whose `value` is that
 * `data` object (merged with any card inputs) and whose `text` is empty. These
 * helpers recognize and decode that activity so the engine's `awaitChoice`
 * waiter resolves.
 */

/** Minimal shape of the inbound Teams activity we read for interaction decoding. */
export interface TeamsActivityLike {
  value?: unknown;
  conversation?: { id?: string };
}

/** The `data` our buttons round-trip (see `render/adaptive-card.ts` `renderButton`). */
interface LegacyCardActionData {
  ckActionId?: string;
  value?: unknown;
}

interface CardActionData extends LegacyCardActionData {
  __copilotkit?: {
    version?: unknown;
    actionId?: unknown;
    value?: unknown;
  };
}

/**
 * Stable conversation key shared by ingress (`onTurn`) and interaction decoding
 * so the engine's `awaitChoice` waiters resolve. Teams gives one stable id per
 * conversation; **both paths MUST derive the key here**. A mismatch silently
 * strands the waiter. (The issue mandates a single shared helper.)
 */
export function conversationKeyOf(activity: TeamsActivityLike): string {
  return activity.conversation?.id ?? "";
}

/**
 * Recognize and parse an Adaptive Card `Action.Submit`. Returns the opaque
 * action id + button value when the activity carries our `ckActionId`, else
 * `undefined` (i.e. it's an ordinary chat message). Carries ONLY the opaque id
 * and the tiny button value: no resume-data smuggling; durability rides on the
 * engine's ActionStore keyed by that id.
 */
export function parseCardAction(
  activity: TeamsActivityLike,
):
  | { id: string; value: unknown; values?: Record<string, unknown> }
  | undefined {
  const data = activity.value as CardActionData | undefined;
  if (!data || typeof data !== "object") {
    return undefined;
  }
  const metadata = data.__copilotkit;
  if (
    metadata &&
    typeof metadata === "object" &&
    metadata.version === 1 &&
    typeof metadata.actionId === "string"
  ) {
    const { __copilotkit: _metadata, ...values } = data;
    return {
      id: metadata.actionId,
      value: metadata.value,
      ...(Object.keys(values).length > 0 ? { values } : {}),
    };
  }
  // Cards posted before the reserved envelope shipped have this flat shape.
  if (typeof data.ckActionId !== "string") return undefined;
  const { ckActionId: _id, value, ...values } = data;
  return {
    id: data.ckActionId,
    value,
    ...(Object.keys(values).length > 0 ? { values } : {}),
  };
}
