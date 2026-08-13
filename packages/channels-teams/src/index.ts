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
  renderTeamsComponentCard,
  isPlainText,
  collectPlainText,
  ADAPTIVE_CARD_CONTENT_TYPE,
} from "./render/adaptive-card.js";
export type { AdaptiveCard } from "./render/adaptive-card.js";
export { TEAMS_LIMITS, truncateText, clampArray } from "./render/budget.js";
export { TeamsMessageStream } from "./message-stream.js";
export type { TeamsMessageStreamConfig } from "./message-stream.js";
export { TEAMS_COMPONENT_EDIT_INTERVAL_MS } from "./component-delivery.js";

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
export { Teams } from "./native.js";
export { renderTeamsComponentNativeCard } from "./native-codec.js";
export type { TeamsNativeProps, TeamsRawProps } from "./native.js";
export {
  TEAMS_NATIVE_MANIFEST,
  TEAMS_BODY_MANIFEST,
  TEAMS_ELEMENT_MANIFEST,
  TEAMS_INPUT_MANIFEST,
  TEAMS_CHART_MANIFEST,
  TEAMS_GRAPH_MANIFEST,
  TEAMS_ACTION_MANIFEST,
  TEAMS_LAYOUT_MANIFEST,
  TEAMS_PREVIEW_MANIFEST,
} from "./native-manifest.js";
