/**
 * Adaptive Card `Action.Submit` decoding for the Teams adapter.
 *
 * A button rendered by {@link ../render/adaptive-card.renderButton} carries its
 * opaque minted action id (`ck:...`) and tiny `value` in the action's `data`.
 * When clicked, Teams delivers a **Message activity** whose `value` is that
 * `data` object (merged with any card inputs) and whose `text` is empty. An
 * `Action.Execute` click instead arrives as an `adaptiveCard/action` invoke
 * whose `value.action.data` holds the same `data`. These helpers recognize and
 * decode both so the engine's `awaitChoice` waiter resolves.
 */

/** Minimal shape of the inbound Teams activity we read for interaction decoding. */
export interface TeamsActivityLike {
  value?: unknown;
  conversation?: { id?: string };
}

/** The `data` our buttons round-trip (see `render/adaptive-card.ts` `renderButton`). */
interface CardActionData {
  ckActionId?: string;
  value?: unknown;
  [key: string]: unknown;
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
  const activityValue = activity.value as
    | (CardActionData & { action?: { data?: CardActionData } })
    | undefined;
  const data = activityValue?.action?.data ?? activityValue;
  if (
    !data ||
    typeof data !== "object" ||
    typeof data.ckActionId !== "string"
  ) {
    return undefined;
  }
  // `Action.Submit` merges card inputs into `value`; `Action.Execute` merges
  // them into `value.action.data`. Read the inputs from wherever `data` came.
  const values = Object.fromEntries(
    Object.entries(data).filter(
      ([name]) =>
        name !== "action" && name !== "ckActionId" && name !== "value",
    ),
  );
  return {
    id: data.ckActionId,
    value: data.value,
    ...(Object.keys(values).length > 0 ? { values } : {}),
  };
}
