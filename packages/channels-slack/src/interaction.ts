import type {
  InteractionEvent,
  IncomingReaction,
  IncomingModalSubmit,
  IncomingModalClose,
} from "@copilotkit/channels-core";
import { DM_SCOPE } from "./types.js";
import type { ConversationKey, ReplyTarget } from "./types.js";

/**
 * Prefix marking a `block_id` the renderer minted to name the one field its
 * block holds (see `fieldBlockId` in `render/block-kit.ts`).
 *
 * A field's `values` key must follow the author's `<Input name>`/`<Select name>`,
 * as it does on Teams — but `action_id` cannot carry it, because that is the
 * string the engine dispatches on and it has to stay the registry-minted `ck:`
 * id. Slack keys `state.values` by block then by element, so the block id is the
 * only other stable slot on the wire: the renderer writes the field id there and
 * {@link flattenBlockState} reads it back. The prefix is what distinguishes a
 * block we named from one Slack auto-numbered or a `<Raw>` author set.
 */
export const FIELD_BLOCK_PREFIX = "ckf:";

/**
 * Stable string key shared by ingress (onTurn) and interaction decoding so the
 * bot's awaitChoice waiters resolve. Both paths MUST derive the conversation key
 * from this single helper — a mismatch silently strands the waiter.
 */
export function conversationKeyOf(key: ConversationKey): string {
  return `${key.channelId}::${key.scope}`;
}

/**
 * Decode a Slack `block_actions` payload into a bot `InteractionEvent`.
 *
 * Carries ONLY the opaque minted action id (`ck:...`) plus the tiny, non-sensitive
 * button/option value — there is NO resume-data smuggling through the payload.
 * Durability rides on the ActionStore keyed by that opaque id, not on what Slack
 * round-trips back to us.
 */
export function decodeInteraction(raw: unknown): InteractionEvent | undefined {
  const body = raw as {
    type?: string;
    api_app_id?: string;
    team?: { id?: string };
    trigger_id?: string;
    user?: { id?: string; name?: string; username?: string };
    channel?: { id?: string };
    message?: { ts?: string; thread_ts?: string };
    container?: {
      thread_ts?: string;
      message_ts?: string;
      channel_id?: string;
    };
    actions?: Array<{
      action_id?: string;
      type?: string;
      /** `null`, not absent, when the control is a text input the user left empty. */
      value?: string | null;
      selected_option?: { value?: string };
      selected_options?: Array<{ value?: string }>;
      action_ts?: string;
    }>;
    state?: SlackBlockState;
  };
  if (body.type !== "block_actions") return undefined;
  const action = body.actions?.[0];
  if (!action?.action_id) return undefined;

  const channelId = body.channel?.id ?? body.container?.channel_id;
  if (!channelId) return undefined;

  // An EXPLICIT thread ts means the click happened inside a thread — including
  // an assistant-pane DM, which is threaded even though its channel id starts
  // with "D". Only fall back to the message's own ts (a thread root) for the
  // scope, never conflate the two.
  const explicitThreadTs = body.message?.thread_ts ?? body.container?.thread_ts;
  const threadTs =
    explicitThreadTs ?? body.message?.ts ?? body.container?.message_ts;
  const isDm = channelId.startsWith("D");
  // Scope MUST match what the listener emits per turn (see assistant.ts /
  // adapter.ts), or the HITL `awaitChoice` waiter is stranded and the run
  // never resumes: the thread ts for ANY threaded conversation (assistant-pane
  // DMs included), and DM_SCOPE only for a genuinely unthreaded DM.
  const scope = explicitThreadTs
    ? explicitThreadTs
    : isDm
      ? DM_SCOPE
      : (threadTs ?? "");
  const conversationKey = conversationKeyOf({ channelId, scope });
  const replyTarget: ReplyTarget = {
    channel: channelId,
    threadTs: isDm && !explicitThreadTs ? undefined : threadTs,
  };

  // Tiny, non-sensitive value: the clicked control's reading, decoded with the
  // codec that encoded it (see block-kit.ts). Only a `<Button>`'s value is
  // JSON-encoded there, so only `action.value` is JSON-parsed — falling back to
  // the raw string when it isn't JSON.
  //
  // Everything else is a string on the wire and stays one. Free text is a
  // string by contract (`<Input onSubmit>` is a `ClickHandler<string>`), and so
  // is a select's option value (`SelectOption.value` is a `string`, written out
  // verbatim). JSON-parsing either would silently hand the handler `42` as a
  // number, `true` as a boolean, `null`, or `{"a":1}` as an object. A
  // multi_static_select reports `selected_options` (an array) → a `string[]`.
  let value: unknown;
  if (action.type === PLAIN_TEXT_INPUT) {
    value = textInputValue(action.value);
  } else if (action.selected_options) {
    value = action.selected_options.map((o) => o.value);
  } else if (action.value !== undefined) {
    value = parseValue(action.value);
  } else {
    value = action.selected_option?.value;
  }

  const actor = body.user?.id
    ? {
        id: body.user.id,
        kind: "human" as const,
        name: body.user.name ?? body.user.username,
      }
    : { id: "unknown", kind: "unknown" as const };

  // The picker message's ts: an onClick `thread.update(message.ref, …)`
  // targets this message in place (the adapter's `update` reads `channel`
  // off the ref).
  const messageTs = body.message?.ts ?? body.container?.message_ts;
  const messageRef = messageTs
    ? { id: messageTs, channel: channelId }
    : undefined;

  // Stable per-click id for inbound dedup: the channel + picker message ts +
  // the action's own ts uniquely identify one click. Fall back to trigger_id
  // (single-use per interaction) when those refs are absent. Undefined only if
  // neither is available — never fabricate (that would defeat dedup).
  const eventId =
    channelId && messageTs && action.action_ts
      ? `${channelId}:${messageTs}:${action.action_ts}`
      : body.trigger_id;

  return {
    id: action.action_id,
    conversationKey,
    replyTarget,
    value,
    // Every input still on the message, so a `<Button onClick>` handler beside
    // an `<Input>` can read what was typed. Keyed by field id — the author's
    // `name` when set, else the minted `ck:` id — matching how Teams keys its
    // merged card inputs. See {@link FIELD_BLOCK_PREFIX}.
    values: flattenBlockState(body.state),
    actor,
    messageRef,
    triggerId: body.trigger_id,
    eventId,
    identityContext: {
      tenant: { id: body.team?.id ?? "unknown" },
      installation: { id: body.api_app_id ?? "unknown" },
      conversation: { id: conversationKey, kind: "thread" },
      trigger: "interaction",
      event: eventId ? { id: eventId } : {},
      raw: { type: body.type, actionId: action.action_id },
    },
  };
}

/**
 * JSON-parse a `<Button>` value — the one control whose value block-kit
 * serializes with `JSON.stringify`, so `{decision:"yes"}` round-trips as an
 * object. Falls back to the raw string when it isn't JSON (e.g. Slack's own
 * `feedback_buttons`, whose "positive"/"negative" we never encoded).
 */
function parseValue(raw: string | null | undefined): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** Slack's element type for a free-text input — the one control whose value is user-typed. */
const PLAIN_TEXT_INPUT = "plain_text_input";

/**
 * A `plain_text_input`'s reading, as the string its contract promises. Slack
 * reports a field the user left EMPTY as `value: null`, but `<Input onSubmit>`
 * is a `ClickHandler<string>` and an empty field is emptiness, not absence — so
 * the reading is `""`. That is also what identical JSX delivers on Teams, which
 * merges an untouched `Input.Text` into the submit as `""` (see
 * `render/adaptive-card.ts` in channels-teams); handing a handler `null` here
 * would make the two surfaces disagree about the same blank box.
 */
function textInputValue(raw: string | null | undefined): string {
  return raw ?? "";
}

/**
 * Write one decoded field onto a `values` bag as an OWN data property.
 *
 * `key` is a block/element id from an inbound Slack payload, and `__proto__`
 * survives `JSON.parse` as an own key. A plain `bag[key] = value` for that key
 * runs `Object.prototype`'s `__proto__` SETTER instead of creating a field: the
 * element's reading disappears from `Object.keys(bag)` and — when it is an
 * object — becomes the bag's prototype, so every property it carries reads back
 * off `bag` as though the workspace had submitted it. (In the modal reader,
 * where the flattened reading is a string, the setter drops it outright and the
 * handler never sees the field at all.) `defineProperty` writes the property
 * itself and never consults a setter, so `__proto__` lands as ordinary
 * enumerable data like any other field id.
 *
 * Deliberately a plain `{}` and NOT `Object.create(null)`. These bags are
 * public API — `flattenBlockState`'s reaches handlers as `ctx.values` and
 * `flattenViewValues`' as an `onModalSubmit` handler's `values`, both typed
 * `Record<string, unknown>` (see channels-core's `InteractionContext` and
 * `IncomingModalSubmit`) — and `values.hasOwnProperty(...)`/`toString()` is
 * ordinary consumer code that a prototype-less bag would break. Dropping the
 * prototype buys only that an ABSENT field id spelled like a builtin reads back
 * `undefined` rather than the builtin, which is true of every other
 * `Record<string, unknown>` in this API and is not what the injection was
 * about. A field that WAS submitted still wins: an own property shadows its
 * `Object.prototype` namesake.
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

/** One entry of a Slack view/message `state.values` block. */
interface SlackStateElement {
  type?: string;
  /** `null`, not absent, when the element is a text input the user left empty. */
  value?: string | null;
  selected_option?: { value?: string };
  selected_options?: Array<{ value?: string }>;
}

/** Slack's `state` envelope: block id → element id → the element's current value. */
interface SlackBlockState {
  values?: Record<string, Record<string, SlackStateElement>>;
}

/**
 * The current value of one `state.values` element, resolved by exactly the rule
 * the clicked action uses above. Nothing here is JSON-decoded: a `<Button>` is
 * the only control whose value we JSON-encode and it holds no state, so every
 * reading Slack reports — typed text, option values — is a string on the wire
 * and stays one. The two readers must agree, or the same `<Select>` would reach
 * a handler as `42` via `ctx.action.value` and `"42"` via `ctx.values`.
 */
function stateElementValue(el: SlackStateElement): unknown {
  // Explicit ahead of the shared fallback: Slack reports an EMPTY text input as
  // `value: null`, and the `??` below would resolve that to the (absent)
  // `selected_option` rather than to the empty string a text field owes.
  if (el.type === PLAIN_TEXT_INPUT) return textInputValue(el.value);
  if (el.selected_options) return el.selected_options.map((o) => o.value);
  return el.value ?? el.selected_option?.value;
}

/**
 * Flatten a `block_actions` payload's `state.values` to a flat `fieldId → value`
 * map, keyed the way Teams keys the same JSX's merged card inputs: the author's
 * `name` first, else the registry-minted `ck:` id, else a positional fallback.
 *
 * The renderer stamps that field id into the block id (see
 * {@link FIELD_BLOCK_PREFIX}), so — as in a modal view, whose vocabulary also
 * names block id == field id (see {@link flattenViewValues}) — the block is what
 * names the field. A block without the prefix was not ours to name, and there
 * the element's own `action_id` is the only stable key left.
 */
function flattenBlockState(state: SlackBlockState | undefined): {
  [fieldId: string]: unknown;
} {
  const out: Record<string, unknown> = {};
  for (const [blockId, block] of Object.entries(state?.values ?? {})) {
    // A `ckf:` block names its single field (the renderer never puts two in
    // one), so every element under it resolves to that same field id.
    const named = blockId.startsWith(FIELD_BLOCK_PREFIX)
      ? blockId.slice(FIELD_BLOCK_PREFIX.length)
      : undefined;
    for (const [actionId, el] of Object.entries(block)) {
      setField(out, named ?? actionId, stateElementValue(el));
    }
  }
  return out;
}

interface SlackReactionEvent {
  user?: string;
  team?: string;
  event_ts?: string;
  reaction?: string;
  item?: { type?: string; channel?: string; ts?: string };
}

/** Decode a Slack `reaction_added`/`reaction_removed` event into an `IncomingReaction`. */
export function decodeReaction(
  event: unknown,
  added: boolean,
): IncomingReaction | undefined {
  const e = event as SlackReactionEvent;
  if (e.item?.type !== "message") return undefined;
  const channel = e.item.channel;
  const ts = e.item.ts;
  if (!channel || !ts || !e.reaction) return undefined;
  const scope = channel.startsWith("D") ? DM_SCOPE : ts;
  return {
    rawEmoji: e.reaction,
    added,
    actor: e.user
      ? { id: e.user, kind: "human" }
      : { id: "unknown", kind: "unknown" },
    conversationKey: conversationKeyOf({ channelId: channel, scope }),
    identityContext: {
      tenant: { id: e.team ?? "unknown" },
      installation: { id: "unknown" },
      conversation: {
        id: conversationKeyOf({ channelId: channel, scope }),
        kind: "thread",
      },
      trigger: "reaction",
      event: e.event_ts ? { id: e.event_ts } : {},
      raw: { reaction: e.reaction, added },
    },
    // Thread the reply under the reacted message (channel/thread reactions);
    // DMs stay flat. A handler replying via thread.post/runAgent must land
    // under the reacted message, not at the channel root. Carry the reactor id
    // as `recipientUserId` (parity with onTurn): `chat.startStream` REQUIRES
    // `recipient_user_id` when streaming to a channel, so without it the
    // adapter's first native channel stream for this target fails — and the
    // adapter then flips its own `nativeStreamingOk` to false, downgrading the
    // whole workspace to the legacy transport.
    replyTarget: {
      channel,
      ...(scope === DM_SCOPE ? {} : { threadTs: ts }),
      ...(e.user ? { recipientUserId: e.user } : {}),
    },
    messageId: ts,
    // Update-capable ref (channel + ts) so an onReaction handler can swap the
    // reacted message's UI in place via thread.update.
    messageRef: { id: ts, channel },
    threadId: ts,
    raw: event,
  };
}

interface SlackViewState {
  callback_id?: string;
  private_metadata?: string;
  state?: SlackBlockState;
}

/**
 * Flatten a Slack view's `state.values` to a flat `fieldId → value` map. The
 * modal vocabulary names every block id == action id (the field id), so for
 * each block we take the inner element keyed by that same block id, falling
 * back to the first element. Text inputs expose `value`; selects/radios expose
 * `selected_option.value`.
 *
 * Deliberately NOT {@link stateElementValue}: modal submissions are a separate
 * surface with its own settled semantics, and routing them through the
 * `block_actions` reader would silently change what `view_submission` delivers.
 */
function flattenViewValues(view: SlackViewState): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const values = view.state?.values ?? {};
  for (const blockId of Object.keys(values)) {
    const inner = values[blockId]!;
    // Own-key lookup only: an unguarded `inner[blockId]` resolves ids like
    // `constructor`/`toString` to an `Object.prototype` member, which is truthy
    // and so would shadow the documented first-element fallback below.
    const own = Object.prototype.hasOwnProperty.call(inner, blockId)
      ? inner[blockId]
      : undefined;
    const el = own ?? Object.values(inner)[0];
    if (!el) continue;
    setField(out, blockId, el.value ?? el.selected_option?.value);
  }
  return out;
}

/**
 * The conversation context stamped into a modal's `private_metadata` at open
 * time (see the Slack adapter's `openModal`). Slack `view_submission`/
 * `view_closed` payloads are detached from the originating channel, so this
 * envelope is the only carrier that lets a submit/close route back to the
 * conversation that opened the modal.
 */
interface CpkModalEnvelope {
  /** Conversation context: target channel + optional thread ts. */
  __cpk: { channel: string; threadTs?: string };
  /** The author's original `private_metadata`, preserved verbatim (may be absent). */
  pm?: string;
}

/**
 * Decode a view's `private_metadata` into the conversation context + the
 * author's original metadata. When the string is a `__cpk` envelope (stamped at
 * open time), return the derived `conversationKey`/`replyTarget` and restore the
 * author's `pm`. Otherwise (absent, non-JSON, or a plain author string from a
 * modal opened some other way) preserve back-compat: pass the raw string
 * through as `privateMetadata`, with no conversationKey/replyTarget.
 */
function decodeModalContext(privateMetadata: string | undefined): {
  conversationKey?: string;
  replyTarget?: ReplyTarget;
  privateMetadata?: string;
} {
  if (privateMetadata === undefined) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(privateMetadata);
  } catch {
    // Non-JSON string → treat as a plain author privateMetadata.
    return { privateMetadata };
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as CpkModalEnvelope).__cpk !== "object" ||
    (parsed as CpkModalEnvelope).__cpk === null ||
    typeof (parsed as CpkModalEnvelope).__cpk.channel !== "string"
  ) {
    // Valid JSON but not our envelope → treat the original string as plain
    // author metadata (e.g. a modal opened with a JSON private_metadata).
    return { privateMetadata };
  }
  const env = parsed as CpkModalEnvelope;
  const channelId = env.__cpk.channel;
  const threadTs = env.__cpk.threadTs;
  const scope = threadTs ?? DM_SCOPE;
  return {
    conversationKey: conversationKeyOf({ channelId, scope }),
    replyTarget: { channel: channelId, ...(threadTs ? { threadTs } : {}) },
    privateMetadata: env.pm,
  };
}

/** Decode a Slack `view_submission` payload into an `IncomingModalSubmit`. */
export function decodeViewSubmission(
  view: unknown,
  actor?: { id: string; kind: "human"; name?: string },
): IncomingModalSubmit {
  const v = view as SlackViewState;
  const ctx = decodeModalContext(v.private_metadata);
  return {
    callbackId: v.callback_id ?? "",
    values: flattenViewValues(v),
    actor: actor ?? { id: "unknown", kind: "unknown" },
    identityContext: {
      tenant: { id: "unknown" },
      installation: { id: "unknown" },
      conversation: {
        id: ctx.conversationKey ?? `modal:${v.callback_id ?? ""}`,
        kind: "modal",
      },
      trigger: "modal-submit",
      event: {},
      raw: { callbackId: v.callback_id },
    },
    privateMetadata: ctx.privateMetadata,
    ...(ctx.conversationKey ? { conversationKey: ctx.conversationKey } : {}),
    ...(ctx.replyTarget ? { replyTarget: ctx.replyTarget } : {}),
    platform: "slack",
    raw: view,
  };
}

/** Decode a Slack `view_closed` payload into an `IncomingModalClose`. */
export function decodeViewClosed(
  view: unknown,
  actor?: { id: string; kind: "human"; name?: string },
): IncomingModalClose {
  const v = view as SlackViewState;
  const ctx = decodeModalContext(v.private_metadata);
  return {
    callbackId: v.callback_id ?? "",
    actor: actor ?? { id: "unknown", kind: "unknown" },
    identityContext: {
      tenant: { id: "unknown" },
      installation: { id: "unknown" },
      conversation: {
        id: ctx.conversationKey ?? `modal:${v.callback_id ?? ""}`,
        kind: "modal",
      },
      trigger: "modal-close",
      event: {},
      raw: { callbackId: v.callback_id },
    },
    privateMetadata: ctx.privateMetadata,
    ...(ctx.conversationKey ? { conversationKey: ctx.conversationKey } : {}),
    ...(ctx.replyTarget ? { replyTarget: ctx.replyTarget } : {}),
    platform: "slack",
    raw: view,
  };
}
