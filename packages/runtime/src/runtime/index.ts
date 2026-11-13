import {
  CopilotKitIntelligenceRuntime,
  CopilotKitRuntime,
  CopilotKitSseRuntime,
} from "./core/runtime";
import type {
  CopilotKitIntelligenceRuntimeLike,
  CopilotKitIntelligenceRuntimeOptions,
  CopilotKitRuntimeConstructor,
  CopilotKitRuntimeLearningConfig,
  CopilotKitRuntimeLearningContext,
  CopilotKitRuntimeLike,
  CopilotKitRuntimeLogger,
  CopilotKitRuntimeMemoryConfig,
  CopilotKitRuntimeOptions,
  CopilotKitRuntimeUser,
  CopilotKitSseRuntimeLike,
  CopilotKitSseRuntimeOptions,
} from "./core/runtime";
import type {
  CopilotKitRuntimeFetchHandler,
  CopilotKitRuntimeFetchHandlerWithChannels,
  CopilotKitRuntimeHandlerOptions,
} from "./core/fetch-handler";
import type { CopilotKitRuntimeHooks } from "./core/hooks";
import type { CopilotKitCorsConfig } from "./core/fetch-cors";

export * from "./core/runtime";

// Export the generative UI middlewares and surface writer
export {
  A2UIV09BridgeMiddleware,
  GenerativeUIMiddleware,
  createSurfaceWriter,
} from "./generative-ui";
export type { GenerativeUISurfaceWriter } from "./generative-ui";

// Export the A2UI / Open Generative UI middleware and the recorded-event
// transforms (moved from `@copilotkit/shared/event-transforms` in 2.0)
export * from "./event-transforms";

// Export agent runners and base types
export * from "./runner";

// Export transcription services
export * from "./transcription-service/transcription-service";

// Export CopilotKit Intelligence client and types
export {
  CopilotKitIntelligence,
  PlatformRequestError,
  LearnedSkillsError,
  type LearnedSkillsErrorCode,
  type GetLearnedSkillsSnapshotRequest,
  type GetLearnedSkillsSnapshotsRequest,
  type LearnedSkillsBatchResult,
  type LearnedSkillsSnapshotResult,
  type CopilotKitIntelligenceConfig,
  type CreateThreadRequest,
  type ThreadSummary,
  type ListThreadsResponse,
  type SubscribeToThreadsRequest,
  type SubscribeToThreadsResponse,
  type UpdateThreadRequest,
} from "./intelligence-platform";

// Export framework-agnostic fetch handler
export {
  createCopilotKitRuntimeHandler,
  createCopilotRuntimeHandler,
} from "./core/fetch-handler";
export type {
  CopilotKitRuntimeHandlerOptions,
  CopilotKitRuntimeFetchHandler,
  CopilotKitRuntimeFetchHandlerWithChannels,
} from "./core/fetch-handler";

// Export hook types
export type {
  CopilotKitRuntimeHooks,
  HookContext,
  HandlerHookContext,
  ResponseHookContext,
  ErrorHookContext,
  RouteInfo,
} from "./core/hooks";

// Export CORS config type
export type { CopilotKitCorsConfig } from "./core/fetch-cors";

// Export Channels control-surface types so consumers can name the type of
// `handler.channels` (see `core/channel-manager.ts`).
export type { ChannelsControl, ChannelStatus } from "./core/channel-manager";

export type { experimental } from "./intelligence-platform";

/* ------------------------------------------------------------------------------------------------
 * Deprecated names
 *
 * The 2.0 release candidates named these exports without "Kit". Each old name
 * is an alias of its CopilotKit name, with the same value and the same type.
 * --------------------------------------------------------------------------------------------- */

/** @deprecated Use CopilotKitRuntime. This old name is an alias with the same behavior. */
export const CopilotRuntime = CopilotKitRuntime;
/** @deprecated Use CopilotKitRuntime. This old name is an alias with the same behavior. */
export type CopilotRuntime = CopilotKitRuntime;

/** @deprecated Use CopilotKitSseRuntime. This old name is an alias with the same behavior. */
export const CopilotSseRuntime = CopilotKitSseRuntime;
/** @deprecated Use CopilotKitSseRuntime. This old name is an alias with the same behavior. */
export type CopilotSseRuntime = CopilotKitSseRuntime;

/** @deprecated Use CopilotKitIntelligenceRuntime. This old name is an alias with the same behavior. */
export const CopilotIntelligenceRuntime = CopilotKitIntelligenceRuntime;
/** @deprecated Use CopilotKitIntelligenceRuntime. This old name is an alias with the same behavior. */
export type CopilotIntelligenceRuntime = CopilotKitIntelligenceRuntime;

/** @deprecated Use CopilotKitRuntimeConstructor. This old name is an alias with the same behavior. */
export type CopilotRuntimeConstructor = CopilotKitRuntimeConstructor;
/** @deprecated Use CopilotKitRuntimeOptions. This old name is an alias with the same behavior. */
export type CopilotRuntimeOptions = CopilotKitRuntimeOptions;
/** @deprecated Use CopilotKitRuntimeLike. This old name is an alias with the same behavior. */
export type CopilotRuntimeLike = CopilotKitRuntimeLike;
/** @deprecated Use CopilotKitSseRuntimeOptions. This old name is an alias with the same behavior. */
export type CopilotSseRuntimeOptions = CopilotKitSseRuntimeOptions;
/** @deprecated Use CopilotKitSseRuntimeLike. This old name is an alias with the same behavior. */
export type CopilotSseRuntimeLike = CopilotKitSseRuntimeLike;
/** @deprecated Use CopilotKitIntelligenceRuntimeOptions. This old name is an alias with the same behavior. */
export type CopilotIntelligenceRuntimeOptions =
  CopilotKitIntelligenceRuntimeOptions;
/** @deprecated Use CopilotKitIntelligenceRuntimeLike. This old name is an alias with the same behavior. */
export type CopilotIntelligenceRuntimeLike = CopilotKitIntelligenceRuntimeLike;
/** @deprecated Use CopilotKitRuntimeMemoryConfig. This old name is an alias with the same behavior. */
export type CopilotRuntimeMemoryConfig = CopilotKitRuntimeMemoryConfig;
/** @deprecated Use CopilotKitRuntimeUser. This old name is an alias with the same behavior. */
export type CopilotRuntimeUser = CopilotKitRuntimeUser;
/** @deprecated Use CopilotKitRuntimeLearningConfig. This old name is an alias with the same behavior. */
export type CopilotRuntimeLearningConfig = CopilotKitRuntimeLearningConfig;
/** @deprecated Use CopilotKitRuntimeLearningContext. This old name is an alias with the same behavior. */
export type CopilotRuntimeLearningContext = CopilotKitRuntimeLearningContext;
/** @deprecated Use CopilotKitRuntimeLogger. This old name is an alias with the same behavior. */
export type CopilotRuntimeLogger = CopilotKitRuntimeLogger;
/** @deprecated Use CopilotKitRuntimeHandlerOptions. This old name is an alias with the same behavior. */
export type CopilotRuntimeHandlerOptions = CopilotKitRuntimeHandlerOptions;
/** @deprecated Use CopilotKitRuntimeFetchHandler. This old name is an alias with the same behavior. */
export type CopilotRuntimeFetchHandler = CopilotKitRuntimeFetchHandler;
/** @deprecated Use CopilotKitRuntimeFetchHandlerWithChannels. This old name is an alias with the same behavior. */
export type CopilotRuntimeFetchHandlerWithChannels =
  CopilotKitRuntimeFetchHandlerWithChannels;
/** @deprecated Use CopilotKitRuntimeHooks. This old name is an alias with the same behavior. */
export type CopilotRuntimeHooks = CopilotKitRuntimeHooks;
/** @deprecated Use CopilotKitCorsConfig. This old name is an alias with the same behavior. */
export type CopilotCorsConfig = CopilotKitCorsConfig;
