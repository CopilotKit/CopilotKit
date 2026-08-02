/**
 * Adaptive Card `Action.Submit` decoding for the Teams adapter.
 *
 * A button rendered by {@link ../render/adaptive-card.renderButton} carries its
 * opaque minted action id (`ck:...`) and tiny `value` in the action's `data`.
 * The submit `renderAdaptiveCard` synthesizes for a card with no dispatchable
 * one (see `synthesizeSubmit`) carries a `ckValueField` instead of a `value`.
 * When clicked, either delivers a **Message activity** whose `value` is that
 * `data` object (merged with any card inputs) and whose `text` is empty. These
 * helpers recognize and decode that activity so the engine's `awaitChoice`
 * waiter resolves.
 *
 * The wire contract these decode is documented in
 * `docs/button-action-envelope.md`; out-of-band consumers decode it themselves,
 * so keep the two in step.
 */

/** Minimal shape of the inbound Teams activity we read for interaction decoding. */
export interface TeamsActivityLike {
  value?: unknown;
  conversation?: { id?: string };
}

/** The `data` our submits round-trip (see `render/adaptive-card.ts`). */
interface CardActionData {
  /**
   * Opaque minted handler id. Emitted by `renderButton` for a `<Button onClick>`
   * and by `synthesizeSubmit` for the field it binds. Every `Action.Submit` the
   * renderer emits carries one — `renderButton` emits no action at all for a
   * `<Button>` with no route — so an inbound payload without it is never one of
   * our submits. Optional here because this types an INBOUND payload, which may
   * be an ordinary chat message's `value`.
   */
  ckActionId?: string;
  /** The clicked `<Button value>`, when it had one. Only `renderButton` emits it. */
  value?: unknown;
  /**
   * Id of the card field whose submitted value IS this submit's action value.
   * Emitted ONLY by `synthesizeSubmit` — `renderButton` never sets it. It marks
   * the submit the renderer adds to a card with no dispatchable one, where the
   * dispatched handler is an `<Input onSubmit>` or `<Select onSelect>` whose
   * contract is the submitted value, not the (absent) button value.
   */
  ckValueField?: string;
}

/**
 * Keys reserved by our own submit envelope. Teams merges every card input into
 * the submit's `data` object keyed by the input element's `id`, so these names
 * must never be minted as field ids nor read back as submitted fields.
 *
 * Frozen because it is public API and both of those guarantees read it live:
 * `render/adaptive-card.ts` seeds its reserved-field-id set from it and
 * `parseCardAction` strips it out of `values`. An in-process mutation would
 * silently retarget both — dropping a genuinely submitted field or minting one
 * under an envelope name. `as const` keeps the member names in the exported
 * type; use {@link isCardEnvelopeKey} to test an arbitrary string against it.
 */
export const CARD_ENVELOPE_KEYS = Object.freeze([
  "ckActionId",
  "value",
  "ckValueField",
] as const);

/** One of the {@link CARD_ENVELOPE_KEYS}. */
export type CardEnvelopeKey = (typeof CARD_ENVELOPE_KEYS)[number];

/**
 * Is `key` reserved by the submit envelope? Narrows, so callers that hold a
 * plain `string` (an inbound payload key, an author-supplied `name` prop) can
 * still test it against the literal-typed {@link CARD_ENVELOPE_KEYS}.
 */
export function isCardEnvelopeKey(key: string): key is CardEnvelopeKey {
  return CARD_ENVELOPE_KEYS.some((reserved) => reserved === key);
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
 * Write one decoded field onto the `values` bag as an OWN data property.
 *
 * `key` comes from an inbound platform payload, and `__proto__` survives
 * `JSON.parse` as an own key. A plain `bag[key] = value` for that key runs
 * `Object.prototype`'s `__proto__` SETTER instead of creating a field: the
 * submitted value disappears from `Object.keys(bag)` and — when it is an
 * object — becomes the bag's prototype, so every property it carries reads
 * back off `bag` as though the sender had submitted it. `defineProperty`
 * writes the property itself and never consults a setter, so `__proto__`
 * lands as ordinary enumerable data like any other field id.
 *
 * Deliberately a plain `{}` and NOT `Object.create(null)`. `values` is public
 * API — it reaches application handlers as `ctx.values`, typed
 * `Record<string, unknown>` (see channels-core's `InteractionContext`) — and
 * `ctx.values.hasOwnProperty(...)`/`toString()` is ordinary consumer code that
 * a prototype-less bag would break. Dropping the prototype buys only that an
 * ABSENT field id spelled like a builtin reads back `undefined` rather than
 * the builtin, which is true of every other `Record<string, unknown>` in this
 * API and is not what the injection was about. A field that WAS submitted
 * still wins: an own property shadows its `Object.prototype` namesake.
 */
function setField(
  bag: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(bag, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
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
 * and, when the submit names a `ckValueField` that is present among them, that
 * field's submitted value is also the action's `value`. A `ckValueField` naming
 * an absent field (or one of the reserved envelope keys, which are stripped
 * before the lookup) falls back to `data.value` — `undefined` on a synthesized
 * submit, which carries no `value`.
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
  const values: Record<string, unknown> = {};
  for (const [key, fieldValue] of Object.entries(data)) {
    if (isCardEnvelopeKey(key)) continue;
    setField(values, key, fieldValue);
  }
  const valueField = data.ckValueField;
  const value =
    typeof valueField === "string" &&
    Object.prototype.hasOwnProperty.call(values, valueField)
      ? values[valueField]
      : data.value;
  return { id: data.ckActionId, value, values };
}
