import type {
  InteractionEvent,
  IncomingReaction,
  IncomingModalSubmit,
  IncomingModalClose,
} from "@copilotkit/channels-core";
import { DM_SCOPE } from "./types.js";
import type { ConversationKey, ReplyTarget } from "./types.js";

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
 * Carries the opaque minted action id (`ck:...`), the clicked element's own
 * value, and — in `values` — the current state of every input block on the
 * message, which is what Slack sends alongside the click in `state.values`.
 * There is still NO resume-data smuggling: durability rides on the ActionStore
 * keyed by the opaque id, not on what Slack round-trips back to us.
 *
 * Note that `values` is user-entered form content, not a tiny opaque token: a
 * click on a message hosting a text input carries whatever the user typed. It is
 * surfaced because a "fill the fields, then press the button" message is
 * otherwise unreadable (OSS-846) — but callers should treat it as user input.
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
    /** Current value of every input block on the clicked message. */
    state?: SlackBlockState;
    actions?: Array<
      SlackElementState & { action_id?: string; action_ts?: string }
    >;
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

  // The clicked element's own value, read through the same vocabulary as the
  // message's input state below so a control reports identically whichever of
  // the two it arrives in.
  const value = elementStateValue(action);

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

  // Slack sends the current state of every input block on the message alongside
  // the click. Omitted rather than sent as `{}` when the message hosts no inputs
  // (the Teams decoder's convention), so a plain button is byte-identical to
  // what it produced before this field existed.
  const values = flattenStateValues(body.state);

  return {
    id: action.action_id,
    conversationKey,
    replyTarget,
    value,
    ...(Object.keys(values).length > 0 ? { values } : {}),
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
 * JSON-parse an AUTHOR-ENCODED control value so a non-string option value
 * round-trips; keep the raw string when it is not JSON.
 *
 * Only ever applied to values the author put on the element (a button's
 * `value`, an option's `value`) — never to text the user typed. See
 * `FREE_TEXT_ELEMENT_TYPES`.
 */
function parseValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Element families whose `value` is text the USER typed, not a token the author
 * encoded. Their content is handed back as the verbatim string.
 *
 * `decodeViewSubmission` has shipped for several releases returning raw strings
 * here, so JSON-parsing them would silently retype existing modal handlers'
 * fields: an order number typed as `1234` would arrive as the number `1234` and
 * `values.orderId.trim()` would throw. `number_input` is in the set for the same
 * reason — Slack reports it as a string and that is what handlers already read.
 */
const FREE_TEXT_ELEMENT_TYPES = new Set([
  "plain_text_input",
  "rich_text_input",
  "email_text_input",
  "url_text_input",
  "number_input",
]);

/**
 * Keys under which Slack reports a multi-select as an array of bare ids (unlike
 * `selected_options`, which carries option objects).
 */
const SELECTED_ID_LIST_KEYS = [
  "selected_users",
  "selected_conversations",
  "selected_channels",
] as const satisfies readonly (keyof SlackElementState)[];

/**
 * Keys under which Slack reports a single picker's choice as one scalar. Dates
 * and times arrive as strings; `selected_date_time` arrives as unix seconds, so
 * numbers have to survive too.
 */
const SELECTED_SCALAR_KEYS = [
  "selected_user",
  "selected_conversation",
  "selected_channel",
  "selected_date",
  "selected_time",
  "selected_date_time",
] as const satisfies readonly (keyof SlackElementState)[];

/**
 * Every shape a Slack interactive element reports its current value in — the
 * same set whether it arrives as the clicked `actions[0]` or as an entry in a
 * surface's `state.values`.
 */
interface SlackElementState {
  type?: string;
  value?: string;
  /** Slack sends an explicit `null` for an untouched select. */
  selected_option?: { value?: string } | null;
  selected_options?: Array<{ value?: string }> | null;
  /** Every picker below reports an explicit `null` while untouched. */
  selected_user?: string | null;
  selected_users?: string[] | null;
  selected_conversation?: string | null;
  selected_conversations?: string[] | null;
  selected_channel?: string | null;
  selected_channels?: string[] | null;
  selected_date?: string | null;
  selected_time?: string | null;
  selected_date_time?: number | null;
  /** `rich_text_input` reports a rich-text document, not a string. */
  rich_text_value?: unknown;
}

/** A Slack surface's input state: `blockId → actionId → element state`. */
interface SlackBlockState {
  values?: Record<string, Record<string, SlackElementState | undefined>>;
}

/**
 * Read one element's current value.
 *
 * Slack reports a value under a different key per element family, and reading
 * only `value ?? selected_option.value` silently yields `undefined` for every
 * multi-select, picker, date/time control and rich-text field. Each family
 * therefore gets an explicit arm.
 *
 * Every guard is on the value's TYPE, not on `!== undefined`: Slack sends an
 * explicit `null` for an untouched picker (`selected_date: null`,
 * `selected_user: null`), and `null !== undefined`, so an `undefined` check
 * would hand a literal `null` to the handler. A `null` falls through here and
 * the field is then omitted by `flattenStateValues`, which is what the managed
 * normalizer does — the two must agree key-for-key.
 *
 * Returns `undefined` when the element genuinely carries no value.
 *
 * Order mirrors the managed normalizer arm-for-arm so the two produce the same
 * map for the same payload; the families are disjoint in practice.
 */
function elementStateValue(el: SlackElementState): unknown {
  if (Array.isArray(el.selected_options)) {
    // An empty multi-select reports `[]`, which must stay an empty array rather
    // than falling through to the text arm and becoming `undefined`.
    return el.selected_options
      .map((o) => o?.value)
      .filter((v): v is string => typeof v === "string")
      .map(parseValue);
  }
  if (el.selected_option) {
    const raw = el.selected_option.value;
    return typeof raw === "string" ? parseValue(raw) : undefined;
  }
  for (const key of SELECTED_ID_LIST_KEYS) {
    const selected = el[key];
    if (Array.isArray(selected)) {
      return selected.filter((id): id is string => typeof id === "string");
    }
  }
  for (const key of SELECTED_SCALAR_KEYS) {
    const selected = el[key];
    if (typeof selected === "string" || typeof selected === "number") {
      return selected;
    }
  }
  // A `rich_text_input` reports a rich-text document rather than a string.
  if (el.rich_text_value !== undefined) return el.rich_text_value;
  if (typeof el.value !== "string") return undefined;
  // Free text is the user's, verbatim; anything else is an author-encoded token.
  return FREE_TEXT_ELEMENT_TYPES.has(el.type ?? "")
    ? el.value
    : parseValue(el.value);
}

/**
 * Flatten a Slack surface's `state.values` to a flat `fieldId → value` map.
 *
 * Slack nests the state as `blockId → actionId → element`. The key is the BLOCK
 * id wherever a block id can name the element, because that is the half an
 * author can name (`render/block-kit.ts` derives it from `props.name`, matching
 * Teams; `render/modal.ts` names block id == action id).
 *
 * A block can hold MORE than one stateful element, though: an `<Actions>` packs
 * up to `SLACK_LIMITS.actionsElements` elements into one block, and a
 * hand-authored native block may do the same. One block id cannot name several
 * elements, so the rule is:
 *
 * - the element whose action id equals the block id, or the sole element of the
 *   block, is keyed by the BLOCK id — every shape the renderers emit today, and
 *   every modal submission, therefore decodes exactly as before;
 * - any further element in the same block is keyed by its own ACTION id, which
 *   is the only identifier left that distinguishes it.
 *
 * Nothing is dropped silently, and an existing key is never clobbered.
 *
 * A field whose element reports no value is left out rather than set to
 * `undefined`: the managed path carries `values` over the wire as JSON, which
 * cannot express `undefined`, so keeping the key would promise the self-hosted
 * handler a field the managed one never sees. `Object.keys`, `in` and
 * `Object.entries` must agree on both deployments.
 */
function flattenStateValues(
  state: SlackBlockState | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const values = state?.values ?? {};
  for (const blockId of Object.keys(values)) {
    const inner = values[blockId];
    if (!inner) continue;
    const entries = Object.entries(inner).filter(
      (entry): entry is [string, SlackElementState] =>
        typeof entry[1] === "object" && entry[1] !== null,
    );
    for (const [actionId, el] of entries) {
      const key =
        actionId === blockId || entries.length === 1 ? blockId : actionId;
      const value = elementStateValue(el);
      if (value === undefined) continue;
      if (Object.prototype.hasOwnProperty.call(out, key)) continue;
      out[key] = value;
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
    values: flattenStateValues(v.state),
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
