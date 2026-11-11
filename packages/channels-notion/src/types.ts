import type { StateStore } from "@copilotkit/channels-core";

/**
 * Options for the Notion adapter.
 *
 * The adapter talks to Notion as an integration (internal or public) that has
 * the "Read comments" and "Insert comments" capabilities. Inbound turns arrive
 * as `comment.created` webhook events.
 */
export interface NotionAdapterOptions {
  /** Integration secret. Sent as `Authorization: Bearer <token>`. */
  token: string;
  /**
   * Webhook subscription `verification_token`. Used as the HMAC-SHA256 key that
   * checks the `X-Notion-Signature` header on inbound POSTs.
   *
   * Notion sends this value once, in the verification POST, after you create
   * the subscription. Until it is set, only that verification POST is accepted
   * and every signed event is rejected.
   */
  verificationToken?: string;
  /**
   * Called with the `verification_token` from the one-time verification POST.
   * Store it and pass it back as `verificationToken`. When this is not set,
   * the adapter logs the token with `console.info`.
   */
  onVerificationToken?: (token: string) => void | Promise<void>;
  /**
   * Plain-text prefix that makes a comment a turn without a real mention
   * (default `@<bot name>`, where the bot name comes from `GET /v1/users/me`).
   * A comment is also a turn when it mentions the bot user, or when it is in a
   * discussion the bot already replied in.
   */
  trigger?: string;
  /**
   * Port for the built-in `node:http` webhook server. When it is not set, no
   * server starts: mount `handleWebhook(request)` in your own HTTP framework.
   */
  port?: number;
  /** Webhook path for the built-in server (default "/webhook"). */
  path?: string;
  /** Notion API base origin (default "https://api.notion.com"). Overridable for tests. */
  apiBaseUrl?: string;
  /** Value of the pinned `Notion-Version` request header (default "2026-03-11"). */
  notionVersion?: string;
  /** `fetch` used for every Notion API call (default `globalThis.fetch`). Overridable for tests. */
  fetch?: typeof fetch;
  /**
   * Adapter state: joined discussions and pending numbered choices
   * (default an in-process `MemoryStore`). Use a shared store when you run
   * more than one instance.
   */
  stateStore?: StateStore;
  /** Custom-event names treated as interrupts by the run renderer. */
  interruptEventNames?: ReadonlySet<string>;
}

/** Where a reply goes: one discussion thread on a Notion page or block. */
export interface ReplyTarget {
  /** Workspace the discussion lives in, from the webhook event. */
  workspaceId?: string;
  /** Page that holds the discussion (`data.page_id` of the event). */
  pageId: string;
  /**
   * Block that holds the discussion, when the comment is an inline comment
   * on a block inside the page. History is read from this block.
   */
  blockId?: string;
  /** Discussion thread that replies are posted to (`discussion_id`). */
  discussionId: string;
}

/** A posted Notion comment: the comment id and the discussion it belongs to. */
export interface NotionMessageRef {
  /** Comment id. */
  id: string;
  /** Discussion thread the comment belongs to. */
  discussionId: string;
  [k: string]: unknown;
}

/** Text styling on a rich text item. All fields are optional on requests. */
export interface RichTextAnnotations {
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
  code?: boolean;
  /** Notion color name, for example "default" or "red_background". */
  color?: string;
}

/** Fields that every rich text item can carry. `plain_text` and `href` are response-only. */
interface RichTextBase {
  annotations?: RichTextAnnotations;
  plain_text?: string;
  href?: string | null;
}

/** A text segment. Notion caps `text.content` at 2000 characters per item. */
export interface RichTextTextItem extends RichTextBase {
  type: "text";
  text: { content: string; link?: { url: string } | null };
}

/** A user mention. The only mention kind the adapter writes or acts on. */
export interface RichTextUserMention {
  type: "user";
  user: NotionPartialUser;
}

/**
 * Any other mention kind (page, database, date, link preview, template).
 * Read-only for the adapter: it uses `plain_text` and ignores the rest.
 */
export interface RichTextOtherMention {
  type: "page" | "database" | "date" | "link_preview" | "template_mention";
  [k: string]: unknown;
}

/** A mention segment. */
export interface RichTextMentionItem extends RichTextBase {
  type: "mention";
  mention: RichTextUserMention | RichTextOtherMention;
}

/** An inline equation segment. Read-only for the adapter. */
export interface RichTextEquationItem extends RichTextBase {
  type: "equation";
  equation: { expression: string };
}

/** One rich text segment, as used in comment `rich_text` arrays. */
export type RichTextItem =
  | RichTextTextItem
  | RichTextMentionItem
  | RichTextEquationItem;

/** A user reference that carries only the id (as in `created_by`). */
export interface NotionPartialUser {
  object: "user";
  id: string;
}

/** A human workspace member. */
export interface NotionPersonUser extends NotionPartialUser {
  type: "person";
  name?: string | null;
  avatar_url?: string | null;
  person?: { email?: string };
}

/** An integration (bot) user, as returned by `GET /v1/users/me`. */
export interface NotionBotUser extends NotionPartialUser {
  type: "bot";
  name?: string | null;
  avatar_url?: string | null;
  bot?: { workspace_name?: string | null; [k: string]: unknown };
}

/** A full Notion user object. */
export type NotionUser = NotionPersonUser | NotionBotUser;

/** Parent of a comment: a page, or a block inside a page. */
export type NotionCommentParent =
  | { type: "page_id"; page_id: string }
  | { type: "block_id"; block_id: string };

/** A Notion comment object (the subset the adapter reads). */
export interface NotionComment {
  object?: "comment";
  id: string;
  discussion_id: string;
  parent: NotionCommentParent;
  created_by: NotionPartialUser;
  created_time: string;
  last_edited_time?: string;
  rich_text: RichTextItem[];
}

/** Body of the one-time verification POST Notion sends to a new subscription. */
export interface NotionVerificationBody {
  verification_token: string;
}

/** Who caused a webhook event. */
export interface NotionWebhookAuthor {
  id: string;
  type: "person" | "bot" | "agent";
}

/**
 * A signed webhook event.
 *
 * Events are sparse: a `comment.created` event carries the comment id in
 * `entity.id` and the page in `data.page_id`, but no text and no
 * `discussion_id`. The adapter fetches the comment to get those.
 */
export interface NotionWebhookEvent {
  id: string;
  timestamp: string;
  workspace_id: string;
  workspace_name?: string;
  subscription_id: string;
  integration_id: string;
  /** Event type, for example "comment.created". */
  type: string;
  authors: NotionWebhookAuthor[];
  /** Delivery attempt, from 1 to 8. */
  attempt_number?: number;
  entity: { id: string; type: string };
  data: {
    page_id?: string;
    parent?: { id: string; type: "page" | "block" };
    /** Present only for comments on a database page property. */
    property_id?: string;
  };
}

/** Any JSON body Notion POSTs to the webhook URL. */
export type NotionWebhookBody = NotionVerificationBody | NotionWebhookEvent;
