/**
 * Pure §2 ingress normalization for Teams (plan §2: "kind + mentioned").
 *
 * Every `sink.onTurn` needs a normalized `conversationKind` (`"direct_message"
 * | "channel" | "thread" | "assistant"`) + `mentioned: boolean` so
 * channels-core's `decideChannelResponse` can govern dispatch. This module is
 * pure (no credentials, no I/O) so it's unit-testable standalone and shared by
 * `TeamsConnector.startIngress` (the only ingress caller).
 *
 * Mapping (Teams has no assistant-pane concept):
 *   - `conversationType: "personal"` (1:1 chat), or a missing conversationType
 *     (the M365 Agents Playground doesn't always stamp one) → `direct_message`,
 *     `mentioned: false` (the kind alone is enough — DMs are always addressed).
 *   - `conversationType: "channel"` with `replyToId` set → `thread` (a reply
 *     under an existing post); without it → `channel` (top-level channel post).
 *   - `conversationType: "groupChat"` → `channel` (Teams group chats have no
 *     thread concept).
 *   For both shared surfaces, `mentioned` is true only when the activity
 *   carries an explicit `mention` entity targeting the bot (`recipient.id`).
 */
import type { Activity } from "@microsoft/agents-activity";
import type { ChannelConversationKind } from "@copilotkit/channels-core";

/** The subset of an Entity we read to detect an explicit `<at>Bot</at>` mention. */
interface MentionEntityLike {
  type?: string;
  mentioned?: { id?: string };
}

/** True when `activity` explicitly @-mentions the bot (`activity.recipient`). */
export function wasBotMentioned(activity: Activity): boolean {
  const recipientId = activity.recipient?.id;
  if (!recipientId) return false;
  const entities = (activity.entities ?? []) as unknown as MentionEntityLike[];
  return entities.some(
    (e) => e.type === "mention" && e.mentioned?.id === recipientId,
  );
}

/** Normalized §2 routing signals for an inbound Teams message activity. */
export interface TeamsConversationSignals {
  conversationKind: ChannelConversationKind;
  mentioned: boolean;
}

/** Classify an inbound message activity into §2's `conversationKind` + `mentioned`. */
export function classifyConversation(
  activity: Activity,
): TeamsConversationSignals {
  const convType = (
    activity.conversation as { conversationType?: string } | undefined
  )?.conversationType;

  if (!convType || convType === "personal") {
    return { conversationKind: "direct_message", mentioned: false };
  }

  const mentioned = wasBotMentioned(activity);
  if (convType === "channel") {
    return {
      conversationKind: activity.replyToId ? "thread" : "channel",
      mentioned,
    };
  }
  // groupChat (and any other shared surface Teams reports) — no thread concept.
  return { conversationKind: "channel", mentioned };
}
