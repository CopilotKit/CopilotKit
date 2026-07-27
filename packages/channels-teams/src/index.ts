// Public API for @copilotkit/channels-teams.

export { teams, TeamsAdapter } from "./adapter.js";
export type {
  TeamsAdapterOptions,
  TeamsReplyTarget,
  ConversationKey,
} from "./types.js";

export { TeamsConversationStore } from "./conversation-store.js";

export { createRunRenderer } from "./event-renderer.js";

export { conversationKeyOf, parseCardAction } from "./interaction.js";

export { renderTeamsMarkdown } from "./render/markdown.js";
export { autoCloseOpenMarkdown } from "./render/auto-close.js";
export {
  renderAdaptiveCard,
  isPlainText,
  collectPlainText,
  ADAPTIVE_CARD_CONTENT_TYPE,
} from "./render/adaptive-card.js";
export type { AdaptiveCard } from "./render/adaptive-card.js";
export { TEAMS_LIMITS, truncateText, clampArray } from "./render/budget.js";
export { TeamsMessageStream } from "./message-stream.js";
export type { TeamsMessageStreamConfig } from "./message-stream.js";

export { createTeamsServer } from "./listener.js";
export type { TeamsServer, TeamsServerConfig } from "./listener.js";

export { SanitizingHttpAgent } from "./sanitizing-http-agent.js";

export { buildFileContentParts, decodeFileBytes } from "./download-files.js";
export type {
  TeamsAttachmentRef,
  FileDeliveryConfig,
} from "./download-files.js";

export { buildChannelFileContentParts } from "./graph-files.js";
export type { GraphCredentials, ChannelMessageRef } from "./graph-files.js";
