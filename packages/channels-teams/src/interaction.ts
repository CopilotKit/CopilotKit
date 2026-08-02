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
interface CardActionData {
  ckActionId?: string;
  value?: unknown;
  /**
   * Id of the card input whose text IS this submit's action value. Set only on
   * the submit the renderer synthesizes for an input-only card (see
   * `renderAdaptiveCard`), where the dispatched handler is an `<Input onSubmit>`
   * and its `ClickHandler<string>` contract requires the typed text — not the
   * (absent) button value.
   */
  ckValueField?: string;
}

/**
 * Keys reserved by our own submit envelope. Teams merges every card input into
 * the submit's `data` object keyed by the input element's `id`, so these names
 * must never be minted as field ids nor read back as submitted fields.
 */
export const CARD_ENVELOPE_KEYS: readonly string[] = [
  "ckActionId",
  "value",
  "ckValueField",
];

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
 * action id, the action's value, and every submitted card input when the
 * activity carries our `ckActionId`, else `undefined` (i.e. it's an ordinary
 * chat message). Carries ONLY the opaque id, the tiny button value and the
 * user's own form input: no resume-data smuggling; durability rides on the
 * engine's ActionStore keyed by that id.
 *
 * Teams merges every `Input.*` on the card into the submit's `data`, keyed by
 * the element's `id`. Those fields become the event's `values` (so a
 * `<Button onClick>` handler beside an `<Input>` can still read what was typed),
 * and, when the submit names a `ckValueField`, that field's text is also the
 * action's `value`.
 */
export function parseCardAction(activity: TeamsActivityLike):
  | {
      id: string;
      value: unknown;
      values: Record<string, unknown>;
    }
  | undefined {
  const data = activity.value as CardActionData | undefined;
  if (
    !data ||
    typeof data !== "object" ||
    typeof data.ckActionId !== "string"
  ) {
    return undefined;
  }
  // Null-prototype, because `data` is an inbound payload and `__proto__`
  // survives `JSON.parse` as an OWN key: assigning it onto a plain `{}` runs
  // `Object.prototype`'s setter instead of creating a field, so the handler
  // would receive an INVISIBLE inherited property (absent from `Object.keys`)
  // in place of the submitted value. With no prototype every key lands as plain
  // data and nothing is inherited, so `values` is exactly what was submitted —
  // `constructor` and friends included.
  const values: Record<string, unknown> = Object.create(null);
  for (const [key, fieldValue] of Object.entries(data)) {
    if (CARD_ENVELOPE_KEYS.includes(key)) continue;
    values[key] = fieldValue;
  }
  const valueField = data.ckValueField;
  const value =
    typeof valueField === "string" &&
    Object.prototype.hasOwnProperty.call(values, valueField)
      ? values[valueField]
      : data.value;
  return { id: data.ckActionId, value, values };
}
