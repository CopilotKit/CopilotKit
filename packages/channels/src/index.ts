// Public API for @copilotkit/channels.

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
  AdapterStartContext,
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
// NOTE: `runStateStoreConformance` is intentionally NOT re-exported here. It
// pulls in `vitest`, so re-exporting it from the package entry would drag a
// test framework into every consumer's runtime module graph (a bare
// `import ... from "@copilotkit/channels"` would fail unless vitest is installed).
// It is published under the `@copilotkit/channels/testing` subpath instead.
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

// Pure, per-platform codec seam (shared with the managed/Connector-Outbox path).
// The Intelligence-delivered managed adapter itself lives in
// `@copilotkit/channels-intelligence`.
export type { PlatformCodec } from "./codec.js";

// Test utilities (also surfaces them for downstream adapter packages' tests).
export { FakeAdapter, makeFakeRunRenderer } from "./testing/fake-adapter.js";
export { FakeAgent } from "./testing/fake-agent.js";

// Re-export the bot-ui component vocabulary + types for convenience.
export * from "@copilotkit/channels-ui";
