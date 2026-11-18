/**
 * `@copilotkit/runtime/v2`, the import path of the 2.0 runtime in CopilotKit
 * 1.x. In 2.0 it is a deprecated alias of the package root, so 1.x code that
 * imports from it keeps working. It exports:
 *
 * - every export of `@copilotkit/runtime`;
 * - the Built-in Agent exports that 1.x exported here. 2.0 exports them from
 *   `@copilotkit/runtime/agent`;
 * - the 1.x names of the runtime exports that 2.0 renamed with "Kit". Each
 *   old name is the same value or type as its new name.
 *
 * The root exports only the new names. `npx codemod @copilotkit/v2-migration`
 * moves the imports to the root and renames them. The build marks each name
 * of this entry deprecated in its declarations
 * (scripts/deprecations/v2-subpath-aliases.mts).
 */
import {
  CopilotKitIntelligenceRuntime,
  CopilotKitRuntime,
  CopilotKitSseRuntime,
  createCopilotKitRuntimeHandler,
} from "../index";
import type {
  CopilotKitCorsConfig,
  CopilotKitIntelligenceRuntimeLike,
  CopilotKitIntelligenceRuntimeOptions,
  CopilotKitRuntimeConstructor,
  CopilotKitRuntimeFetchHandler,
  CopilotKitRuntimeFetchHandlerWithChannels,
  CopilotKitRuntimeHandlerOptions,
  CopilotKitRuntimeHooks,
  CopilotKitRuntimeLearningConfig,
  CopilotKitRuntimeLearningContext,
  CopilotKitRuntimeLike,
  CopilotKitRuntimeLogger,
  CopilotKitRuntimeMemoryConfig,
  CopilotKitRuntimeOptions,
  CopilotKitRuntimeUser,
  CopilotKitSseRuntimeLike,
  CopilotKitSseRuntimeOptions,
} from "../index";

export * from "../index";

// 1.x exported the Built-in Agent from `/v2`. The AI SDK helpers of
// `@copilotkit/runtime/agent/ai-sdk` stay out: they load the optional `ai`
// peer, and every `/v2` import would then need it.
export {
  BuiltInAgent,
  InterruptSignal,
  convertAISDKStream,
  convertInputToTanStackAI,
  convertTanStackStream,
  defineTool,
} from "../agent";
export type {
  BuiltInAgentAISDKFactoryConfig,
  BuiltInAgentClassicConfig,
  BuiltInAgentConfiguration,
  BuiltInAgentCustomFactoryConfig,
  BuiltInAgentFactoryConfig,
  BuiltInAgentFactoryContext,
  BuiltInAgentLearnedSkills,
  BuiltInAgentLearnedSkillsOptions,
  BuiltInAgentTanStackFactoryConfig,
  OverridableProperty,
  TanStackChatMessage,
  TanStackInputResult,
  ToolDefinition,
} from "../agent";

/* ------------------------------------------------------------------------------------------------
 * The 1.x names
 *
 * 2.0 renamed these exports with "Kit" after "Copilot". Each old name is an
 * alias of its new name: the same value, and the same type.
 * --------------------------------------------------------------------------------------------- */

/**
 * @deprecated Use `CopilotKitRuntime` from `@copilotkit/runtime`. This old
 * name is an alias of it. To move your imports, run
 * `npx codemod @copilotkit/v2-migration`.
 */
export const CopilotRuntime = CopilotKitRuntime;
/**
 * @deprecated Use `CopilotKitRuntime` from `@copilotkit/runtime`. This old
 * name is an alias of it. To move your imports, run
 * `npx codemod @copilotkit/v2-migration`.
 */
export type CopilotRuntime = CopilotKitRuntime;

/**
 * @deprecated Use `CopilotKitSseRuntime` from `@copilotkit/runtime`. This old
 * name is an alias of it. To move your imports, run
 * `npx codemod @copilotkit/v2-migration`.
 */
export const CopilotSseRuntime = CopilotKitSseRuntime;
/**
 * @deprecated Use `CopilotKitSseRuntime` from `@copilotkit/runtime`. This old
 * name is an alias of it. To move your imports, run
 * `npx codemod @copilotkit/v2-migration`.
 */
export type CopilotSseRuntime = CopilotKitSseRuntime;

/**
 * @deprecated Use `CopilotKitIntelligenceRuntime` from `@copilotkit/runtime`.
 * This old name is an alias of it. To move your imports, run
 * `npx codemod @copilotkit/v2-migration`.
 */
export const CopilotIntelligenceRuntime = CopilotKitIntelligenceRuntime;
/**
 * @deprecated Use `CopilotKitIntelligenceRuntime` from `@copilotkit/runtime`.
 * This old name is an alias of it. To move your imports, run
 * `npx codemod @copilotkit/v2-migration`.
 */
export type CopilotIntelligenceRuntime = CopilotKitIntelligenceRuntime;

/**
 * @deprecated Use `createCopilotKitRuntimeHandler` from `@copilotkit/runtime`.
 * This old name is an alias of it. To move your imports, run
 * `npx codemod @copilotkit/v2-migration`.
 */
export const createCopilotRuntimeHandler = createCopilotKitRuntimeHandler;

/**
 * @deprecated Use `CopilotKitRuntimeConstructor` from `@copilotkit/runtime`.
 * This old name is an alias of it. To move your imports, run
 * `npx codemod @copilotkit/v2-migration`.
 */
export type CopilotRuntimeConstructor = CopilotKitRuntimeConstructor;
/**
 * @deprecated Use `CopilotKitRuntimeOptions` from `@copilotkit/runtime`. This
 * old name is an alias of it. To move your imports, run
 * `npx codemod @copilotkit/v2-migration`.
 */
export type CopilotRuntimeOptions = CopilotKitRuntimeOptions;
/**
 * @deprecated Use `CopilotKitRuntimeLike` from `@copilotkit/runtime`. This old
 * name is an alias of it. To move your imports, run
 * `npx codemod @copilotkit/v2-migration`.
 */
export type CopilotRuntimeLike = CopilotKitRuntimeLike;
/**
 * @deprecated Use `CopilotKitSseRuntimeOptions` from `@copilotkit/runtime`.
 * This old name is an alias of it. To move your imports, run
 * `npx codemod @copilotkit/v2-migration`.
 */
export type CopilotSseRuntimeOptions = CopilotKitSseRuntimeOptions;
/**
 * @deprecated Use `CopilotKitSseRuntimeLike` from `@copilotkit/runtime`. This
 * old name is an alias of it. To move your imports, run
 * `npx codemod @copilotkit/v2-migration`.
 */
export type CopilotSseRuntimeLike = CopilotKitSseRuntimeLike;
/**
 * @deprecated Use `CopilotKitIntelligenceRuntimeOptions` from
 * `@copilotkit/runtime`. This old name is an alias of it. To move your
 * imports, run `npx codemod @copilotkit/v2-migration`.
 */
export type CopilotIntelligenceRuntimeOptions =
  CopilotKitIntelligenceRuntimeOptions;
/**
 * @deprecated Use `CopilotKitIntelligenceRuntimeLike` from
 * `@copilotkit/runtime`. This old name is an alias of it. To move your
 * imports, run `npx codemod @copilotkit/v2-migration`.
 */
export type CopilotIntelligenceRuntimeLike = CopilotKitIntelligenceRuntimeLike;
/**
 * @deprecated Use `CopilotKitRuntimeMemoryConfig` from `@copilotkit/runtime`.
 * This old name is an alias of it. To move your imports, run
 * `npx codemod @copilotkit/v2-migration`.
 */
export type CopilotRuntimeMemoryConfig = CopilotKitRuntimeMemoryConfig;
/**
 * @deprecated Use `CopilotKitRuntimeUser` from `@copilotkit/runtime`. This old
 * name is an alias of it. To move your imports, run
 * `npx codemod @copilotkit/v2-migration`.
 */
export type CopilotRuntimeUser = CopilotKitRuntimeUser;
/**
 * @deprecated Use `CopilotKitRuntimeLearningConfig` from
 * `@copilotkit/runtime`. This old name is an alias of it. To move your
 * imports, run `npx codemod @copilotkit/v2-migration`.
 */
export type CopilotRuntimeLearningConfig = CopilotKitRuntimeLearningConfig;
/**
 * @deprecated Use `CopilotKitRuntimeLearningContext` from
 * `@copilotkit/runtime`. This old name is an alias of it. To move your
 * imports, run `npx codemod @copilotkit/v2-migration`.
 */
export type CopilotRuntimeLearningContext = CopilotKitRuntimeLearningContext;
/**
 * @deprecated Use `CopilotKitRuntimeLogger` from `@copilotkit/runtime`. This
 * old name is an alias of it. To move your imports, run
 * `npx codemod @copilotkit/v2-migration`.
 */
export type CopilotRuntimeLogger = CopilotKitRuntimeLogger;
/**
 * @deprecated Use `CopilotKitRuntimeHandlerOptions` from
 * `@copilotkit/runtime`. This old name is an alias of it. To move your
 * imports, run `npx codemod @copilotkit/v2-migration`.
 */
export type CopilotRuntimeHandlerOptions = CopilotKitRuntimeHandlerOptions;
/**
 * @deprecated Use `CopilotKitRuntimeFetchHandler` from `@copilotkit/runtime`.
 * This old name is an alias of it. To move your imports, run
 * `npx codemod @copilotkit/v2-migration`.
 */
export type CopilotRuntimeFetchHandler = CopilotKitRuntimeFetchHandler;
/**
 * @deprecated Use `CopilotKitRuntimeFetchHandlerWithChannels` from
 * `@copilotkit/runtime`. This old name is an alias of it. To move your
 * imports, run `npx codemod @copilotkit/v2-migration`.
 */
export type CopilotRuntimeFetchHandlerWithChannels =
  CopilotKitRuntimeFetchHandlerWithChannels;
/**
 * @deprecated Use `CopilotKitRuntimeHooks` from `@copilotkit/runtime`. This
 * old name is an alias of it. To move your imports, run
 * `npx codemod @copilotkit/v2-migration`.
 */
export type CopilotRuntimeHooks = CopilotKitRuntimeHooks;
/**
 * @deprecated Use `CopilotKitCorsConfig` from `@copilotkit/runtime`. This old
 * name is an alias of it. To move your imports, run
 * `npx codemod @copilotkit/v2-migration`.
 */
export type CopilotCorsConfig = CopilotKitCorsConfig;
