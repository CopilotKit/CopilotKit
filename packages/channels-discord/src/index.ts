// Public API for @copilotkit/channels-discord.

export { discord, DiscordAdapter } from "./adapter.js";
export type { DiscordAdapterOptions } from "./adapter.js";

export { DiscordConversationStore } from "./conversation-store.js";

export { attachDiscordListener } from "./discord-listener.js";
export type {
  ListenerConfig,
  ClientLike,
  IncomingCommandRaw,
} from "./discord-listener.js";

export { createRunRenderer } from "./event-renderer.js";
export type { ChannelLike } from "./event-renderer.js";

export { decodeInteraction } from "./interaction.js";

export { conversationKeyOf } from "./types.js";
export type { ReplyTarget, IncomingTurn } from "./types.js";

export {
  renderComponents,
  renderDiscordMessage,
} from "./render/components-v2.js";

export { DISCORD_LIMITS } from "./render/budget.js";

export { discordMarkdown } from "./markdown.js";

export { MessageStream } from "./message-stream.js";
export type { MessageStreamConfig } from "./message-stream.js";

export { ChunkedMessageStream } from "./chunked-message-stream.js";
export type { ChunkedMessageStreamConfig } from "./chunked-message-stream.js";

export { autoCloseOpenMarkdown } from "./auto-close-streaming.js";

export { registerCommands, jsonSchemaToDiscordOptions } from "./commands.js";

export { buildFileContentParts } from "./download-files.js";
export type {
  DiscordAttachmentRef,
  AgentContentPart,
  FileDeliveryConfig,
  MediaDataSource,
} from "./download-files.js";

export {
  defaultDiscordContext,
  discordTaggingContext,
  discordFormattingContext,
  discordConversationModelContext,
} from "./built-in-context.js";

export {
  lookupDiscordUserTool,
  defaultDiscordTools,
} from "./built-in-tools.js";
