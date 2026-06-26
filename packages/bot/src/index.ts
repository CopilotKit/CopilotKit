// Public API for @copilotkit/bot.

// Bot orchestration
export { createBot } from "./create-bot.js";
export type {
  Bot,
  CreateBotOptions,
  BotHandler,
  ThreadStartHandler,
  ReactionEvent,
  ReactionHandler,
  ModalSubmitEvent,
  ModalSubmitHandler,
  ModalCloseEvent,
  ModalCloseHandler,
  StoreConfig,
  LockConflictDecision,
  StatefulThread,
  BotComponent,
} from "./create-bot.js";

// Thread
export { Thread } from "./thread.js";
export type { ThreadDeps } from "./thread.js";

// Platform adapter boundary
export type {
  PlatformAdapter,
  RunRenderer,
  IngressSink,
  IncomingTurn,
  InteractionEvent,
  IncomingCommand,
  IncomingThreadStart,
  IncomingReaction,
  IncomingModalSubmit,
  IncomingModalClose,
  ModalSubmitResult,
  SurfaceCapabilities,
  ReplyTarget,
  ConversationStore,
  AgentSession,
  CapturedToolCall,
  CapturedInterrupt,
  UserQuery,
  NativePayload,
} from "./platform-adapter.js";

// Slash commands
export {
  defineBotCommand,
  normalizeCommandName,
  toCommandSpec,
} from "./commands.js";
export type { BotCommand, CommandContext, CommandSpec } from "./commands.js";

// Action store
export { InMemoryActionStore } from "./action-store.js";
export type { ActionStore, ActionSnapshot } from "./action-store.js";

// Action registry
export { ActionRegistry, ActionExpiredError } from "./action-registry.js";

// State store
export type { StateStore } from "./state/state-store.js";
export { MemoryStore } from "./state/memory-store.js";
export { runStateStoreConformance } from "./testing/state-store-conformance.js";
export { parseDuration } from "./state/duration.js";
export { createStateBackedConversationStore } from "./state/state-conversation-store.js";

// Transcripts
export { Transcripts } from "./transcripts.js";
export type {
  TranscriptEntry,
  Identity,
  TranscriptsConfig,
} from "./transcripts.js";

// Tools & context
export {
  toAgentToolDescriptors,
  parseToolArgs,
  stringifyHandlerResult,
  defineBotTool,
} from "./tools.js";
export type {
  BotTool,
  ObjectSchema,
  BotToolContext,
  ContextEntry,
  AgentToolDescriptor,
} from "./tools.js";

// Id / serialization helpers
export { mintId, stableStringify } from "./mint-id.js";

// Run loop
export { runAgentLoop } from "./run-loop.js";
export type { RunLoopArgs } from "./run-loop.js";

// Managed bots (Intelligence-delivered delivery). @internal — not a publicly
// documented API; exported so the closed-source runtime can wire transports.
export {
  intelligenceAdapter,
  IntelligenceAdapter,
} from "./managed/intelligence-adapter.js";
export type { IntelligenceAdapterOptions } from "./managed/intelligence-adapter.js";
export type { DeliverySource, EgressSink } from "./managed/transports.js";
export type {
  ManagedIngressEnvelope,
  EgressOperation,
  EgressOp,
  EgressResult,
  EgressRoute,
} from "./managed/contracts.js";
export {
  InMemoryDeliverySource,
  InMemoryEgressSink,
} from "./managed/in-memory-transports.js";

// Re-export the bot-ui component vocabulary + types for convenience.
export * from "@copilotkit/bot-ui";
