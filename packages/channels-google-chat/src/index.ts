export { googleChat, GoogleChatAdapter } from "./adapter.js";
export type {
  GoogleChatAdapterOptions,
  GoogleChatMessageRef,
  ReplyTarget,
} from "./types.js";
export { conversationKeyOf } from "./types.js";

export { GoogleChatConversationStore } from "./conversation-store.js";
export { InMemoryHistoryStore } from "./history-store.js";
export type {
  HistoryStore,
  InMemoryHistoryStoreOptions,
  StoredMessage,
} from "./history-store.js";

export { normalizeEvent, isDirectMessage } from "./events.js";
export type {
  NormalizedEvent,
  NormalizedKind,
  ChatMessage,
  ChatSpace,
  ChatUser,
} from "./events.js";
export { decodeInteraction } from "./interaction.js";

export { ChatClient } from "./chat-client.js";
export {
  createTokenProvider,
  createInboundVerifier,
  UnauthorizedError,
  CertFetchError,
} from "./auth.js";
export type { TokenProvider, InboundVerifier } from "./auth.js";
export {
  createRequestHandler,
  createNodeListener,
  startServer,
} from "./server.js";
export type {
  ChatRequestHandler,
  ChatWebhookRequest,
  ChatWebhookResponse,
} from "./server.js";

export { createRunRenderer } from "./event-renderer.js";
export { renderGoogleChatMessage } from "./render/cards-v2.js";
export type { RenderOptions } from "./render/cards-v2.js";
export { GCHAT_LIMITS } from "./render/budget.js";
export { markdownToChat } from "./markdown.js";
export { MessageStream } from "./message-stream.js";
export { ChunkedMessageStream } from "./chunked-message-stream.js";

export {
  lookupGoogleChatUserTool,
  defaultGoogleChatTools,
} from "./built-in-tools.js";
export {
  googleChatTaggingContext,
  googleChatFormattingContext,
  googleChatConversationModelContext,
  defaultGoogleChatContext,
} from "./built-in-context.js";
