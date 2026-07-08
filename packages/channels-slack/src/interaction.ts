import type {
  InteractionEvent,
  IncomingReaction,
  IncomingModalSubmit,
  IncomingModalClose,
} from "@copilotkit/channels";
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
 * Carries ONLY the opaque minted action id (`ck:...`) plus the tiny, non-sensitive
 * button/option value — there is NO resume-data smuggling through the payload.
 * Durability rides on the ActionStore keyed by that opaque id, not on what Slack
 * round-trips back to us.
 */
export function decodeInteraction(raw: unknown): InteractionEvent | undefined {
  const body = raw as {
    type?: string;
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
      value?: string;
      selected_option?: { value?: string };
      selected_options?: Array<{ value?: string }>;
      action_ts?: string;
    }>;
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

  // Tiny, non-sensitive value: the clicked button's value (or selected option
  // value), JSON-parsed if it round-trips, otherwise the raw string. A
  // multi_static_select reports `selected_options` (an array) → a `string[]`.
  let value: unknown;
  if (action.selected_options) {
    value = action.selected_options.map((o) => parseValue(o.value));
  } else {
    value = parseValue(action.value ?? action.selected_option?.value);
  }

  const user = body.user?.id
    ? { id: body.user.id, name: body.user.name ?? body.user.username }
    : undefined;

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
    user,
    messageRef,
    triggerId: body.trigger_id,
    eventId,
  };
}

/** JSON-parse a control value so non-string option values round-trip; else keep the raw string. */
function parseValue(raw: string | undefined): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

interface SlackReactionEvent {
  user?: string;
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
    user: e.user ? { id: e.user } : undefined,
    conversationKey: conversationKeyOf({ channelId: channel, scope }),
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
  state?: {
    values?: Record<
      string,
      Record<
        string,
        {
          type?: string;
          value?: string;
          selected_option?: { value?: string };
        }
      >
    >;
  };
}

/**
 * Flatten a Slack view's `state.values` to a flat `fieldId → value` map. The
 * modal vocabulary names every block id == action id (the field id), so for
 * each block we take the inner element keyed by that same block id, falling
 * back to the first element. Text inputs expose `value`; selects/radios expose
 * `selected_option.value`.
 */
function flattenViewValues(view: SlackViewState): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const values = view.state?.values ?? {};
  for (const blockId of Object.keys(values)) {
    const inner = values[blockId]!;
    const el = inner[blockId] ?? Object.values(inner)[0];
    if (!el) continue;
    out[blockId] = el.value ?? el.selected_option?.value;
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
  user?: { id: string; name?: string },
): IncomingModalSubmit {
  const v = view as SlackViewState;
  const ctx = decodeModalContext(v.private_metadata);
  return {
    callbackId: v.callback_id ?? "",
    values: flattenViewValues(v),
    user,
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
  user?: { id: string; name?: string },
): IncomingModalClose {
  const v = view as SlackViewState;
  const ctx = decodeModalContext(v.private_metadata);
  return {
    callbackId: v.callback_id ?? "",
    user,
    privateMetadata: ctx.privateMetadata,
    ...(ctx.conversationKey ? { conversationKey: ctx.conversationKey } : {}),
    ...(ctx.replyTarget ? { replyTarget: ctx.replyTarget } : {}),
    platform: "slack",
    raw: view,
  };
}
