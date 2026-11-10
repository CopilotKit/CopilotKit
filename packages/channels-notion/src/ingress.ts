import type {
  IncomingTurn,
  IngressSink,
  StateStore,
} from "@copilotkit/channels-core";
import type { ProviderActor } from "@copilotkit/channels-ui";
import type { NotionApiClient } from "./client.js";
import {
  clearPendingChoices,
  isJoined,
  readPendingChoices,
} from "./conversation-state.js";
import { conversationKeyOf, decodeChoiceReply } from "./interaction.js";
import { richTextToPlainText } from "./render/rich-text.js";
import type {
  NotionComment,
  NotionMessageRef,
  NotionWebhookEvent,
  ReplyTarget,
  RichTextItem,
} from "./types.js";

/** The integration's own bot user, as `NotionApiClient.getBotUser` returns it. */
export type NotionBotIdentity = Awaited<
  ReturnType<NotionApiClient["getBotUser"]>
>;

/** What {@link prepareNotionEvent} needs to turn an event into ingress. */
export interface NotionIngressDeps {
  sink: Pick<IngressSink, "onTurn" | "onInteraction">;
  /** Holds pending numbered choices and joined discussions. */
  stateStore: StateStore;
  /** Fetches the comment: webhook events carry only its id. */
  client: Pick<NotionApiClient, "retrieveComment">;
  /** The bot user (cache it: it is read on every event). */
  bot: () => Promise<NotionBotIdentity>;
  /** Text prefix that makes a comment a turn (default `@<bot name>`). */
  trigger?: string;
}

/**
 * Prepare one signed Notion webhook event for the ingress sink.
 *
 * This is the part of ingress that can fail and needs no agent run, so the
 * webhook awaits it before it answers. When it throws, the webhook answers
 * 500 and Notion retries the delivery.
 *
 * Only `comment.created` is handled. The bot's own comments are ignored. The
 * comment is fetched, and then:
 *
 * - When the discussion has pending numbered choices and the reply is a choice
 *   number or label, the choices are cleared (the last step, so an earlier
 *   failure keeps them for the retry) and the result dispatches to
 *   `sink.onInteraction`.
 * - Otherwise the result dispatches to `sink.onTurn` when the comment mentions
 *   the bot user, starts with the trigger text, or is in a discussion the bot
 *   already replied in. The leading mention or trigger is removed from
 *   `userText`.
 * - Any other comment resolves to `undefined`: nothing to dispatch.
 *
 * @param event - A verified webhook event.
 * @param deps - Sink, state store, API client, bot user, and trigger.
 * @returns A function that hands the event to the sink, or `undefined`.
 * @throws `NotionApiError` when the bot user or the comment cannot be fetched.
 * @example
 * const dispatch = await prepareNotionEvent(event, deps);
 * await dispatch?.();
 */
export async function prepareNotionEvent(
  event: NotionWebhookEvent,
  deps: NotionIngressDeps,
) {
  if (event.type !== "comment.created") return;
  const bot = await deps.bot();
  const isOwnEvent =
    event.authors.length > 0 &&
    event.authors.every((author) => author.id === bot.id);
  if (isOwnEvent) return;

  const comment = await deps.client.retrieveComment(event.entity.id);
  if (comment.created_by.id === bot.id) return;
  const pageId = event.data.page_id ?? pageIdOf(comment);
  if (pageId === undefined) return;

  const discussionId = comment.discussion_id;
  const conversationKey = conversationKeyOf(discussionId);
  const replyTarget: ReplyTarget = {
    workspaceId: event.workspace_id,
    pageId,
    discussionId,
    ...(comment.parent.type === "block_id" && {
      blockId: comment.parent.block_id,
    }),
  };
  const actor: ProviderActor = { id: comment.created_by.id, kind: "human" };
  const identityContext = (trigger: string) => ({
    tenant: { id: event.workspace_id },
    installation: { id: event.integration_id || event.workspace_id },
    conversation: { id: conversationKey, kind: "thread" },
    trigger,
    event: { id: event.id, occurredAt: event.timestamp },
    raw: { event, comment },
  });
  const base = { conversationKey, replyTarget, actor, eventId: event.id };

  const text = richTextToPlainText(comment.rich_text);
  const mentioned = mentionsUser(comment.rich_text, bot.id);
  const trigger = resolveTrigger(bot, deps.trigger);
  const triggered = startsWithTrigger(text, trigger);
  const userText = addressedText(comment.rich_text, bot.id, trigger).trim();

  const pending = await readPendingChoices(deps.stateStore, discussionId);
  const interaction = pending
    ? decodeChoiceReply(userText, pending, {
        ...base,
        identityContext: identityContext("interaction"),
      })
    : undefined;
  if (interaction !== undefined) {
    await clearPendingChoices(deps.stateStore, discussionId);
    return async () => {
      await deps.sink.onInteraction(interaction);
    };
  }

  const isAddressed =
    mentioned || triggered || (await isJoined(deps.stateStore, discussionId));
  if (!isAddressed || userText === "") return;

  const messageRef: NotionMessageRef = { id: comment.id, discussionId };
  const turn: IncomingTurn = {
    ...base,
    userText,
    operation: {
      kind: "created",
      logicalMessageId: comment.id,
      revisionId: comment.id,
      mentioned: mentioned || triggered,
    },
    messageRef,
    identityContext: identityContext("message"),
    platform: "notion",
  };
  return async () => {
    await deps.sink.onTurn(turn);
  };
}

function pageIdOf(comment: NotionComment) {
  return comment.parent.type === "page_id" ? comment.parent.page_id : undefined;
}

function isUserMention(item: RichTextItem, userId: string) {
  return (
    item.type === "mention" &&
    item.mention.type === "user" &&
    item.mention.user.id === userId
  );
}

function mentionsUser(items: readonly RichTextItem[], userId: string) {
  return items.some((item) => isUserMention(item, userId));
}

function startsWithTrigger(text: string, trigger: string | undefined) {
  if (!trigger) return false;
  return text.trimStart().toLowerCase().startsWith(trigger.toLowerCase());
}

/**
 * The text trigger in effect: the configured one, or else `@<bot name>`.
 * Returns `undefined` when neither is set (the bot has no name).
 *
 * @param bot - The integration's bot user.
 * @param trigger - The configured trigger, when set.
 */
export function resolveTrigger(
  bot: NotionBotIdentity,
  trigger: string | undefined,
) {
  return trigger ?? (bot.name ? `@${bot.name}` : undefined);
}

/**
 * Comment text with a leading bot mention, or else a leading trigger,
 * removed. Ingress uses it for the turn text and the conversation store for
 * history, so both show the same words.
 *
 * @param items - The comment's `rich_text`.
 * @param botId - The integration's bot user id.
 * @param trigger - The resolved trigger (see {@link resolveTrigger}).
 */
export function addressedText(
  items: readonly RichTextItem[],
  botId: string,
  trigger: string | undefined,
) {
  const first = items.findIndex(
    (item) =>
      item.type === "mention" || richTextToPlainText([item]).trim() !== "",
  );
  const leadItem = first === -1 ? undefined : items[first];
  if (leadItem !== undefined && isUserMention(leadItem, botId)) {
    return richTextToPlainText(items.slice(first + 1));
  }
  const text = richTextToPlainText(items).trimStart();
  if (trigger && startsWithTrigger(text, trigger)) {
    return text.slice(trigger.length);
  }
  return text;
}
