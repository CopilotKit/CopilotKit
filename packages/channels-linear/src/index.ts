export { linear, LinearAdapter } from "./adapter.js";
export type {
  LinearAdapterOptions,
  ReplyTarget,
  LinearMessageRef,
  AgentActivityType,
  AgentActivityContent,
  ThoughtActivityContent,
  ActionActivityContent,
  ResponseActivityContent,
  ElicitationActivityContent,
  ErrorActivityContent,
  PromptActivityContent,
  AgentActivitySignal,
  SelectSignalMetadata,
  AuthSignalMetadata,
  AgentSessionEventWebhook,
  LinearWebhookAgentSession,
  LinearWebhookAgentActivity,
  LinearWebhookIssue,
  LinearWebhookUser,
} from "./types.js";

export { createWebhookHandler, MAX_WEBHOOK_AGE_MS } from "./webhook.js";
export type { WebhookHandlerOptions } from "./webhook.js";
export { LinearWebhookServer } from "./webhook-server.js";
export type { LinearWebhookServerOptions } from "./webhook-server.js";

export { LinearApiClient, LinearApiError } from "./client.js";
export type {
  LinearApiClientOptions,
  CreateActivityOptions,
  LinearGraphQLError,
  LinearSession,
  LinearSessionActivity,
  LinearViewer,
} from "./client.js";

export { renderLinearMessage, LINEAR_VALUE_ONLY_ID } from "./render/message.js";
export type { RenderedChoice } from "./render/message.js";
export { LINEAR_LIMITS, truncateText } from "./render/budget.js";

export {
  defaultLinearContext,
  linearFormattingContext,
  linearDeliveryContext,
} from "./built-in-context.js";

export { conversationKeyOf } from "./interaction.js";
export { LinearConversationStore } from "./conversation-store.js";
export type { LinearConversationStoreOptions } from "./conversation-store.js";
export { createRunRenderer } from "./event-renderer.js";
export type {
  LinearRunRenderer,
  LinearRunRendererArgs,
} from "./event-renderer.js";
