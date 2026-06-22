// Public API for @copilotkit/bot.

// Bot orchestration
export { createBot } from "./create-bot.js";
export type {
  Bot,
  CreateBotOptions,
  BotHandler,
  ThreadStartHandler,
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

// Re-export the bot-ui component vocabulary + types for convenience.
export * from "@copilotkit/bot-ui";
