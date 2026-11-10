export { notion, NotionAdapter } from "./adapter.js";
export type {
  NotionAdapterOptions,
  ReplyTarget,
  NotionMessageRef,
  RichTextAnnotations,
  RichTextTextItem,
  RichTextUserMention,
  RichTextOtherMention,
  RichTextMentionItem,
  RichTextEquationItem,
  RichTextItem,
  NotionPartialUser,
  NotionPersonUser,
  NotionBotUser,
  NotionUser,
  NotionCommentParent,
  NotionComment,
  NotionVerificationBody,
  NotionWebhookAuthor,
  NotionWebhookEvent,
  NotionWebhookBody,
} from "./types.js";

export { createWebhookHandler } from "./webhook.js";
export type { WebhookHandlerOptions } from "./webhook.js";
export { NotionWebhookServer } from "./webhook-server.js";
export type { NotionWebhookServerOptions } from "./webhook-server.js";

export { NotionApiClient, NotionApiError } from "./client.js";
export type { NotionApiClientOptions } from "./client.js";

export {
  renderNotionMessage,
  NOTION_CHOICE_PROMPT,
  NOTION_VALUE_ONLY_ACTION_ID,
} from "./render/message.js";
export type { RenderedChoice } from "./render/message.js";
export { NOTION_LIMITS, truncateText } from "./render/budget.js";
export {
  markdownToRichText,
  plainTextToRichText,
  richTextToPlainText,
} from "./render/rich-text.js";

export {
  defaultNotionContext,
  notionFormattingContext,
  notionDeliveryContext,
} from "./built-in-context.js";

export { conversationKeyOf } from "./interaction.js";
export { NotionConversationStore } from "./conversation-store.js";
export type { NotionConversationStoreOptions } from "./conversation-store.js";
export { createRunRenderer } from "./event-renderer.js";
export type {
  NotionRunRendererOptions,
  RunRendererTimers,
} from "./event-renderer.js";
