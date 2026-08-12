// Public API for @copilotkit/channels.

// Channel orchestration
export { createChannel } from "./create-channel.js";
export {
  isolateAgentInstance,
  resolveChannelConcurrency,
} from "./create-channel.js";
// Applied to every Channel agent by default; exported for the adapter packages
// and for anyone driving an agent outside a Channel.
export { sanitizeAgentEventStream } from "./sanitize-agent-events.js";
// The usual `agent` for a Channel is an AG-UI agent over HTTP. Re-exported so
// wiring one up needs no second import (any `AbstractAgent` still works).
export { HttpAgent } from "@ag-ui/client";
export type {
  Channel,
  CreateChannelOptions,
  ReplyContinuationOptions,
  ChannelHandler,
  WelcomeHandler,
  ThreadStartHandler,
  ReactionEvent,
  ReactionHandler,
  ModalSubmitEvent,
  ModalSubmitHandler,
  ModalCloseEvent,
  ModalCloseHandler,
  StoreConfig,
  LockConflictDecision,
  ChannelConcurrency,
  StatefulThread,
  ChannelComponent,
  ChannelComponentRegistration,
} from "./create-channel.js";
export { defineChannelComponent } from "./channel-component.js";
export type {
  ChannelComponentDefinition,
  ChannelComponentPlatform,
  ChannelComponentRenderContext,
} from "./channel-component.js";
export {
  ChannelIdentityResolutionError,
  ChannelIdentityResultError,
  resolveChannelUser,
} from "./identity.js";
export type {
  ChannelConversation,
  ChannelEvent,
  ChannelIdentifyUser,
  ChannelIdentityContext,
  ChannelInstallation,
  ChannelTenant,
  IngressIdentityContext,
} from "./identity.js";

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
  IncomingWelcome,
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
  ChannelAgentLifecycleArgs,
  ChannelAgentLoopResult,
  CanonicalRunIdentity,
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
export type {
  ActionStore,
  ActionSnapshot,
  ActionContinuationContext,
  ActionContinuationBinding,
  ActionContinuationInitiator,
  ActionContinuationSnapshot,
} from "./action-store.js";

// Action registry
export {
  ActionRegistry,
  ActionContinuationMismatchError,
  ActionExpiredError,
} from "./action-registry.js";

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
export type { TranscriptEntry, TranscriptsConfig } from "./transcripts.js";

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
export {
  ChannelContinuationRequiredError,
  ChannelMemorySubjectRequiredError,
  ChannelMemoryUnavailableError,
  ChannelMemoryUserRequiredError,
} from "./thread.js";
export {
  channelDeliveryErrorDetails,
  ChannelDeliveryTerminatedError,
  isChannelDeliveryTerminatedError,
} from "./delivery-error.js";
export type {
  ChannelDeliveryErrorDetails,
  ChannelDeliveryTerminatedErrorOptions,
} from "./delivery-error.js";

// Pure per-platform codec seam shared with managed Intelligence delivery.
// The Intelligence Channel adapter itself lives in
// `@copilotkit/channels-intelligence`.
export type { PlatformCodec } from "./codec.js";

// Per-run Intelligence Memory grants.
export {
  ChannelMemoryGrantInvalidError,
  hasMemoryAccess,
  resolveMemoryGrant,
} from "./memory.js";
export type {
  MemoryAccess,
  MemoryGrant,
  ResolvedChannelMemory,
} from "./memory.js";

// Test utilities (also surfaces them for downstream adapter packages' tests).
export { FakeAdapter, makeFakeRunRenderer } from "./testing/fake-adapter.js";
export { FakeAgent } from "./testing/fake-agent.js";

// Re-export the channels-ui component vocabulary + types for convenience.
export * from "@copilotkit/channels-ui";

// Image-render config + arbitrary-JSX detection
export * from "./render/config.js";
export * from "./render/detect.js";
