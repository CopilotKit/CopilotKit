export { createSlackBridge } from "./bridge.js";
export type { SlackBridge, SlackBridgeConfig } from "./bridge.js";

export { SlackConversationStore } from "./conversation-store.js";
export type { AgentSession } from "./conversation-store.js";

export type {
  ConversationKey,
  IncomingTurn,
  ReplyTarget,
} from "./types.js";
export { DM_SCOPE } from "./types.js";

export { MessageStream } from "./message-stream.js";
export type { MessageStreamConfig } from "./message-stream.js";

export { ChunkedMessageStream } from "./chunked-message-stream.js";
export type { ChunkedMessageStreamConfig } from "./chunked-message-stream.js";

export { markdownToMrkdwn } from "./markdown-to-mrkdwn.js";

export { createSlackEventRenderer } from "./event-renderer.js";

export type {
  FrontendTool,
  FrontendToolContext,
  AgentToolDescriptor,
  SlackContextEntry,
} from "./frontend-tools.js";
export { toAgentToolDescriptors, parseToolArgs } from "./frontend-tools.js";

export {
  lookupSlackUserTool,
  defaultSlackTools,
} from "./built-in-tools.js";

export {
  slackTaggingContext,
  slackFormattingContext,
  slackConversationModelContext,
  defaultSlackContext,
} from "./built-in-context.js";

export type { SlackComponent } from "./slack-component.js";
export {
  defineSlackComponent,
  componentToFrontendTool,
} from "./slack-component.js";

export type {
  HumanInTheLoop,
  HitlRenderApi,
  HitlRenderState,
  HitlRenderResult,
  HitlResult,
  SlackClickMetadata,
} from "./human-in-the-loop.js";
export {
  defineHumanInTheLoop,
  hitlToFrontendTool,
  HumanInTheLoopRegistry,
} from "./human-in-the-loop.js";

export type {
  InterruptHandler,
  CapturedInterrupt,
} from "./interrupt.js";
export {
  defineInterruptHandler,
  DEFAULT_INTERRUPT_EVENT_NAME,
} from "./interrupt.js";
