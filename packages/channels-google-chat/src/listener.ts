import type { IngressSink } from "@copilotkit/channels-core";
import { isDirectMessage } from "./events.js";
import type { NormalizedEvent } from "./events.js";
import type { HistoryStore } from "./history-store.js";
import {
  actorOf,
  decodeInteraction,
  identityContextOf,
  replyTargetOf,
} from "./interaction.js";
import { conversationKeyOf } from "./types.js";

export interface RouteContext {
  sink: IngressSink;
  history: HistoryStore;
  /** The app's own user resource name, when known. */
  botUserId?: string;
}

const PLATFORM = "google-chat";

/** True when the message @-mentions this app. */
function mentionsApp(evt: NormalizedEvent, botUserId?: string): boolean {
  return (evt.message?.annotations ?? []).some((a) => {
    if (a.type !== "USER_MENTION") return false;
    const user = a.userMention?.user;
    return botUserId ? user?.name === botUserId : user?.type === "BOT";
  });
}

/**
 * The user's text without the leading @-mention. Chat's `argumentText`
 * already strips the mention; `text` is the fallback.
 */
function userTextOf(evt: NormalizedEvent): string {
  const m = evt.message;
  return (m?.argumentText ?? m?.text ?? "").trim();
}

/**
 * Route one normalized Google Chat event to the channel's ingress sink.
 *
 * - message → `onTurn` (skipped when a bot sent it)
 * - slash command → `onCommand`
 * - card click → `onInteraction`
 * - added to space → `onWelcome`, then `onTurn` if the add carried a message
 */
export async function routeEvent(
  evt: NormalizedEvent,
  ctx: RouteContext,
): Promise<void> {
  const { sink } = ctx;

  if (evt.kind === "click") {
    const interaction = decodeInteraction(evt);
    if (interaction) await sink.onInteraction(interaction);
    return;
  }

  const space = evt.space;
  if (!space?.name) return;

  if (evt.kind === "added") {
    const replyTarget = replyTargetOf(space, undefined);
    const conversationKey = conversationKeyOf(replyTarget.space);
    await sink.onWelcome({
      conversationKey,
      replyTarget,
      actor: actorOf(evt.user),
      identityContext: identityContextOf(
        evt,
        conversationKey,
        "welcome",
        undefined,
      ),
      platform: PLATFORM,
    });
    if (evt.message?.text) await routeMessage(evt, ctx);
    return;
  }

  if (evt.kind === "message") return routeMessage(evt, ctx);

  if (evt.kind === "command" && evt.message && evt.command) {
    const message = evt.message;
    const replyTarget = replyTargetOf(space, message.thread?.name);
    const conversationKey = conversationKeyOf(
      replyTarget.space,
      replyTarget.thread,
    );
    const sender = message.sender ?? evt.user;
    // Chat's argumentText for a slash command is the text after the command.
    const text = (message.argumentText ?? "").trim();
    await sink.onCommand({
      command: evt.command,
      text,
      conversationKey,
      replyTarget,
      actor: actorOf(sender),
      identityContext: identityContextOf(
        evt,
        conversationKey,
        "command",
        message.name,
      ),
      ...(message.name ? { eventId: message.name } : {}),
      platform: PLATFORM,
    });
  }
}

async function routeMessage(
  evt: NormalizedEvent,
  ctx: RouteContext,
): Promise<void> {
  const message = evt.message;
  const space = evt.space;
  if (!message || !space?.name) return;
  const sender = message.sender ?? evt.user;
  // Loop guard: never answer a bot, including this app's own messages.
  if (sender?.type === "BOT") return;
  if (ctx.botUserId && sender?.name === ctx.botUserId) return;

  const userText = userTextOf(evt);
  const attachmentNote = (message.attachment ?? [])
    .map((a) => a.contentName)
    .filter(Boolean);
  const text =
    attachmentNote.length > 0
      ? `${userText}${userText ? "\n\n" : ""}[attached: ${attachmentNote.join(", ")}]`
      : userText;
  if (!text) return;

  const replyTarget = replyTargetOf(space, message.thread?.name);
  const conversationKey = conversationKeyOf(
    replyTarget.space,
    replyTarget.thread,
  );
  const id = message.name ?? `${conversationKey}:${evt.eventTime ?? ""}`;

  await ctx.history.append(conversationKey, {
    role: "user",
    content: text,
    ts: message.createTime ?? evt.eventTime ?? `${Date.now()}`,
    id,
  });

  await ctx.sink.onTurn({
    conversationKey,
    replyTarget,
    userText: text,
    operation: {
      kind: "created",
      logicalMessageId: id,
      revisionId: id,
      // A direct message always addresses the app.
      mentioned: isDirectMessage(space) || mentionsApp(evt, ctx.botUserId),
    },
    messageRef: {
      id,
      space: replyTarget.space,
      ...(replyTarget.thread ? { thread: replyTarget.thread } : {}),
    },
    actor: actorOf(sender),
    identityContext: identityContextOf(evt, conversationKey, "message", id),
    ...(message.name ? { eventId: message.name } : {}),
    platform: PLATFORM,
  });
}
