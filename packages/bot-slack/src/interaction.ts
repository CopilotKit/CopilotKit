import type { InteractionEvent } from "@copilotkit/bot";
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
  // value), JSON-parsed if it round-trips, otherwise the raw string.
  const rawValue = action.value ?? action.selected_option?.value;
  let value: unknown = rawValue;
  if (typeof rawValue === "string") {
    try {
      value = JSON.parse(rawValue);
    } catch {
      value = rawValue;
    }
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

  return {
    id: action.action_id,
    conversationKey,
    replyTarget,
    value,
    user,
    messageRef,
  };
}
