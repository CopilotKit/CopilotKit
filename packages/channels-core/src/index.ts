// Public API for @copilotkit/channels.

// Channel orchestration
export { createChannel } from "./create-channel.js";
export type {
  Channel,
  CreateChannelOptions,
  ManagedChannelProvider,
  ChannelHandler,
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
  ChannelComponent,
} from "./create-channel.js";

// Thread
export { Thread } from "./thread.js";
export type { ThreadDeps } from "./thread.js";

// Channel agent binding + routing contracts (Task 2).
export type {
  ChannelAgentBinding,
  ChannelAgentRouter,
  ChannelAgentRouteContext,
  ChannelRouteEvent,
  ChannelRouteUser,
  ChannelConversationKind,
  ChannelAgentSelection,
  ChannelConcurrencyDecision,
  ChannelConcurrencyPolicy,
  ChannelConcurrencyContext,
  ChannelRuntimeInternals,
} from "./channel-agent.js";

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
  defineChannelCommand,
  normalizeCommandName,
  toCommandSpec,
} from "./commands.js";
export type {
  ChannelCommand,
  CommandContext,
  CommandSpec,
} from "./commands.js";

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
  defineChannelTool,
} from "./tools.js";
export type {
  ChannelTool,
  ObjectSchema,
  ChannelToolContext,
  ContextEntry,
  AgentToolDescriptor,
} from "./tools.js";

// Id / serialization helpers
export { mintId, stableStringify } from "./mint-id.js";

// Run loop
export { runAgentLoop } from "./run-loop.js";
export type { RunLoopArgs } from "./run-loop.js";

// Product-driven response policy (plan §2)
export { decideChannelResponse } from "./response-policy.js";
export type {
  ChannelResponseDecision,
  ChannelResponseInput,
} from "./response-policy.js";

// Pure, per-platform codec seam (shared with the Channel/Connector-Outbox path).
// The Intelligence Channel adapter itself lives in
// `@copilotkit/channels-intelligence`.
export type { PlatformCodec } from "./codec.js";

// Test utilities (also surfaces them for downstream adapter packages' tests).
export { FakeAdapter, makeFakeRunRenderer } from "./testing/fake-adapter.js";
export { FakeAgent } from "./testing/fake-agent.js";

// Re-export the channels-ui component vocabulary + types for convenience.
export * from "@copilotkit/channels-ui";
