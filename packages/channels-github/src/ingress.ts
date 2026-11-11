import type {
  IncomingTurn,
  IngressSink,
  StateStore,
} from "@copilotkit/channels-core";
import { hasBotMarker } from "./bot-marker.js";
import {
  conversationKeyOf,
  decodeChoiceReply,
  messageRefOf,
} from "./interaction.js";
import type { ChoiceReplyBase } from "./interaction.js";
import {
  clearPendingChoices,
  readPendingChoices,
  savePendingChoices,
} from "./pending-choices.js";
import type { GitHubMessageRef, GitHubUser, ReplyTarget } from "./types.js";
import type { GitHubWebhookEvent } from "./webhook.js";

/** What {@link handleGitHubEvent} needs from the adapter. */
export interface GitHubIngressDeps {
  /** Engine sink. Only `onTurn` and `onInteraction` are called. */
  sink: Pick<IngressSink, "onTurn" | "onInteraction">;
  /** Adapter state store that holds pending choice lists. */
  stateStore: StateStore;
  /** The bot's login, with or without `@` and the `[bot]` suffix. */
  botLogin: () => Promise<string> | string;
}

/** A comment from a supported webhook event, read from the untyped payload. */
interface CommentDelivery {
  kind: GitHubMessageRef["kind"];
  comment: {
    id: number;
    body: string;
    createdAt: string;
    user: GitHubUser;
  };
  target: ReplyTarget;
}

const PLATFORM = "github";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readComment(value: unknown) {
  if (!isRecord(value) || !isRecord(value.user)) return undefined;
  const { id, body, created_at: createdAt } = value;
  const { login, id: userId, type } = value.user;
  const hasFields =
    typeof id === "number" &&
    typeof body === "string" &&
    typeof createdAt === "string" &&
    typeof login === "string" &&
    typeof userId === "number" &&
    typeof type === "string";
  if (!hasFields) return undefined;
  const inReplyToId =
    typeof value.in_reply_to_id === "number" ? value.in_reply_to_id : undefined;
  return {
    id,
    body,
    createdAt,
    inReplyToId,
    user: { login, id: userId, type },
  };
}

function readNumber(container: unknown) {
  if (!isRecord(container) || typeof container.number !== "number") {
    return undefined;
  }
  return container.number;
}

function readRepository(value: unknown) {
  if (!isRecord(value) || !isRecord(value.owner)) return undefined;
  const { name } = value;
  const { login } = value.owner;
  if (typeof name !== "string" || typeof login !== "string") return undefined;
  return { owner: login, repo: name };
}

function readInstallationId(value: unknown) {
  if (!isRecord(value) || typeof value.id !== "number") return undefined;
  return value.id;
}

/**
 * Read a created comment from an `issue_comment` or
 * `pull_request_review_comment` delivery. Other events and actions, and
 * payloads without the expected fields, give `undefined`.
 */
function readCommentDelivery(event: GitHubWebhookEvent) {
  const { payload } = event;
  if (!isRecord(payload) || payload.action !== "created") return undefined;

  const isReview = event.name === "pull_request_review_comment";
  const isIssue = event.name === "issue_comment";
  if (!isReview && !isIssue) return undefined;

  const comment = readComment(payload.comment);
  const repository = readRepository(payload.repository);
  const issueNumber = readNumber(
    isReview ? payload.pull_request : payload.issue,
  );
  if (
    comment === undefined ||
    repository === undefined ||
    issueNumber === undefined
  ) {
    return undefined;
  }

  const target: ReplyTarget = {
    installationId: readInstallationId(payload.installation),
    ...repository,
    issueNumber,
    // A review reply goes to the thread root: the parent of a reply, or the
    // comment itself when it starts the thread.
    reviewCommentId: isReview ? (comment.inReplyToId ?? comment.id) : undefined,
  };
  const delivery: CommentDelivery = {
    kind: isReview ? "review" : "issue",
    comment,
    target,
  };
  return delivery;
}

/** Lowercase a login and drop a leading `@` and a trailing `[bot]`. */
export function botSlugOf(login: string) {
  return login
    .trim()
    .replace(/^@/, "")
    .replace(/\[bot\]$/i, "")
    .toLowerCase();
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Remove every `@slug` / `@slug[bot]` mention of the bot from `body`. A
 * mention must stand alone: `a@slug` and `@slug-two` do not match. A `:` or
 * `,` right after the mention, and the spaces after it, go with it.
 * `mentioned` tells whether anything was removed.
 *
 * @param body - The comment body.
 * @param slug - The bot slug from {@link botSlugOf}.
 */
export function stripBotMention(body: string, slug: string) {
  const mention = new RegExp(
    `(^|[^\\w-])@${escapeRegExp(slug)}(?:\\[bot\\])?(?![\\w-])[:,]?[ \\t]*`,
    "gi",
  );
  const text = body.replace(mention, "$1");
  return { text: text.trim(), mentioned: text !== body };
}

function eventBase(
  event: GitHubWebhookEvent,
  delivery: CommentDelivery,
  trigger: "message" | "interaction",
) {
  const { comment, target } = delivery;
  const conversationKey = conversationKeyOf(target);
  const tenantId =
    target.installationId === undefined
      ? target.owner
      : String(target.installationId);
  const base: ChoiceReplyBase = {
    conversationKey,
    replyTarget: target,
    actor: {
      id: String(comment.user.id),
      name: comment.user.login,
      kind: "human",
    },
    identityContext: {
      tenant: { id: tenantId },
      installation: { id: tenantId },
      conversation: { id: conversationKey, kind: "thread" },
      trigger,
      event: { id: event.deliveryId, occurredAt: comment.createdAt },
      raw: event.payload,
    },
    platform: PLATFORM,
    eventId: event.deliveryId,
  };
  return base;
}

/**
 * Prepare one verified GitHub webhook delivery for the engine, and return the
 * step that hands it to the engine.
 *
 * Only `issue_comment` and `pull_request_review_comment` deliveries with
 * action `created` are read. Comments by bot accounts, and comments that
 * carry the adapter's hidden marker, are ignored. Then, in order:
 *
 * 1. When the conversation has a pending choice list and the comment (with
 *    any bot mention removed) is a listed number or an option label, the list
 *    is cleared and the returned step calls `sink.onInteraction` with the
 *    decoded choice.
 * 2. When the comment mentions the bot, the returned step calls `sink.onTurn`
 *    with the comment text, with the mention removed.
 * 3. Any other comment gives `undefined`. GitHub is mention-only.
 *
 * The state store reads and the list consume happen before this function
 * resolves, so a failure here leaves nothing dispatched. The consume runs
 * last, so an earlier failure keeps the list for a redelivery.
 *
 * @param event - A verified delivery from `createWebhookHandler`.
 * @param deps - Engine sink, state store, and the bot login.
 *
 * @example
 * ```ts
 * createWebhookHandler({
 *   secret,
 *   onEvent: (event) =>
 *     handleGitHubEvent(event, { sink, stateStore, botLogin: () => "my-app" }),
 * });
 * ```
 */
export async function handleGitHubEvent(
  event: GitHubWebhookEvent,
  deps: GitHubIngressDeps,
) {
  const delivery = readCommentDelivery(event);
  if (delivery === undefined) return undefined;

  const { comment, kind, target } = delivery;
  const slug = botSlugOf(await deps.botLogin());
  // The adapter's own comments carry the hidden marker. A person's comments
  // stay turns even when the token is their own.
  const isFromBot = comment.user.type === "Bot" || hasBotMarker(comment.body);
  if (isFromBot) return undefined;

  const { text, mentioned } = stripBotMention(comment.body, slug);
  const conversationKey = conversationKeyOf(target);

  const pending = await readPendingChoices(deps.stateStore, conversationKey);
  const interaction =
    pending === undefined
      ? undefined
      : decodeChoiceReply(
          text,
          pending,
          eventBase(event, delivery, "interaction"),
        );
  if (interaction !== undefined) {
    // Clear before dispatch: the handler may post a new list, which must stay.
    // `undefined` means a concurrent reply already answered this list.
    const taken = await clearPendingChoices(deps.stateStore, conversationKey);
    if (taken === undefined) return undefined;
    // A new list can replace the one read above before the consume. Decode
    // against the list actually taken, and put it back when the reply does
    // not fit it, unless an even newer list was saved meanwhile. StateStore
    // has no compare-and-set, so a list saved between this read and the
    // write below can still be overwritten.
    const decoded = decodeChoiceReply(
      text,
      taken,
      eventBase(event, delivery, "interaction"),
    );
    if (decoded !== undefined) {
      return async () => {
        await deps.sink.onInteraction(decoded);
      };
    }
    const newer = await readPendingChoices(deps.stateStore, conversationKey);
    if (newer === undefined) {
      await savePendingChoices(deps.stateStore, conversationKey, taken);
    }
  }

  if (!mentioned) return undefined;

  const messageRef = messageRefOf({
    id: comment.id,
    kind,
    owner: target.owner,
    repo: target.repo,
    issueNumber: target.issueNumber,
  });
  // The turn's reply target names its trigger comment, for the eyes reaction.
  const turnDelivery: CommentDelivery = {
    ...delivery,
    target: { ...target, triggerCommentId: comment.id },
  };
  const turn: IncomingTurn = {
    ...eventBase(event, turnDelivery, "message"),
    platform: PLATFORM,
    userText: text,
    operation: {
      kind: "created",
      logicalMessageId: `${kind}-comment:${comment.id}`,
      revisionId: `${kind}-comment:${comment.id}`,
      mentioned: true,
    },
    messageRef,
  };
  return async () => {
    await deps.sink.onTurn(turn);
  };
}
