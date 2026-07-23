export { SlackConversationStore } from "./conversation-store.js";
export type { AgentSession } from "./conversation-store.js";

// Pure Slack codec (render + normalize) shared with the managed/Connector-Outbox
// and webhook-ingress paths.
export { slackCodec } from "./codec.js";
export {
  normalizeSlackEvent,
  stripMentions,
  deriveEventId,
  isPlainUserMessage,
} from "./ingress-normalize.js";
export type {
  SlackNeutralEvent,
  PlainUserMessage,
} from "./ingress-normalize.js";

export type {
  ConversationKey,
  IncomingTurn,
  ResolvedSlackRespondToOptions,
  ReplyTarget,
  SlackAssistantOptions,
  SlackAppMentionOptions,
  SlackFeedback,
  SlackFeedbackOptions,
  SlackMentionReplyMode,
  SlackRespondToOptions,
} from "./types.js";
export {
  DEFAULT_SLACK_RESPOND_TO_OPTIONS,
  DM_SCOPE,
  resolveSlackRespondToOptions,
} from "./types.js";

export { MessageStream } from "./message-stream.js";
export type { MessageStreamConfig } from "./message-stream.js";

export { ChunkedMessageStream } from "./chunked-message-stream.js";
export type { ChunkedMessageStreamConfig } from "./chunked-message-stream.js";

export { NativeMessageStream } from "./native-stream.js";
export type {
  NativeMessageStreamConfig,
  NativeStreamTransport,
  TextStream,
} from "./native-stream.js";

export { attachAssistant } from "./assistant.js";
export type { AttachAssistantConfig, AssistantHandle } from "./assistant.js";

export {
  autoCloseOpenMarkdown,
  detectOpenContext,
  renderContextOpener,
} from "./auto-close-streaming.js";
export type { OpenMarkdownContext } from "./auto-close-streaming.js";

export { markdownToMrkdwn } from "./markdown-to-mrkdwn.js";

export { attachSlackListener } from "./slack-listener.js";
export type { ListenerConfig, TurnHandler } from "./slack-listener.js";

export {
  slackTaggingContext,
  slackFormattingContext,
  slackConversationModelContext,
  defaultSlackContext,
} from "./built-in-context.js";

export { SanitizingHttpAgent } from "./sanitizing-http-agent.js";

export { buildFileContentParts } from "./download-files.js";
export type {
  SlackFileRef,
  AgentContentPart,
  FileDeliveryConfig,
  FileDownloader,
} from "./download-files.js";

export { lookupSlackUserTool, defaultSlackTools } from "./built-in-tools.js";

export { slack, SlackAdapter } from "./adapter.js";
export type { SlackAdapterOptions } from "./adapter.js";

export { WebClientSlackConnector } from "./slack-connector.js";
export type {
  SlackConnector,
  SlackConnectorMember,
  SlackConnectorUserDetail,
  SlackConnectorHistoryMessage,
  SlackConnectorDownloadResult,
  SlackIngressConfig,
  SlackIngressConnection,
  SlackIngressLogLevel,
  WebClientSlackConnectorOptions,
} from "./slack-connector.js";

export { FakeSlackConnector } from "./testing/fake-slack-connector.js";
export type {
  SlackConnectorCall,
  FakeSlackConnectorResults,
} from "./testing/fake-slack-connector.js";

export { createRunRenderer } from "./event-renderer.js";
export type { SlackRenderTransport } from "./render/transport.js";

export { decodeInteraction, conversationKeyOf } from "./interaction.js";

export {
  renderBlockKit,
  renderSlackMessage,
  buildFeedbackBlocks,
  FEEDBACK_ACTION_ID,
} from "./render/block-kit.js";
export { renderSlackModal } from "./render/modal.js";
export { SLACK_LIMITS } from "./render/budget.js";
