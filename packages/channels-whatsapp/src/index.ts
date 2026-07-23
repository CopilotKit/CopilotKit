export { whatsapp, WhatsAppAdapter } from "./adapter.js";
export type {
  WhatsAppAdapterOptions,
  ReplyTarget,
  WhatsAppMessageRef,
} from "./types.js";

export { WhatsAppConversationStore } from "./conversation-store.js";
export { InMemoryHistoryStore } from "./history-store.js";
export type { HistoryStore, StoredMessage } from "./history-store.js";

export { renderWhatsAppMessage } from "./render/message.js";
export type { WhatsAppOutbound } from "./render/message.js";
export { WA_LIMITS, truncateText, clampArray } from "./render/budget.js";

export { markdownToWhatsApp } from "./markdown-to-wa.js";

export { decodeInteraction, conversationKeyOf } from "./interaction.js";
export { createRunRenderer } from "./event-renderer.js";

export { WhatsAppClient } from "./client.js";
export type { DownloadedMedia } from "./client.js";

export { WebClientWhatsAppConnector } from "./whatsapp-connector.js";
export type {
  WhatsAppConnector,
  WhatsAppIngressConfig,
  WebClientWhatsAppConnectorOptions,
} from "./whatsapp-connector.js";

export { FakeWhatsAppConnector } from "./testing/fake-whatsapp-connector.js";
export type {
  WhatsAppConnectorCall,
  FakeWhatsAppConnectorResults,
} from "./testing/fake-whatsapp-connector.js";

export { buildFileContentParts } from "./download-files.js";
export type { AgentContentPart, FileDeliveryConfig } from "./download-files.js";

export { defaultWhatsAppTools } from "./built-in-tools.js";
export {
  defaultWhatsAppContext,
  whatsAppFormattingContext,
  whatsAppDeliveryContext,
} from "./built-in-context.js";
