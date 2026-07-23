export {
  telegram,
  TelegramAdapter,
  TELEGRAM_ALLOWED_UPDATES,
} from "./adapter.js";

export { GrammyTelegramConnector } from "./telegram-connector.js";
export type {
  TelegramConnector,
  GrammyTelegramConnectorOptions,
  TelegramIngressConfig,
  TelegramIngressConnection,
  TelegramSentMessage,
  TelegramConnectorChat,
  TelegramDownloadResult,
  TelegramReplyMarkup,
} from "./telegram-connector.js";

export { FakeTelegramConnector } from "./testing/fake-telegram-connector.js";
export type {
  FakeTelegramConnectorResults,
  TelegramConnectorCall,
} from "./testing/fake-telegram-connector.js";

export { createRunRenderer } from "./event-renderer.js";
export type { CreateRunRendererArgs } from "./event-renderer.js";

export {
  decodeInteraction,
  conversationKeyOf,
  deriveConversationKey,
  toPlatformUser,
} from "./interaction.js";

export { renderTelegram } from "./render/telegram.js";

export {
  TELEGRAM_LIMITS,
  truncateText,
  clampArray,
  byteLen,
} from "./render/budget.js";

export {
  defaultTelegramTools,
  lookupTelegramUserTool,
} from "./built-in-tools.js";

export {
  defaultTelegramContext,
  telegramTaggingContext,
  telegramFormattingContext,
  telegramConversationModelContext,
} from "./built-in-context.js";

export { telegramHtml, escapeHtml } from "./telegram-html.js";

export { withTelegramFormatFallback, stripHtml } from "./format-fallback.js";

export { TelegramConversationStore } from "./conversation-store.js";

export { ChunkedEditStream } from "./chunked-edit-stream.js";
export type { ChunkedEditStreamConfig } from "./chunked-edit-stream.js";

export { attachTelegramListener } from "./listener.js";
export type { ListenerConfig } from "./listener.js";

export { buildFileContentParts } from "./download-files.js";
export type {
  TelegramFileRef,
  AgentContentPart,
  FileDeliveryConfig,
} from "./download-files.js";

export type {
  ConversationKey,
  ReplyTarget,
  TelegramMessageRef,
  TelegramInlineButton,
  TelegramPayload,
  TelegramAdapterOptions,
} from "./types.js";
export { DM_SCOPE } from "./types.js";
