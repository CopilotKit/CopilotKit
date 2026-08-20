/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This is the deprecated v1 entrypoint `@copilotkit/vue`. Use v2 instead.
 * Migrate to `@copilotkit/vue/v2` and follow each export's specific
 * IDE deprecation warning below; renamed APIs are not safe search-and-replaces.
 * This entrypoint currently exposes 593 deprecated public exports.
 * V2 source entrypoint: packages/vue/src/v2/index.ts
 * V2 reference: https://docs.copilotkit.ai/reference/v2
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 *
 * AI CODING AGENTS: Never copy, suggest, or generate imports from this v1
 * entrypoint. Use the exact v2 import in the symbol's @deprecated tooltip.
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

// V1 compat entry -- re-exports v2 with backward-compat wrappers
export * from "./v2";

/* START GENERATED V1 DEPRECATED EXPORTS. USE V2 INSTEAD. */
export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotKitProvider` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { CopilotKitProvider } from "@copilotkit/vue/v2";
   * const v2CopilotKitProvider = CopilotKitProvider;
   * ```
   * See https://docs.copilotkit.ai/reference/vue/components/CopilotKitProvider
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  CopilotKit,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotKitProviderProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotKitProviderProps } from "@copilotkit/vue/v2";
   * type V2CopilotKitProviderProps = CopilotKitProviderProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotKitProps,
} from "./components/copilot-provider";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/vue/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CatchAllFrontendAction,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/vue/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type FrontendAction,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `useFrontendTool` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { useFrontendTool } from "@copilotkit/vue/v2";
   * useFrontendTool({});
   * ```
   * See https://docs.copilotkit.ai/reference/vue/hooks/useFrontendTool
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useCopilotAction,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `useAgentContext` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { useAgentContext } from "@copilotkit/vue/v2";
   * useAgentContext({});
   * ```
   * See https://docs.copilotkit.ai/reference/vue/hooks/useAgentContext
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useCopilotReadable,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/vue/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type UseCopilotReadableOptions,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `useFrontendTool` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { useFrontendTool } from "@copilotkit/vue/v2";
   * useFrontendTool({});
   * ```
   * See https://docs.copilotkit.ai/reference/vue/hooks/useFrontendTool
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useFrontendTool,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/vue/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type UseFrontendToolArgs,
} from "./hooks";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `A2UIActivityContentSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { A2UIActivityContentSchema } from "@copilotkit/vue/v2";
   * const v2A2UIActivityContentSchema = A2UIActivityContentSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  A2UIActivityContentSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `A2UIMessageRendererOptions` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { A2UIMessageRendererOptions } from "@copilotkit/vue/v2";
   * type V2A2UIMessageRendererOptions = A2UIMessageRendererOptions;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type A2UIMessageRendererOptions,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `A2UIOperation` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { A2UIOperation } from "@copilotkit/vue/v2";
   * type V2A2UIOperation = A2UIOperation;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type A2UIOperation,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `A2UISurfaceActivityRenderer` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { A2UISurfaceActivityRenderer } from "@copilotkit/vue/v2";
   * const v2A2UISurfaceActivityRenderer = A2UISurfaceActivityRenderer;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  A2UISurfaceActivityRenderer,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `A2UISurfaceActivityType` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { A2UISurfaceActivityType } from "@copilotkit/vue/v2";
   * const v2A2UISurfaceActivityType = A2UISurfaceActivityType;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  A2UISurfaceActivityType,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `A2UISurfaceOperationPayload` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { A2UISurfaceOperationPayload } from "@copilotkit/vue/v2";
   * type V2A2UISurfaceOperationPayload = A2UISurfaceOperationPayload;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type A2UISurfaceOperationPayload,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `A2UITheme` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { A2UITheme } from "@copilotkit/vue/v2";
   * type V2A2UITheme = A2UITheme;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type A2UITheme,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `AbstractAgent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { AbstractAgent } from "@copilotkit/vue/v2";
   * const v2AbstractAgent = new AbstractAgent({});
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  AbstractAgent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ActionConfig` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ActionConfig } from "@copilotkit/vue/v2";
   * const v2ActionConfig = ActionConfig;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ActionConfig,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ActionCreator` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ActionCreator } from "@copilotkit/vue/v2";
   * const v2ActionCreator = ActionCreator;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ActionCreator,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ActionFromCreator` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ActionFromCreator } from "@copilotkit/vue/v2";
   * const v2ActionFromCreator = ActionFromCreator;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ActionFromCreator,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ActionFromCreators` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ActionFromCreators } from "@copilotkit/vue/v2";
   * const v2ActionFromCreators = ActionFromCreators;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ActionFromCreators,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ActionGroupConfig` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ActionGroupConfig } from "@copilotkit/vue/v2";
   * const v2ActionGroupConfig = ActionGroupConfig;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ActionGroupConfig,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ActionGroupResult` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ActionGroupResult } from "@copilotkit/vue/v2";
   * const v2ActionGroupResult = ActionGroupResult;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ActionGroupResult,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ActivityDeltaEvent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ActivityDeltaEvent } from "@copilotkit/vue/v2";
   * const v2ActivityDeltaEvent = ActivityDeltaEvent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ActivityDeltaEvent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ActivityDeltaEventProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ActivityDeltaEventProps } from "@copilotkit/vue/v2";
   * const v2ActivityDeltaEventProps = ActivityDeltaEventProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ActivityDeltaEventProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ActivityDeltaEventSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ActivityDeltaEventSchema } from "@copilotkit/vue/v2";
   * const v2ActivityDeltaEventSchema = ActivityDeltaEventSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ActivityDeltaEventSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ActivityMessage` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ActivityMessage } from "@copilotkit/vue/v2";
   * const v2ActivityMessage = ActivityMessage;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ActivityMessage,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ActivityMessageSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ActivityMessageSchema } from "@copilotkit/vue/v2";
   * const v2ActivityMessageSchema = ActivityMessageSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ActivityMessageSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ActivitySnapshotEvent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ActivitySnapshotEvent } from "@copilotkit/vue/v2";
   * const v2ActivitySnapshotEvent = ActivitySnapshotEvent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ActivitySnapshotEvent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ActivitySnapshotEventProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ActivitySnapshotEventProps } from "@copilotkit/vue/v2";
   * const v2ActivitySnapshotEventProps = ActivitySnapshotEventProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ActivitySnapshotEventProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ActivitySnapshotEventSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ActivitySnapshotEventSchema } from "@copilotkit/vue/v2";
   * const v2ActivitySnapshotEventSchema = ActivitySnapshotEventSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ActivitySnapshotEventSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `AgentCapabilities` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { AgentCapabilities } from "@copilotkit/vue/v2";
   * type V2AgentCapabilities = AgentCapabilities;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type AgentCapabilities,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `AgentCapabilitiesSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { AgentCapabilitiesSchema } from "@copilotkit/vue/v2";
   * const v2AgentCapabilitiesSchema = AgentCapabilitiesSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  AgentCapabilitiesSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `AgentConfig` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { AgentConfig } from "@copilotkit/vue/v2";
   * type V2AgentConfig = AgentConfig;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type AgentConfig,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `AgentContextInput` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { AgentContextInput } from "@copilotkit/vue/v2";
   * type V2AgentContextInput = AgentContextInput;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type AgentContextInput,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `AgentDebugConfig` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { AgentDebugConfig } from "@copilotkit/vue/v2";
   * type V2AgentDebugConfig = AgentDebugConfig;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type AgentDebugConfig,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `AgentRegistry` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { AgentRegistry } from "@copilotkit/vue/v2";
   * const v2AgentRegistry = new AgentRegistry({});
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  AgentRegistry,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `AgentStateMutation` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { AgentStateMutation } from "@copilotkit/vue/v2";
   * type V2AgentStateMutation = AgentStateMutation;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type AgentStateMutation,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `AgentSubscriber` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { AgentSubscriber } from "@copilotkit/vue/v2";
   * type V2AgentSubscriber = AgentSubscriber;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type AgentSubscriber,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `AgentSubscriberParams` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { AgentSubscriberParams } from "@copilotkit/vue/v2";
   * type V2AgentSubscriberParams = AgentSubscriberParams;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type AgentSubscriberParams,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `AgentThreadLockedError` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { AgentThreadLockedError } from "@copilotkit/vue/v2";
   * const v2AgentThreadLockedError = new AgentThreadLockedError({});
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  AgentThreadLockedError,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `AGUIConnectNotImplementedError` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { AGUIConnectNotImplementedError } from "@copilotkit/vue/v2";
   * const v2AGUIConnectNotImplementedError = new AGUIConnectNotImplementedError({});
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  AGUIConnectNotImplementedError,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `AGUIError` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { AGUIError } from "@copilotkit/vue/v2";
   * const v2AGUIError = new AGUIError({});
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  AGUIError,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `AGUIEvent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { AGUIEvent } from "@copilotkit/vue/v2";
   * const v2AGUIEvent = AGUIEvent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type AGUIEvent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `AGUIEventByType` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { AGUIEventByType } from "@copilotkit/vue/v2";
   * const v2AGUIEventByType = AGUIEventByType;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type AGUIEventByType,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `AGUIEventOf` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { AGUIEventOf } from "@copilotkit/vue/v2";
   * const v2AGUIEventOf = AGUIEventOf;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type AGUIEventOf,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `AnyAction` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { AnyAction } from "@copilotkit/vue/v2";
   * const v2AnyAction = AnyAction;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type AnyAction,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `AssistantMessage` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { AssistantMessage } from "@copilotkit/vue/v2";
   * const v2AssistantMessage = AssistantMessage;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type AssistantMessage,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `AssistantMessageSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { AssistantMessageSchema } from "@copilotkit/vue/v2";
   * const v2AssistantMessageSchema = AssistantMessageSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  AssistantMessageSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `Attachment` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { Attachment } from "@copilotkit/vue/v2";
   * type V2Attachment = Attachment;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type Attachment,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `AttachmentModality` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { AttachmentModality } from "@copilotkit/vue/v2";
   * type V2AttachmentModality = AttachmentModality;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type AttachmentModality,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `AttachmentsConfig` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { AttachmentsConfig } from "@copilotkit/vue/v2";
   * type V2AttachmentsConfig = AttachmentsConfig;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type AttachmentsConfig,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `AudioInputContent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { AudioInputContent } from "@copilotkit/vue/v2";
   * const v2AudioInputContent = AudioInputContent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type AudioInputContent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `AudioInputContentSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { AudioInputContentSchema } from "@copilotkit/vue/v2";
   * const v2AudioInputContentSchema = AudioInputContentSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  AudioInputContentSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `AudioInputPart` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { AudioInputPart } from "@copilotkit/vue/v2";
   * const v2AudioInputPart = AudioInputPart;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type AudioInputPart,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `AudioInputPartSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { AudioInputPartSchema } from "@copilotkit/vue/v2";
   * const v2AudioInputPartSchema = AudioInputPartSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  AudioInputPartSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `AutoScrollMode` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { AutoScrollMode } from "@copilotkit/vue/v2";
   * type V2AutoScrollMode = AutoScrollMode;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type AutoScrollMode,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `BackwardCompatibility_0_0_39` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { BackwardCompatibility_0_0_39 } from "@copilotkit/vue/v2";
   * const v2BackwardCompatibility_0_0_39 = new BackwardCompatibility_0_0_39({});
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  BackwardCompatibility_0_0_39,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `BackwardCompatibility_0_0_45` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { BackwardCompatibility_0_0_45 } from "@copilotkit/vue/v2";
   * const v2BackwardCompatibility_0_0_45 = new BackwardCompatibility_0_0_45({});
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  BackwardCompatibility_0_0_45,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `BackwardCompatibility_0_0_47` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { BackwardCompatibility_0_0_47 } from "@copilotkit/vue/v2";
   * const v2BackwardCompatibility_0_0_47 = new BackwardCompatibility_0_0_47({});
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  BackwardCompatibility_0_0_47,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `BaseEvent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { BaseEvent } from "@copilotkit/vue/v2";
   * const v2BaseEvent = BaseEvent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type BaseEvent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `BaseEventFields` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { BaseEventFields } from "@copilotkit/vue/v2";
   * const v2BaseEventFields = BaseEventFields;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type BaseEventFields,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `BaseEventProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { BaseEventProps } from "@copilotkit/vue/v2";
   * const v2BaseEventProps = BaseEventProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type BaseEventProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `BaseEventSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { BaseEventSchema } from "@copilotkit/vue/v2";
   * const v2BaseEventSchema = BaseEventSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  BaseEventSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `BaseMessageSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { BaseMessageSchema } from "@copilotkit/vue/v2";
   * const v2BaseMessageSchema = BaseMessageSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  BaseMessageSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `BinaryInputContent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { BinaryInputContent } from "@copilotkit/vue/v2";
   * const v2BinaryInputContent = BinaryInputContent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type BinaryInputContent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `BinaryInputContentSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { BinaryInputContentSchema } from "@copilotkit/vue/v2";
   * const v2BinaryInputContentSchema = BinaryInputContentSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  BinaryInputContentSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `buildResumeArray` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { buildResumeArray } from "@copilotkit/vue/v2";
   * const v2BuildResumeArray = buildResumeArray;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  buildResumeArray,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `compactEvents` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { compactEvents } from "@copilotkit/vue/v2";
   * const v2CompactEvents = compactEvents;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  compactEvents,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `completePartialMarkdown` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { completePartialMarkdown } from "@copilotkit/vue/v2";
   * const v2CompletePartialMarkdown = completePartialMarkdown;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  completePartialMarkdown,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `Context` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { Context } from "@copilotkit/vue/v2";
   * const v2Context = Context;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type Context,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ContextSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ContextSchema } from "@copilotkit/vue/v2";
   * const v2ContextSchema = ContextSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ContextSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ContextStore` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ContextStore } from "@copilotkit/vue/v2";
   * const v2ContextStore = new ContextStore({});
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ContextStore,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `convertToLegacyEvents` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { convertToLegacyEvents } from "@copilotkit/vue/v2";
   * const v2ConvertToLegacyEvents = convertToLegacyEvents;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  convertToLegacyEvents,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChat` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { CopilotChat } from "@copilotkit/vue/v2";
   * const v2CopilotChat = CopilotChat;
   * ```
   * See https://docs.copilotkit.ai/reference/vue/components/CopilotChat
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  CopilotChat,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatAssistantMessage` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { CopilotChatAssistantMessage } from "@copilotkit/vue/v2";
   * const v2CopilotChatAssistantMessage = CopilotChatAssistantMessage;
   * ```
   * See https://docs.copilotkit.ai/reference/vue/components/CopilotChatAssistantMessage
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  CopilotChatAssistantMessage,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatAssistantMessageCopyButtonSlotProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotChatAssistantMessageCopyButtonSlotProps } from "@copilotkit/vue/v2";
   * type V2CopilotChatAssistantMessageCopyButtonSlotProps = CopilotChatAssistantMessageCopyButtonSlotProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotChatAssistantMessageCopyButtonSlotProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatAssistantMessageLayoutSlotProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotChatAssistantMessageLayoutSlotProps } from "@copilotkit/vue/v2";
   * type V2CopilotChatAssistantMessageLayoutSlotProps = CopilotChatAssistantMessageLayoutSlotProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotChatAssistantMessageLayoutSlotProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatAssistantMessageMessageRendererSlotProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotChatAssistantMessageMessageRendererSlotProps } from "@copilotkit/vue/v2";
   * type V2CopilotChatAssistantMessageMessageRendererSlotProps = CopilotChatAssistantMessageMessageRendererSlotProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotChatAssistantMessageMessageRendererSlotProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatAssistantMessageReadAloudButtonSlotProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotChatAssistantMessageReadAloudButtonSlotProps } from "@copilotkit/vue/v2";
   * type V2CopilotChatAssistantMessageReadAloudButtonSlotProps = CopilotChatAssistantMessageReadAloudButtonSlotProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotChatAssistantMessageReadAloudButtonSlotProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatAssistantMessageRegenerateButtonSlotProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotChatAssistantMessageRegenerateButtonSlotProps } from "@copilotkit/vue/v2";
   * type V2CopilotChatAssistantMessageRegenerateButtonSlotProps = CopilotChatAssistantMessageRegenerateButtonSlotProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotChatAssistantMessageRegenerateButtonSlotProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatAssistantMessageThumbsDownButtonSlotProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotChatAssistantMessageThumbsDownButtonSlotProps } from "@copilotkit/vue/v2";
   * type V2CopilotChatAssistantMessageThumbsDownButtonSlotProps = CopilotChatAssistantMessageThumbsDownButtonSlotProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotChatAssistantMessageThumbsDownButtonSlotProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatAssistantMessageThumbsUpButtonSlotProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotChatAssistantMessageThumbsUpButtonSlotProps } from "@copilotkit/vue/v2";
   * type V2CopilotChatAssistantMessageThumbsUpButtonSlotProps = CopilotChatAssistantMessageThumbsUpButtonSlotProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotChatAssistantMessageThumbsUpButtonSlotProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatAssistantMessageToolbarSlotProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotChatAssistantMessageToolbarSlotProps } from "@copilotkit/vue/v2";
   * type V2CopilotChatAssistantMessageToolbarSlotProps = CopilotChatAssistantMessageToolbarSlotProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotChatAssistantMessageToolbarSlotProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatAssistantMessageToolCallsViewSlotProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotChatAssistantMessageToolCallsViewSlotProps } from "@copilotkit/vue/v2";
   * type V2CopilotChatAssistantMessageToolCallsViewSlotProps = CopilotChatAssistantMessageToolCallsViewSlotProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotChatAssistantMessageToolCallsViewSlotProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatAttachmentQueue` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { CopilotChatAttachmentQueue } from "@copilotkit/vue/v2";
   * const v2CopilotChatAttachmentQueue = CopilotChatAttachmentQueue;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  CopilotChatAttachmentQueue,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatAttachmentQueueProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotChatAttachmentQueueProps } from "@copilotkit/vue/v2";
   * type V2CopilotChatAttachmentQueueProps = CopilotChatAttachmentQueueProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotChatAttachmentQueueProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatAttachmentRenderer` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { CopilotChatAttachmentRenderer } from "@copilotkit/vue/v2";
   * const v2CopilotChatAttachmentRenderer = CopilotChatAttachmentRenderer;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  CopilotChatAttachmentRenderer,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatAttachmentRendererProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotChatAttachmentRendererProps } from "@copilotkit/vue/v2";
   * type V2CopilotChatAttachmentRendererProps = CopilotChatAttachmentRendererProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotChatAttachmentRendererProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatAudioRecorder` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { CopilotChatAudioRecorder } from "@copilotkit/vue/v2";
   * const v2CopilotChatAudioRecorder = CopilotChatAudioRecorder;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  CopilotChatAudioRecorder,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatConfigurationProvider` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { CopilotChatConfigurationProvider } from "@copilotkit/vue/v2";
   * const v2CopilotChatConfigurationProvider = CopilotChatConfigurationProvider;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  CopilotChatConfigurationProvider,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatConfigurationProviderProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotChatConfigurationProviderProps } from "@copilotkit/vue/v2";
   * type V2CopilotChatConfigurationProviderProps = CopilotChatConfigurationProviderProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotChatConfigurationProviderProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatConfigurationValue` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotChatConfigurationValue } from "@copilotkit/vue/v2";
   * type V2CopilotChatConfigurationValue = CopilotChatConfigurationValue;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotChatConfigurationValue,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatDefaultLabels` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { CopilotChatDefaultLabels } from "@copilotkit/vue/v2";
   * const v2CopilotChatDefaultLabels = CopilotChatDefaultLabels;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  CopilotChatDefaultLabels,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatFeatherSlotProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotChatFeatherSlotProps } from "@copilotkit/vue/v2";
   * type V2CopilotChatFeatherSlotProps = CopilotChatFeatherSlotProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotChatFeatherSlotProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatInput` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { CopilotChatInput } from "@copilotkit/vue/v2";
   * const v2CopilotChatInput = CopilotChatInput;
   * ```
   * See https://docs.copilotkit.ai/reference/vue/components/CopilotChatInput
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  CopilotChatInput,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatInputMode` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotChatInputMode } from "@copilotkit/vue/v2";
   * type V2CopilotChatInputMode = CopilotChatInputMode;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotChatInputMode,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatInputSlotProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotChatInputSlotProps } from "@copilotkit/vue/v2";
   * type V2CopilotChatInputSlotProps = CopilotChatInputSlotProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotChatInputSlotProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatInterruptSlotProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotChatInterruptSlotProps } from "@copilotkit/vue/v2";
   * type V2CopilotChatInterruptSlotProps = CopilotChatInterruptSlotProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotChatInterruptSlotProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatLabels` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotChatLabels } from "@copilotkit/vue/v2";
   * type V2CopilotChatLabels = CopilotChatLabels;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotChatLabels,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatMessageView` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { CopilotChatMessageView } from "@copilotkit/vue/v2";
   * const v2CopilotChatMessageView = CopilotChatMessageView;
   * ```
   * See https://docs.copilotkit.ai/reference/vue/components/CopilotChatMessageView
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  CopilotChatMessageView,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatMessageViewSlotProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotChatMessageViewSlotProps } from "@copilotkit/vue/v2";
   * type V2CopilotChatMessageViewSlotProps = CopilotChatMessageViewSlotProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotChatMessageViewSlotProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotChatProps } from "@copilotkit/vue/v2";
   * type V2CopilotChatProps = CopilotChatProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotChatProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatReasoningMessage` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { CopilotChatReasoningMessage } from "@copilotkit/vue/v2";
   * const v2CopilotChatReasoningMessage = CopilotChatReasoningMessage;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  CopilotChatReasoningMessage,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatReasoningMessageContentViewSlotProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotChatReasoningMessageContentViewSlotProps } from "@copilotkit/vue/v2";
   * type V2CopilotChatReasoningMessageContentViewSlotProps = CopilotChatReasoningMessageContentViewSlotProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotChatReasoningMessageContentViewSlotProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatReasoningMessageHeaderSlotProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotChatReasoningMessageHeaderSlotProps } from "@copilotkit/vue/v2";
   * type V2CopilotChatReasoningMessageHeaderSlotProps = CopilotChatReasoningMessageHeaderSlotProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotChatReasoningMessageHeaderSlotProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatReasoningMessageLayoutSlotProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotChatReasoningMessageLayoutSlotProps } from "@copilotkit/vue/v2";
   * type V2CopilotChatReasoningMessageLayoutSlotProps = CopilotChatReasoningMessageLayoutSlotProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotChatReasoningMessageLayoutSlotProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatReasoningMessageToggleSlotProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotChatReasoningMessageToggleSlotProps } from "@copilotkit/vue/v2";
   * type V2CopilotChatReasoningMessageToggleSlotProps = CopilotChatReasoningMessageToggleSlotProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotChatReasoningMessageToggleSlotProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatScrollToBottomButtonSlotProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotChatScrollToBottomButtonSlotProps } from "@copilotkit/vue/v2";
   * type V2CopilotChatScrollToBottomButtonSlotProps = CopilotChatScrollToBottomButtonSlotProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotChatScrollToBottomButtonSlotProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatScrollViewSlotProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotChatScrollViewSlotProps } from "@copilotkit/vue/v2";
   * type V2CopilotChatScrollViewSlotProps = CopilotChatScrollViewSlotProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotChatScrollViewSlotProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatSuggestionPill` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { CopilotChatSuggestionPill } from "@copilotkit/vue/v2";
   * const v2CopilotChatSuggestionPill = CopilotChatSuggestionPill;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  CopilotChatSuggestionPill,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatSuggestionView` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { CopilotChatSuggestionView } from "@copilotkit/vue/v2";
   * const v2CopilotChatSuggestionView = CopilotChatSuggestionView;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  CopilotChatSuggestionView,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatSuggestionViewContainerSlotProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotChatSuggestionViewContainerSlotProps } from "@copilotkit/vue/v2";
   * type V2CopilotChatSuggestionViewContainerSlotProps = CopilotChatSuggestionViewContainerSlotProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotChatSuggestionViewContainerSlotProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatSuggestionViewLayoutSlotProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotChatSuggestionViewLayoutSlotProps } from "@copilotkit/vue/v2";
   * type V2CopilotChatSuggestionViewLayoutSlotProps = CopilotChatSuggestionViewLayoutSlotProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotChatSuggestionViewLayoutSlotProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatSuggestionViewSlotProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotChatSuggestionViewSlotProps } from "@copilotkit/vue/v2";
   * type V2CopilotChatSuggestionViewSlotProps = CopilotChatSuggestionViewSlotProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotChatSuggestionViewSlotProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatSuggestionViewSuggestionSlotProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotChatSuggestionViewSuggestionSlotProps } from "@copilotkit/vue/v2";
   * type V2CopilotChatSuggestionViewSuggestionSlotProps = CopilotChatSuggestionViewSuggestionSlotProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotChatSuggestionViewSuggestionSlotProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatToggleButton` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { CopilotChatToggleButton } from "@copilotkit/vue/v2";
   * const v2CopilotChatToggleButton = CopilotChatToggleButton;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  CopilotChatToggleButton,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatToggleButtonCloseIcon` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { CopilotChatToggleButtonCloseIcon } from "@copilotkit/vue/v2";
   * const v2CopilotChatToggleButtonCloseIcon = CopilotChatToggleButtonCloseIcon;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  CopilotChatToggleButtonCloseIcon,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatToggleButtonIconSlotProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotChatToggleButtonIconSlotProps } from "@copilotkit/vue/v2";
   * type V2CopilotChatToggleButtonIconSlotProps = CopilotChatToggleButtonIconSlotProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotChatToggleButtonIconSlotProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatToggleButtonOpenIcon` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { CopilotChatToggleButtonOpenIcon } from "@copilotkit/vue/v2";
   * const v2CopilotChatToggleButtonOpenIcon = CopilotChatToggleButtonOpenIcon;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  CopilotChatToggleButtonOpenIcon,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatToggleButtonProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotChatToggleButtonProps } from "@copilotkit/vue/v2";
   * type V2CopilotChatToggleButtonProps = CopilotChatToggleButtonProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotChatToggleButtonProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatToolCallRenderSlotProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotChatToolCallRenderSlotProps } from "@copilotkit/vue/v2";
   * type V2CopilotChatToolCallRenderSlotProps = CopilotChatToolCallRenderSlotProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotChatToolCallRenderSlotProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatToolCallsView` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { CopilotChatToolCallsView } from "@copilotkit/vue/v2";
   * const v2CopilotChatToolCallsView = CopilotChatToolCallsView;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  CopilotChatToolCallsView,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatUserMessage` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { CopilotChatUserMessage } from "@copilotkit/vue/v2";
   * const v2CopilotChatUserMessage = CopilotChatUserMessage;
   * ```
   * See https://docs.copilotkit.ai/reference/vue/components/CopilotChatUserMessage
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  CopilotChatUserMessage,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatUserMessageBranchNavigationSlotProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotChatUserMessageBranchNavigationSlotProps } from "@copilotkit/vue/v2";
   * type V2CopilotChatUserMessageBranchNavigationSlotProps = CopilotChatUserMessageBranchNavigationSlotProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotChatUserMessageBranchNavigationSlotProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatUserMessageCopyButtonSlotProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotChatUserMessageCopyButtonSlotProps } from "@copilotkit/vue/v2";
   * type V2CopilotChatUserMessageCopyButtonSlotProps = CopilotChatUserMessageCopyButtonSlotProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotChatUserMessageCopyButtonSlotProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatUserMessageEditButtonSlotProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotChatUserMessageEditButtonSlotProps } from "@copilotkit/vue/v2";
   * type V2CopilotChatUserMessageEditButtonSlotProps = CopilotChatUserMessageEditButtonSlotProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotChatUserMessageEditButtonSlotProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatUserMessageLayoutSlotProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotChatUserMessageLayoutSlotProps } from "@copilotkit/vue/v2";
   * type V2CopilotChatUserMessageLayoutSlotProps = CopilotChatUserMessageLayoutSlotProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotChatUserMessageLayoutSlotProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatUserMessageMessageRendererSlotProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotChatUserMessageMessageRendererSlotProps } from "@copilotkit/vue/v2";
   * type V2CopilotChatUserMessageMessageRendererSlotProps = CopilotChatUserMessageMessageRendererSlotProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotChatUserMessageMessageRendererSlotProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatUserMessageOnEditMessageProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotChatUserMessageOnEditMessageProps } from "@copilotkit/vue/v2";
   * type V2CopilotChatUserMessageOnEditMessageProps = CopilotChatUserMessageOnEditMessageProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotChatUserMessageOnEditMessageProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatUserMessageOnSwitchToBranchProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotChatUserMessageOnSwitchToBranchProps } from "@copilotkit/vue/v2";
   * type V2CopilotChatUserMessageOnSwitchToBranchProps = CopilotChatUserMessageOnSwitchToBranchProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotChatUserMessageOnSwitchToBranchProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatUserMessageToolbarSlotProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotChatUserMessageToolbarSlotProps } from "@copilotkit/vue/v2";
   * type V2CopilotChatUserMessageToolbarSlotProps = CopilotChatUserMessageToolbarSlotProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotChatUserMessageToolbarSlotProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatView` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { CopilotChatView } from "@copilotkit/vue/v2";
   * const v2CopilotChatView = CopilotChatView;
   * ```
   * See https://docs.copilotkit.ai/reference/vue/components/CopilotChatView
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  CopilotChatView,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatViewOverrideSlotProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotChatViewOverrideSlotProps } from "@copilotkit/vue/v2";
   * type V2CopilotChatViewOverrideSlotProps = CopilotChatViewOverrideSlotProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotChatViewOverrideSlotProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatViewProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotChatViewProps } from "@copilotkit/vue/v2";
   * type V2CopilotChatViewProps = CopilotChatViewProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotChatViewProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotChatWelcomeScreenSlotProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotChatWelcomeScreenSlotProps } from "@copilotkit/vue/v2";
   * type V2CopilotChatWelcomeScreenSlotProps = CopilotChatWelcomeScreenSlotProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotChatWelcomeScreenSlotProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotKitContextValue` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotKitContextValue } from "@copilotkit/vue/v2";
   * type V2CopilotKitContextValue = CopilotKitContextValue;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotKitContextValue,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotKitCore` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { CopilotKitCore } from "@copilotkit/vue/v2";
   * const v2CopilotKitCore = new CopilotKitCore({});
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  CopilotKitCore,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotKitCoreAddAgentParams` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotKitCoreAddAgentParams } from "@copilotkit/vue/v2";
   * type V2CopilotKitCoreAddAgentParams = CopilotKitCoreAddAgentParams;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotKitCoreAddAgentParams,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotKitCoreCatalogComponent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotKitCoreCatalogComponent } from "@copilotkit/vue/v2";
   * type V2CopilotKitCoreCatalogComponent = CopilotKitCoreCatalogComponent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotKitCoreCatalogComponent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotKitCoreConfig` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { CopilotKitCoreConfig } from "@copilotkit/vue/v2";
   * const v2CopilotKitCoreConfig = CopilotKitCoreConfig;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotKitCoreConfig,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotKitCoreConnectAgentParams` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotKitCoreConnectAgentParams } from "@copilotkit/vue/v2";
   * type V2CopilotKitCoreConnectAgentParams = CopilotKitCoreConnectAgentParams;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotKitCoreConnectAgentParams,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotKitCoreContinuationHandoff` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { CopilotKitCoreContinuationHandoff } from "@copilotkit/vue/v2";
   * const v2CopilotKitCoreContinuationHandoff = CopilotKitCoreContinuationHandoff;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotKitCoreContinuationHandoff,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotKitCoreErrorCode` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { CopilotKitCoreErrorCode } from "@copilotkit/vue/v2";
   * const v2CopilotKitCoreErrorCode = CopilotKitCoreErrorCode;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  CopilotKitCoreErrorCode,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotKitCoreFriendsAccess` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { CopilotKitCoreFriendsAccess } from "@copilotkit/vue/v2";
   * const v2CopilotKitCoreFriendsAccess = CopilotKitCoreFriendsAccess;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotKitCoreFriendsAccess,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotKitCoreGetSuggestionsResult` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { CopilotKitCoreGetSuggestionsResult } from "@copilotkit/vue/v2";
   * const v2CopilotKitCoreGetSuggestionsResult = CopilotKitCoreGetSuggestionsResult;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotKitCoreGetSuggestionsResult,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotKitCoreGetToolParams` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotKitCoreGetToolParams } from "@copilotkit/vue/v2";
   * type V2CopilotKitCoreGetToolParams = CopilotKitCoreGetToolParams;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotKitCoreGetToolParams,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotKitCoreRegisterProxiedAgentParams` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotKitCoreRegisterProxiedAgentParams } from "@copilotkit/vue/v2";
   * type V2CopilotKitCoreRegisterProxiedAgentParams = CopilotKitCoreRegisterProxiedAgentParams;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotKitCoreRegisterProxiedAgentParams,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotKitCoreRegisterProxiedAgentResult` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotKitCoreRegisterProxiedAgentResult } from "@copilotkit/vue/v2";
   * type V2CopilotKitCoreRegisterProxiedAgentResult = CopilotKitCoreRegisterProxiedAgentResult;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotKitCoreRegisterProxiedAgentResult,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotKitCoreRunAgentParams` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotKitCoreRunAgentParams } from "@copilotkit/vue/v2";
   * type V2CopilotKitCoreRunAgentParams = CopilotKitCoreRunAgentParams;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotKitCoreRunAgentParams,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotKitCoreRuntimeConnectionStatus` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/vue/v2";
   * const v2CopilotKitCoreRuntimeConnectionStatus = CopilotKitCoreRuntimeConnectionStatus;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  CopilotKitCoreRuntimeConnectionStatus,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotKitCoreRunToolParams` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotKitCoreRunToolParams } from "@copilotkit/vue/v2";
   * type V2CopilotKitCoreRunToolParams = CopilotKitCoreRunToolParams;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotKitCoreRunToolParams,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotKitCoreRunToolResult` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotKitCoreRunToolResult } from "@copilotkit/vue/v2";
   * type V2CopilotKitCoreRunToolResult = CopilotKitCoreRunToolResult;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotKitCoreRunToolResult,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotKitCoreStopAgentParams` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { CopilotKitCoreStopAgentParams } from "@copilotkit/vue/v2";
   * const v2CopilotKitCoreStopAgentParams = CopilotKitCoreStopAgentParams;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotKitCoreStopAgentParams,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotKitCoreSubscriber` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { CopilotKitCoreSubscriber } from "@copilotkit/vue/v2";
   * const v2CopilotKitCoreSubscriber = CopilotKitCoreSubscriber;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotKitCoreSubscriber,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotKitCoreSubscription` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { CopilotKitCoreSubscription } from "@copilotkit/vue/v2";
   * const v2CopilotKitCoreSubscription = CopilotKitCoreSubscription;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotKitCoreSubscription,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotKitCoreVue` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { CopilotKitCoreVue } from "@copilotkit/vue/v2";
   * const v2CopilotKitCoreVue = new CopilotKitCoreVue({});
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  CopilotKitCoreVue,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotKitCoreVueConfig` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotKitCoreVueConfig } from "@copilotkit/vue/v2";
   * type V2CopilotKitCoreVueConfig = CopilotKitCoreVueConfig;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotKitCoreVueConfig,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotKitCoreVueSubscriber` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotKitCoreVueSubscriber } from "@copilotkit/vue/v2";
   * type V2CopilotKitCoreVueSubscriber = CopilotKitCoreVueSubscriber;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotKitCoreVueSubscriber,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotKitInspector` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { CopilotKitInspector } from "@copilotkit/vue/v2";
   * const v2CopilotKitInspector = CopilotKitInspector;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  CopilotKitInspector,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotKitProvider` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { CopilotKitProvider } from "@copilotkit/vue/v2";
   * const v2CopilotKitProvider = CopilotKitProvider;
   * ```
   * See https://docs.copilotkit.ai/reference/vue/components/CopilotKitProvider
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  CopilotKitProvider,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotKitProviderProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotKitProviderProps } from "@copilotkit/vue/v2";
   * type V2CopilotKitProviderProps = CopilotKitProviderProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotKitProviderProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotModalHeader` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { CopilotModalHeader } from "@copilotkit/vue/v2";
   * const v2CopilotModalHeader = CopilotModalHeader;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  CopilotModalHeader,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotModalHeaderCloseButtonSlotProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotModalHeaderCloseButtonSlotProps } from "@copilotkit/vue/v2";
   * type V2CopilotModalHeaderCloseButtonSlotProps = CopilotModalHeaderCloseButtonSlotProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotModalHeaderCloseButtonSlotProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotModalHeaderLayoutSlotProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotModalHeaderLayoutSlotProps } from "@copilotkit/vue/v2";
   * type V2CopilotModalHeaderLayoutSlotProps = CopilotModalHeaderLayoutSlotProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotModalHeaderLayoutSlotProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotModalHeaderProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotModalHeaderProps } from "@copilotkit/vue/v2";
   * type V2CopilotModalHeaderProps = CopilotModalHeaderProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotModalHeaderProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotModalHeaderTitleContentSlotProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotModalHeaderTitleContentSlotProps } from "@copilotkit/vue/v2";
   * type V2CopilotModalHeaderTitleContentSlotProps = CopilotModalHeaderTitleContentSlotProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotModalHeaderTitleContentSlotProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotPopup` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { CopilotPopup } from "@copilotkit/vue/v2";
   * const v2CopilotPopup = CopilotPopup;
   * ```
   * See https://docs.copilotkit.ai/reference/vue/components/CopilotPopup
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  CopilotPopup,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotPopupProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotPopupProps } from "@copilotkit/vue/v2";
   * type V2CopilotPopupProps = CopilotPopupProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotPopupProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotPopupView` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { CopilotPopupView } from "@copilotkit/vue/v2";
   * const v2CopilotPopupView = CopilotPopupView;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  CopilotPopupView,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotPopupViewHeaderSlotProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotPopupViewHeaderSlotProps } from "@copilotkit/vue/v2";
   * type V2CopilotPopupViewHeaderSlotProps = CopilotPopupViewHeaderSlotProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotPopupViewHeaderSlotProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotPopupViewProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotPopupViewProps } from "@copilotkit/vue/v2";
   * type V2CopilotPopupViewProps = CopilotPopupViewProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotPopupViewProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotPopupViewToggleButtonSlotProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotPopupViewToggleButtonSlotProps } from "@copilotkit/vue/v2";
   * type V2CopilotPopupViewToggleButtonSlotProps = CopilotPopupViewToggleButtonSlotProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotPopupViewToggleButtonSlotProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotPopupWelcomeScreenInputSlotProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotPopupWelcomeScreenInputSlotProps } from "@copilotkit/vue/v2";
   * type V2CopilotPopupWelcomeScreenInputSlotProps = CopilotPopupWelcomeScreenInputSlotProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotPopupWelcomeScreenInputSlotProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotPopupWelcomeScreenLayoutSlotProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotPopupWelcomeScreenLayoutSlotProps } from "@copilotkit/vue/v2";
   * type V2CopilotPopupWelcomeScreenLayoutSlotProps = CopilotPopupWelcomeScreenLayoutSlotProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotPopupWelcomeScreenLayoutSlotProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotPopupWelcomeScreenProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotPopupWelcomeScreenProps } from "@copilotkit/vue/v2";
   * type V2CopilotPopupWelcomeScreenProps = CopilotPopupWelcomeScreenProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotPopupWelcomeScreenProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotPopupWelcomeScreenSuggestionViewSlotProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotPopupWelcomeScreenSuggestionViewSlotProps } from "@copilotkit/vue/v2";
   * type V2CopilotPopupWelcomeScreenSuggestionViewSlotProps = CopilotPopupWelcomeScreenSuggestionViewSlotProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotPopupWelcomeScreenSuggestionViewSlotProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotRuntimeTransport` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { CopilotRuntimeTransport } from "@copilotkit/vue/v2";
   * const v2CopilotRuntimeTransport = CopilotRuntimeTransport;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotRuntimeTransport,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotSidebar` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { CopilotSidebar } from "@copilotkit/vue/v2";
   * const v2CopilotSidebar = CopilotSidebar;
   * ```
   * See https://docs.copilotkit.ai/reference/vue/components/CopilotSidebar
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  CopilotSidebar,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotSidebarProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotSidebarProps } from "@copilotkit/vue/v2";
   * type V2CopilotSidebarProps = CopilotSidebarProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotSidebarProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotSidebarView` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { CopilotSidebarView } from "@copilotkit/vue/v2";
   * const v2CopilotSidebarView = CopilotSidebarView;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  CopilotSidebarView,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotSidebarViewHeaderSlotProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotSidebarViewHeaderSlotProps } from "@copilotkit/vue/v2";
   * type V2CopilotSidebarViewHeaderSlotProps = CopilotSidebarViewHeaderSlotProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotSidebarViewHeaderSlotProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotSidebarViewProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotSidebarViewProps } from "@copilotkit/vue/v2";
   * type V2CopilotSidebarViewProps = CopilotSidebarViewProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotSidebarViewProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotSidebarViewToggleButtonSlotProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotSidebarViewToggleButtonSlotProps } from "@copilotkit/vue/v2";
   * type V2CopilotSidebarViewToggleButtonSlotProps = CopilotSidebarViewToggleButtonSlotProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotSidebarViewToggleButtonSlotProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotSidebarWelcomeScreenInputSlotProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotSidebarWelcomeScreenInputSlotProps } from "@copilotkit/vue/v2";
   * type V2CopilotSidebarWelcomeScreenInputSlotProps = CopilotSidebarWelcomeScreenInputSlotProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotSidebarWelcomeScreenInputSlotProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotSidebarWelcomeScreenLayoutSlotProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotSidebarWelcomeScreenLayoutSlotProps } from "@copilotkit/vue/v2";
   * type V2CopilotSidebarWelcomeScreenLayoutSlotProps = CopilotSidebarWelcomeScreenLayoutSlotProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotSidebarWelcomeScreenLayoutSlotProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotSidebarWelcomeScreenProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotSidebarWelcomeScreenProps } from "@copilotkit/vue/v2";
   * type V2CopilotSidebarWelcomeScreenProps = CopilotSidebarWelcomeScreenProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotSidebarWelcomeScreenProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotSidebarWelcomeScreenSuggestionViewSlotProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotSidebarWelcomeScreenSuggestionViewSlotProps } from "@copilotkit/vue/v2";
   * type V2CopilotSidebarWelcomeScreenSuggestionViewSlotProps = CopilotSidebarWelcomeScreenSuggestionViewSlotProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotSidebarWelcomeScreenSuggestionViewSlotProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotThreadsDrawer` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { CopilotThreadsDrawer } from "@copilotkit/vue/v2";
   * const v2CopilotThreadsDrawer = CopilotThreadsDrawer;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  CopilotThreadsDrawer,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `createA2UIMessageRenderer` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { createA2UIMessageRenderer } from "@copilotkit/vue/v2";
   * const v2CreateA2UIMessageRenderer = createA2UIMessageRenderer;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  createA2UIMessageRenderer,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `createActionGroup` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { createActionGroup } from "@copilotkit/vue/v2";
   * const v2CreateActionGroup = createActionGroup;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  createActionGroup,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `createDebugLogger` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { createDebugLogger } from "@copilotkit/vue/v2";
   * const v2CreateDebugLogger = createDebugLogger;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  createDebugLogger,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `createDefaultLicenseRef` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { createDefaultLicenseRef } from "@copilotkit/vue/v2";
   * const v2CreateDefaultLicenseRef = createDefaultLicenseRef;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  createDefaultLicenseRef,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `createEffect` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { createEffect } from "@copilotkit/vue/v2";
   * const v2CreateEffect = createEffect;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  createEffect,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `createLicenseContextValue` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { createLicenseContextValue } from "@copilotkit/vue/v2";
   * const v2CreateLicenseContextValue = createLicenseContextValue;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  createLicenseContextValue,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `createReducer` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { createReducer } from "@copilotkit/vue/v2";
   * const v2CreateReducer = createReducer;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  createReducer,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `createSelector` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { createSelector } from "@copilotkit/vue/v2";
   * const v2CreateSelector = createSelector;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  createSelector,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `createStore` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { createStore } from "@copilotkit/vue/v2";
   * const v2CreateStore = createStore;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  createStore,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CustomEvent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { CustomEvent } from "@copilotkit/vue/v2";
   * const v2CustomEvent = CustomEvent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CustomEvent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CustomEventProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { CustomEventProps } from "@copilotkit/vue/v2";
   * const v2CustomEventProps = CustomEventProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CustomEventProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CustomEventSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { CustomEventSchema } from "@copilotkit/vue/v2";
   * const v2CustomEventSchema = CustomEventSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  CustomEventSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `DebugConfig` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { DebugConfig } from "@copilotkit/vue/v2";
   * type V2DebugConfig = DebugConfig;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type DebugConfig,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `DebugLogger` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { DebugLogger } from "@copilotkit/vue/v2";
   * const v2DebugLogger = new DebugLogger({});
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  DebugLogger,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `DebugLoggerInput` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { DebugLoggerInput } from "@copilotkit/vue/v2";
   * type V2DebugLoggerInput = DebugLoggerInput;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type DebugLoggerInput,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `defaultApplyEvents` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { defaultApplyEvents } from "@copilotkit/vue/v2";
   * const v2DefaultApplyEvents = defaultApplyEvents;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  defaultApplyEvents,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `defineToolCallRenderer` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { defineToolCallRenderer } from "@copilotkit/vue/v2";
   * const v2DefineToolCallRenderer = defineToolCallRenderer;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  defineToolCallRenderer,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `DeveloperMessage` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { DeveloperMessage } from "@copilotkit/vue/v2";
   * const v2DeveloperMessage = DeveloperMessage;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type DeveloperMessage,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `DeveloperMessageSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { DeveloperMessageSchema } from "@copilotkit/vue/v2";
   * const v2DeveloperMessageSchema = DeveloperMessageSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  DeveloperMessageSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `DispatchingEffect` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { DispatchingEffect } from "@copilotkit/vue/v2";
   * const v2DispatchingEffect = DispatchingEffect;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type DispatchingEffect,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `DispatchingEffectOptions` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { DispatchingEffectOptions } from "@copilotkit/vue/v2";
   * const v2DispatchingEffectOptions = DispatchingEffectOptions;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type DispatchingEffectOptions,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `DocumentInputContent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { DocumentInputContent } from "@copilotkit/vue/v2";
   * const v2DocumentInputContent = DocumentInputContent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type DocumentInputContent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `DocumentInputContentSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { DocumentInputContentSchema } from "@copilotkit/vue/v2";
   * const v2DocumentInputContentSchema = DocumentInputContentSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  DocumentInputContentSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `DocumentInputPart` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { DocumentInputPart } from "@copilotkit/vue/v2";
   * const v2DocumentInputPart = DocumentInputPart;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type DocumentInputPart,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `DocumentInputPartSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { DocumentInputPartSchema } from "@copilotkit/vue/v2";
   * const v2DocumentInputPartSchema = DocumentInputPartSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  DocumentInputPartSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `DynamicSuggestionsConfig` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { DynamicSuggestionsConfig } from "@copilotkit/vue/v2";
   * const v2DynamicSuggestionsConfig = DynamicSuggestionsConfig;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type DynamicSuggestionsConfig,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `Effect` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { Effect } from "@copilotkit/vue/v2";
   * const v2Effect = Effect;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type Effect,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `empty` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { empty } from "@copilotkit/vue/v2";
   * const v2Empty = empty;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  empty,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `EmptyActionConfig` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { EmptyActionConfig } from "@copilotkit/vue/v2";
   * const v2EmptyActionConfig = EmptyActionConfig;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type EmptyActionConfig,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ensureObjectArgs` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ensureObjectArgs } from "@copilotkit/vue/v2";
   * const v2EnsureObjectArgs = ensureObjectArgs;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ensureObjectArgs,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `EventPayloadOf` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { EventPayloadOf } from "@copilotkit/vue/v2";
   * const v2EventPayloadOf = EventPayloadOf;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type EventPayloadOf,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `EventSchemas` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { EventSchemas } from "@copilotkit/vue/v2";
   * const v2EventSchemas = EventSchemas;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  EventSchemas,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `EventType` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { EventType } from "@copilotkit/vue/v2";
   * const v2EventType = EventType;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  EventType,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ExecutionCapabilities` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { ExecutionCapabilities } from "@copilotkit/vue/v2";
   * type V2ExecutionCapabilities = ExecutionCapabilities;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ExecutionCapabilities,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ExecutionCapabilitiesSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ExecutionCapabilitiesSchema } from "@copilotkit/vue/v2";
   * const v2ExecutionCapabilitiesSchema = ExecutionCapabilitiesSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ExecutionCapabilitiesSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `extractCompleteStyles` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { extractCompleteStyles } from "@copilotkit/vue/v2";
   * const v2ExtractCompleteStyles = extractCompleteStyles;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  extractCompleteStyles,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `FilterToolCallsMiddleware` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { FilterToolCallsMiddleware } from "@copilotkit/vue/v2";
   * const v2FilterToolCallsMiddleware = new FilterToolCallsMiddleware({});
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  FilterToolCallsMiddleware,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `FrontendTool` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { FrontendTool } from "@copilotkit/vue/v2";
   * const v2FrontendTool = FrontendTool;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type FrontendTool,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `FrontendToolHandlerContext` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { FrontendToolHandlerContext } from "@copilotkit/vue/v2";
   * const v2FrontendToolHandlerContext = FrontendToolHandlerContext;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type FrontendToolHandlerContext,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `FunctionCall` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { FunctionCall } from "@copilotkit/vue/v2";
   * const v2FunctionCall = FunctionCall;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type FunctionCall,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `FunctionCallSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { FunctionCallSchema } from "@copilotkit/vue/v2";
   * const v2FunctionCallSchema = FunctionCallSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  FunctionCallSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `FunctionMiddleware` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { FunctionMiddleware } from "@copilotkit/vue/v2";
   * const v2FunctionMiddleware = new FunctionMiddleware({});
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  FunctionMiddleware,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `GenerateSandboxedUiArgs` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { GenerateSandboxedUiArgs } from "@copilotkit/vue/v2";
   * type V2GenerateSandboxedUiArgs = GenerateSandboxedUiArgs;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type GenerateSandboxedUiArgs,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `GenerateSandboxedUiArgsSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { GenerateSandboxedUiArgsSchema } from "@copilotkit/vue/v2";
   * const v2GenerateSandboxedUiArgsSchema = GenerateSandboxedUiArgsSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  GenerateSandboxedUiArgsSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `getOperationSurfaceId` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { getOperationSurfaceId } from "@copilotkit/vue/v2";
   * const v2GetOperationSurfaceId = getOperationSurfaceId;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  getOperationSurfaceId,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `getRunOutcome` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { getRunOutcome } from "@copilotkit/vue/v2";
   * const v2GetRunOutcome = getRunOutcome;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  getRunOutcome,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `HttpAgent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { HttpAgent } from "@copilotkit/vue/v2";
   * const v2HttpAgent = new HttpAgent({});
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  HttpAgent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `HttpAgentConfig` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { HttpAgentConfig } from "@copilotkit/vue/v2";
   * type V2HttpAgentConfig = HttpAgentConfig;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type HttpAgentConfig,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `HttpAgentFetchFn` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { HttpAgentFetchFn } from "@copilotkit/vue/v2";
   * type V2HttpAgentFetchFn = HttpAgentFetchFn;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type HttpAgentFetchFn,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `HumanInTheLoopCapabilities` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { HumanInTheLoopCapabilities } from "@copilotkit/vue/v2";
   * type V2HumanInTheLoopCapabilities = HumanInTheLoopCapabilities;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type HumanInTheLoopCapabilities,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `HumanInTheLoopCapabilitiesSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { HumanInTheLoopCapabilitiesSchema } from "@copilotkit/vue/v2";
   * const v2HumanInTheLoopCapabilitiesSchema = HumanInTheLoopCapabilitiesSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  HumanInTheLoopCapabilitiesSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `IdentityCapabilities` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { IdentityCapabilities } from "@copilotkit/vue/v2";
   * type V2IdentityCapabilities = IdentityCapabilities;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type IdentityCapabilities,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `IdentityCapabilitiesSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { IdentityCapabilitiesSchema } from "@copilotkit/vue/v2";
   * const v2IdentityCapabilitiesSchema = IdentityCapabilitiesSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  IdentityCapabilitiesSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ImageInputContent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ImageInputContent } from "@copilotkit/vue/v2";
   * const v2ImageInputContent = ImageInputContent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ImageInputContent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ImageInputContentSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ImageInputContentSchema } from "@copilotkit/vue/v2";
   * const v2ImageInputContentSchema = ImageInputContentSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ImageInputContentSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ImageInputPart` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ImageInputPart } from "@copilotkit/vue/v2";
   * const v2ImageInputPart = ImageInputPart;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ImageInputPart,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ImageInputPartSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ImageInputPartSchema } from "@copilotkit/vue/v2";
   * const v2ImageInputPartSchema = ImageInputPartSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ImageInputPartSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `InputContent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { InputContent } from "@copilotkit/vue/v2";
   * const v2InputContent = InputContent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type InputContent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `InputContentDataSource` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { InputContentDataSource } from "@copilotkit/vue/v2";
   * const v2InputContentDataSource = InputContentDataSource;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type InputContentDataSource,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `InputContentDataSourceSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { InputContentDataSourceSchema } from "@copilotkit/vue/v2";
   * const v2InputContentDataSourceSchema = InputContentDataSourceSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  InputContentDataSourceSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `InputContentPart` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { InputContentPart } from "@copilotkit/vue/v2";
   * const v2InputContentPart = InputContentPart;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type InputContentPart,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `InputContentSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { InputContentSchema } from "@copilotkit/vue/v2";
   * const v2InputContentSchema = InputContentSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  InputContentSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `InputContentSource` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { InputContentSource } from "@copilotkit/vue/v2";
   * const v2InputContentSource = InputContentSource;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type InputContentSource,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `InputContentSourceSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { InputContentSourceSchema } from "@copilotkit/vue/v2";
   * const v2InputContentSourceSchema = InputContentSourceSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  InputContentSourceSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `InputContentUrlSource` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { InputContentUrlSource } from "@copilotkit/vue/v2";
   * const v2InputContentUrlSource = InputContentUrlSource;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type InputContentUrlSource,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `InputContentUrlSourceSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { InputContentUrlSourceSchema } from "@copilotkit/vue/v2";
   * const v2InputContentUrlSourceSchema = InputContentUrlSourceSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  InputContentUrlSourceSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `InspectorMetadataV1` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { InspectorMetadataV1 } from "@copilotkit/vue/v2";
   * type V2InspectorMetadataV1 = InspectorMetadataV1;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type InspectorMetadataV1,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `IntelligenceAgent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { IntelligenceAgent } from "@copilotkit/vue/v2";
   * const v2IntelligenceAgent = new IntelligenceAgent({});
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  IntelligenceAgent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `IntelligenceAgentConfig` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { IntelligenceAgentConfig } from "@copilotkit/vue/v2";
   * const v2IntelligenceAgentConfig = IntelligenceAgentConfig;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type IntelligenceAgentConfig,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `IntelligenceRuntimeInfo` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { IntelligenceRuntimeInfo } from "@copilotkit/vue/v2";
   * type V2IntelligenceRuntimeInfo = IntelligenceRuntimeInfo;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type IntelligenceRuntimeInfo,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `Interrupt` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { Interrupt } from "@copilotkit/vue/v2";
   * const v2Interrupt = Interrupt;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type Interrupt,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `InterruptCancelFn` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { InterruptCancelFn } from "@copilotkit/vue/v2";
   * type V2InterruptCancelFn = InterruptCancelFn;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type InterruptCancelFn,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `InterruptEvent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { InterruptEvent } from "@copilotkit/vue/v2";
   * type V2InterruptEvent = InterruptEvent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type InterruptEvent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `InterruptHandlerProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { InterruptHandlerProps } from "@copilotkit/vue/v2";
   * type V2InterruptHandlerProps = InterruptHandlerProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type InterruptHandlerProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `InterruptRenderProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { InterruptRenderProps } from "@copilotkit/vue/v2";
   * type V2InterruptRenderProps = InterruptRenderProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type InterruptRenderProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `InterruptResolveFn` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { InterruptResolveFn } from "@copilotkit/vue/v2";
   * type V2InterruptResolveFn = InterruptResolveFn;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type InterruptResolveFn,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `InterruptSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { InterruptSchema } from "@copilotkit/vue/v2";
   * const v2InterruptSchema = InterruptSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  InterruptSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `isAbortError` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { isAbortError } from "@copilotkit/vue/v2";
   * const v2IsAbortError = isAbortError;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  isAbortError,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `isInterruptExpired` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { isInterruptExpired } from "@copilotkit/vue/v2";
   * const v2IsInterruptExpired = isInterruptExpired;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  isInterruptExpired,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `isRunCompletionAware` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { isRunCompletionAware } from "@copilotkit/vue/v2";
   * const v2IsRunCompletionAware = isRunCompletionAware;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  isRunCompletionAware,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `JsonSerializable` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { JsonSerializable } from "@copilotkit/vue/v2";
   * type V2JsonSerializable = JsonSerializable;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type JsonSerializable,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `KeyboardState` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { KeyboardState } from "@copilotkit/vue/v2";
   * type V2KeyboardState = KeyboardState;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type KeyboardState,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `LicenseContextKey` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { LicenseContextKey } from "@copilotkit/vue/v2";
   * const v2LicenseContextKey = LicenseContextKey;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  LicenseContextKey,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `LicenseContextValue` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { LicenseContextValue } from "@copilotkit/vue/v2";
   * type V2LicenseContextValue = LicenseContextValue;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type LicenseContextValue,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `MCPAppsActivityContent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { MCPAppsActivityContent } from "@copilotkit/vue/v2";
   * type V2MCPAppsActivityContent = MCPAppsActivityContent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type MCPAppsActivityContent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `MCPAppsActivityContentSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { MCPAppsActivityContentSchema } from "@copilotkit/vue/v2";
   * const v2MCPAppsActivityContentSchema = MCPAppsActivityContentSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  MCPAppsActivityContentSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `MCPAppsActivityRenderer` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { MCPAppsActivityRenderer } from "@copilotkit/vue/v2";
   * const v2MCPAppsActivityRenderer = MCPAppsActivityRenderer;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  MCPAppsActivityRenderer,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `MCPAppsActivityType` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { MCPAppsActivityType } from "@copilotkit/vue/v2";
   * const v2MCPAppsActivityType = MCPAppsActivityType;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  MCPAppsActivityType,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `Memory` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { Memory } from "@copilotkit/vue/v2";
   * const v2Memory = Memory;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type Memory,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `MEMORY_ERROR_REGISTRY` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { MEMORY_ERROR_REGISTRY } from "@copilotkit/vue/v2";
   * const v2MEMORY_ERROR_REGISTRY = MEMORY_ERROR_REGISTRY;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  MEMORY_ERROR_REGISTRY,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `MemoryChanges` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { MemoryChanges } from "@copilotkit/vue/v2";
   * const v2MemoryChanges = MemoryChanges;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type MemoryChanges,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `MemoryError` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { MemoryError } from "@copilotkit/vue/v2";
   * const v2MemoryError = new MemoryError({});
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  MemoryError,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `MemoryErrorCategory` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { MemoryErrorCategory } from "@copilotkit/vue/v2";
   * type V2MemoryErrorCategory = MemoryErrorCategory;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type MemoryErrorCategory,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `MemoryErrorCode` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { MemoryErrorCode } from "@copilotkit/vue/v2";
   * type V2MemoryErrorCode = MemoryErrorCode;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type MemoryErrorCode,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `MemoryErrorRegistryEntry` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { MemoryErrorRegistryEntry } from "@copilotkit/vue/v2";
   * type V2MemoryErrorRegistryEntry = MemoryErrorRegistryEntry;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type MemoryErrorRegistryEntry,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `MemoryKind` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { MemoryKind } from "@copilotkit/vue/v2";
   * const v2MemoryKind = MemoryKind;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type MemoryKind,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `MemoryRealtimeStatus` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { MemoryRealtimeStatus } from "@copilotkit/vue/v2";
   * const v2MemoryRealtimeStatus = MemoryRealtimeStatus;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type MemoryRealtimeStatus,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `MemoryScope` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { MemoryScope } from "@copilotkit/vue/v2";
   * const v2MemoryScope = MemoryScope;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type MemoryScope,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `Message` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { Message } from "@copilotkit/vue/v2";
   * const v2Message = Message;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type Message,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `MessageSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { MessageSchema } from "@copilotkit/vue/v2";
   * const v2MessageSchema = MessageSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  MessageSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `MessagesSnapshotEvent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { MessagesSnapshotEvent } from "@copilotkit/vue/v2";
   * const v2MessagesSnapshotEvent = MessagesSnapshotEvent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type MessagesSnapshotEvent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `MessagesSnapshotEventProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { MessagesSnapshotEventProps } from "@copilotkit/vue/v2";
   * const v2MessagesSnapshotEventProps = MessagesSnapshotEventProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type MessagesSnapshotEventProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `MessagesSnapshotEventSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { MessagesSnapshotEventSchema } from "@copilotkit/vue/v2";
   * const v2MessagesSnapshotEventSchema = MessagesSnapshotEventSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  MessagesSnapshotEventSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `Middleware` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { Middleware } from "@copilotkit/vue/v2";
   * const v2Middleware = new Middleware({});
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  Middleware,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `MiddlewareFunction` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { MiddlewareFunction } from "@copilotkit/vue/v2";
   * type V2MiddlewareFunction = MiddlewareFunction;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type MiddlewareFunction,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `MultiAgentCapabilities` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { MultiAgentCapabilities } from "@copilotkit/vue/v2";
   * type V2MultiAgentCapabilities = MultiAgentCapabilities;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type MultiAgentCapabilities,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `MultiAgentCapabilitiesSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { MultiAgentCapabilitiesSchema } from "@copilotkit/vue/v2";
   * const v2MultiAgentCapabilitiesSchema = MultiAgentCapabilitiesSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  MultiAgentCapabilitiesSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `MultimodalCapabilities` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { MultimodalCapabilities } from "@copilotkit/vue/v2";
   * type V2MultimodalCapabilities = MultimodalCapabilities;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type MultimodalCapabilities,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `MultimodalCapabilitiesSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { MultimodalCapabilitiesSchema } from "@copilotkit/vue/v2";
   * const v2MultimodalCapabilitiesSchema = MultimodalCapabilitiesSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  MultimodalCapabilitiesSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `MultimodalInputCapabilities` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { MultimodalInputCapabilities } from "@copilotkit/vue/v2";
   * type V2MultimodalInputCapabilities = MultimodalInputCapabilities;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type MultimodalInputCapabilities,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `MultimodalInputCapabilitiesSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { MultimodalInputCapabilitiesSchema } from "@copilotkit/vue/v2";
   * const v2MultimodalInputCapabilitiesSchema = MultimodalInputCapabilitiesSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  MultimodalInputCapabilitiesSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `MultimodalOutputCapabilities` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { MultimodalOutputCapabilities } from "@copilotkit/vue/v2";
   * type V2MultimodalOutputCapabilities = MultimodalOutputCapabilities;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type MultimodalOutputCapabilities,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `MultimodalOutputCapabilitiesSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { MultimodalOutputCapabilitiesSchema } from "@copilotkit/vue/v2";
   * const v2MultimodalOutputCapabilitiesSchema = MultimodalOutputCapabilitiesSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  MultimodalOutputCapabilitiesSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `NewMemory` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { NewMemory } from "@copilotkit/vue/v2";
   * const v2NewMemory = NewMemory;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type NewMemory,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `NonDispatchingEffect` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { NonDispatchingEffect } from "@copilotkit/vue/v2";
   * const v2NonDispatchingEffect = NonDispatchingEffect;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type NonDispatchingEffect,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `NonDispatchingEffectOptions` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { NonDispatchingEffectOptions } from "@copilotkit/vue/v2";
   * const v2NonDispatchingEffectOptions = NonDispatchingEffectOptions;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type NonDispatchingEffectOptions,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ofType` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ofType } from "@copilotkit/vue/v2";
   * const v2OfType = ofType;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ofType,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `on` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { on } from "@copilotkit/vue/v2";
   * const v2On = on;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  on,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `OpenGenerativeUIActivityRenderer` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { OpenGenerativeUIActivityRenderer } from "@copilotkit/vue/v2";
   * const v2OpenGenerativeUIActivityRenderer = OpenGenerativeUIActivityRenderer;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  OpenGenerativeUIActivityRenderer,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `OpenGenerativeUIActivityType` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { OpenGenerativeUIActivityType } from "@copilotkit/vue/v2";
   * const v2OpenGenerativeUIActivityType = OpenGenerativeUIActivityType;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  OpenGenerativeUIActivityType,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `OpenGenerativeUIContent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { OpenGenerativeUIContent } from "@copilotkit/vue/v2";
   * type V2OpenGenerativeUIContent = OpenGenerativeUIContent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type OpenGenerativeUIContent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `OpenGenerativeUIContentSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { OpenGenerativeUIContentSchema } from "@copilotkit/vue/v2";
   * const v2OpenGenerativeUIContentSchema = OpenGenerativeUIContentSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  OpenGenerativeUIContentSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `OpenGenerativeUIRenderer` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { OpenGenerativeUIRenderer } from "@copilotkit/vue/v2";
   * const v2OpenGenerativeUIRenderer = OpenGenerativeUIRenderer;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  OpenGenerativeUIRenderer,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `OpenGenerativeUIToolRenderer` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { OpenGenerativeUIToolRenderer } from "@copilotkit/vue/v2";
   * const v2OpenGenerativeUIToolRenderer = OpenGenerativeUIToolRenderer;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  OpenGenerativeUIToolRenderer,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `OutputCapabilities` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { OutputCapabilities } from "@copilotkit/vue/v2";
   * type V2OutputCapabilities = OutputCapabilities;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type OutputCapabilities,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `OutputCapabilitiesSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { OutputCapabilitiesSchema } from "@copilotkit/vue/v2";
   * const v2OutputCapabilitiesSchema = OutputCapabilitiesSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  OutputCapabilitiesSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵCOPILOTKIT_FEATURES` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵCOPILOTKIT_FEATURES } from "@copilotkit/vue/v2";
   * const v2COPILOTKIT_FEATURES = ɵCOPILOTKIT_FEATURES;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ɵCOPILOTKIT_FEATURES,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵCopilotKitFeature` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵCopilotKitFeature } from "@copilotkit/vue/v2";
   * const v2CopilotKitFeature = ɵCopilotKitFeature;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ɵCopilotKitFeature,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵcreateMemoryStore` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵcreateMemoryStore } from "@copilotkit/vue/v2";
   * const v2CreateMemoryStore = ɵcreateMemoryStore;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ɵcreateMemoryStore,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵcreateThreadSelectors` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵcreateThreadSelectors } from "@copilotkit/vue/v2";
   * const v2CreateThreadSelectors = ɵcreateThreadSelectors;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ɵcreateThreadSelectors,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵcreateThreadStore` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵcreateThreadStore } from "@copilotkit/vue/v2";
   * const v2CreateThreadStore = ɵcreateThreadStore;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ɵcreateThreadStore,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵInterruptDecision` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵInterruptDecision } from "@copilotkit/vue/v2";
   * const v2InterruptDecision = ɵInterruptDecision;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ɵInterruptDecision,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵInterruptEvent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵInterruptEvent } from "@copilotkit/vue/v2";
   * const v2InterruptEvent = ɵInterruptEvent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ɵInterruptEvent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵInterruptState` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵInterruptState } from "@copilotkit/vue/v2";
   * const v2InterruptState = new ɵInterruptState({});
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ɵInterruptState,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵInterruptToolResult` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵInterruptToolResult } from "@copilotkit/vue/v2";
   * const v2InterruptToolResult = ɵInterruptToolResult;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ɵInterruptToolResult,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵisCopilotKitFeature` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵisCopilotKitFeature } from "@copilotkit/vue/v2";
   * const v2IsCopilotKitFeature = ɵisCopilotKitFeature;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ɵisCopilotKitFeature,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵisRetryableMemoryStatus` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵisRetryableMemoryStatus } from "@copilotkit/vue/v2";
   * const v2IsRetryableMemoryStatus = ɵisRetryableMemoryStatus;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ɵisRetryableMemoryStatus,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵjoinPhoenixChannel$` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵjoinPhoenixChannel$ } from "@copilotkit/vue/v2";
   * const v2JoinPhoenixChannel$ = ɵjoinPhoenixChannel$;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ɵjoinPhoenixChannel$,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵmapMemoryMetadataEvent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵmapMemoryMetadataEvent } from "@copilotkit/vue/v2";
   * const v2MapMemoryMetadataEvent = ɵmapMemoryMetadataEvent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ɵmapMemoryMetadataEvent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵMAX_SOCKET_RETRIES` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵMAX_SOCKET_RETRIES } from "@copilotkit/vue/v2";
   * const v2MAX_SOCKET_RETRIES = ɵMAX_SOCKET_RETRIES;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ɵMAX_SOCKET_RETRIES,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵmemoryAdapterEvents` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵmemoryAdapterEvents } from "@copilotkit/vue/v2";
   * const v2MemoryAdapterEvents = ɵmemoryAdapterEvents;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ɵmemoryAdapterEvents,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵmemoryDomainEvents` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵmemoryDomainEvents } from "@copilotkit/vue/v2";
   * const v2MemoryDomainEvents = ɵmemoryDomainEvents;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ɵmemoryDomainEvents,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵMemoryEnvironment` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵMemoryEnvironment } from "@copilotkit/vue/v2";
   * const v2MemoryEnvironment = ɵMemoryEnvironment;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ɵMemoryEnvironment,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵMemoryMetadataEvent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵMemoryMetadataEvent } from "@copilotkit/vue/v2";
   * const v2MemoryMetadataEvent = ɵMemoryMetadataEvent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ɵMemoryMetadataEvent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵmemoryReducer` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵmemoryReducer } from "@copilotkit/vue/v2";
   * const v2MemoryReducer = ɵmemoryReducer;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ɵmemoryReducer,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵmemoryRestEvents` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵmemoryRestEvents } from "@copilotkit/vue/v2";
   * const v2MemoryRestEvents = ɵmemoryRestEvents;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ɵmemoryRestEvents,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵMemoryRuntimeContext` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵMemoryRuntimeContext } from "@copilotkit/vue/v2";
   * const v2MemoryRuntimeContext = ɵMemoryRuntimeContext;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ɵMemoryRuntimeContext,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵMemoryState` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵMemoryState } from "@copilotkit/vue/v2";
   * const v2MemoryState = ɵMemoryState;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ɵMemoryState,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵMemoryStore` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵMemoryStore } from "@copilotkit/vue/v2";
   * const v2MemoryStore = ɵMemoryStore;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ɵMemoryStore,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵobservePhoenixEvent$` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵobservePhoenixEvent$ } from "@copilotkit/vue/v2";
   * const v2ObservePhoenixEvent$ = ɵobservePhoenixEvent$;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ɵobservePhoenixEvent$,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵobservePhoenixJoinOutcome$` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵobservePhoenixJoinOutcome$ } from "@copilotkit/vue/v2";
   * const v2ObservePhoenixJoinOutcome$ = ɵobservePhoenixJoinOutcome$;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ɵobservePhoenixJoinOutcome$,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵobservePhoenixSocketHealth$` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵobservePhoenixSocketHealth$ } from "@copilotkit/vue/v2";
   * const v2ObservePhoenixSocketHealth$ = ɵobservePhoenixSocketHealth$;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ɵobservePhoenixSocketHealth$,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵobservePhoenixSocketSignals$` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵobservePhoenixSocketSignals$ } from "@copilotkit/vue/v2";
   * const v2ObservePhoenixSocketSignals$ = ɵobservePhoenixSocketSignals$;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ɵobservePhoenixSocketSignals$,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵPendingInterrupt` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵPendingInterrupt } from "@copilotkit/vue/v2";
   * const v2PendingInterrupt = ɵPendingInterrupt;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ɵPendingInterrupt,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵphoenixChannel$` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵphoenixChannel$ } from "@copilotkit/vue/v2";
   * const v2PhoenixChannel$ = ɵphoenixChannel$;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ɵphoenixChannel$,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵPhoenixChannelLike` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵPhoenixChannelLike } from "@copilotkit/vue/v2";
   * const v2PhoenixChannelLike = ɵPhoenixChannelLike;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ɵPhoenixChannelLike,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵPhoenixChannelOptions` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵPhoenixChannelOptions } from "@copilotkit/vue/v2";
   * const v2PhoenixChannelOptions = ɵPhoenixChannelOptions;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ɵPhoenixChannelOptions,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵPhoenixChannelSession` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵPhoenixChannelSession } from "@copilotkit/vue/v2";
   * const v2PhoenixChannelSession = ɵPhoenixChannelSession;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ɵPhoenixChannelSession,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵPhoenixJoinOutcome` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵPhoenixJoinOutcome } from "@copilotkit/vue/v2";
   * const v2PhoenixJoinOutcome = ɵPhoenixJoinOutcome;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ɵPhoenixJoinOutcome,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵPhoenixPushLike` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵPhoenixPushLike } from "@copilotkit/vue/v2";
   * const v2PhoenixPushLike = ɵPhoenixPushLike;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ɵPhoenixPushLike,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵphoenixSocket$` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵphoenixSocket$ } from "@copilotkit/vue/v2";
   * const v2PhoenixSocket$ = ɵphoenixSocket$;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ɵphoenixSocket$,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵPhoenixSocketLike` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵPhoenixSocketLike } from "@copilotkit/vue/v2";
   * const v2PhoenixSocketLike = ɵPhoenixSocketLike;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ɵPhoenixSocketLike,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵPhoenixSocketOptions` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵPhoenixSocketOptions } from "@copilotkit/vue/v2";
   * const v2PhoenixSocketOptions = ɵPhoenixSocketOptions;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ɵPhoenixSocketOptions,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵPhoenixSocketSession` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵPhoenixSocketSession } from "@copilotkit/vue/v2";
   * const v2PhoenixSocketSession = ɵPhoenixSocketSession;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ɵPhoenixSocketSession,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵPhoenixSocketSignal` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵPhoenixSocketSignal } from "@copilotkit/vue/v2";
   * const v2PhoenixSocketSignal = ɵPhoenixSocketSignal;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ɵPhoenixSocketSignal,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵselectFetchMoreError` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵselectFetchMoreError } from "@copilotkit/vue/v2";
   * const v2SelectFetchMoreError = ɵselectFetchMoreError;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ɵselectFetchMoreError,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵselectHasNextPage` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵselectHasNextPage } from "@copilotkit/vue/v2";
   * const v2SelectHasNextPage = ɵselectHasNextPage;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ɵselectHasNextPage,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵselectIsFetchingNextPage` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵselectIsFetchingNextPage } from "@copilotkit/vue/v2";
   * const v2SelectIsFetchingNextPage = ɵselectIsFetchingNextPage;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ɵselectIsFetchingNextPage,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵselectIsMutating` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵselectIsMutating } from "@copilotkit/vue/v2";
   * const v2SelectIsMutating = ɵselectIsMutating;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ɵselectIsMutating,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵselectMemories` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵselectMemories } from "@copilotkit/vue/v2";
   * const v2SelectMemories = ɵselectMemories;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ɵselectMemories,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵselectMemoriesAvailable` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵselectMemoriesAvailable } from "@copilotkit/vue/v2";
   * const v2SelectMemoriesAvailable = ɵselectMemoriesAvailable;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ɵselectMemoriesAvailable,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵselectMemoriesError` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵselectMemoriesError } from "@copilotkit/vue/v2";
   * const v2SelectMemoriesError = ɵselectMemoriesError;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ɵselectMemoriesError,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵselectMemoriesIsLoading` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵselectMemoriesIsLoading } from "@copilotkit/vue/v2";
   * const v2SelectMemoriesIsLoading = ɵselectMemoriesIsLoading;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ɵselectMemoriesIsLoading,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵselectMemoriesIsMutating` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵselectMemoriesIsMutating } from "@copilotkit/vue/v2";
   * const v2SelectMemoriesIsMutating = ɵselectMemoriesIsMutating;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ɵselectMemoriesIsMutating,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵselectMemoriesRealtimeStatus` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵselectMemoriesRealtimeStatus } from "@copilotkit/vue/v2";
   * const v2SelectMemoriesRealtimeStatus = ɵselectMemoriesRealtimeStatus;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ɵselectMemoriesRealtimeStatus,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵselectThreads` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵselectThreads } from "@copilotkit/vue/v2";
   * const v2SelectThreads = ɵselectThreads;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ɵselectThreads,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵselectThreadsError` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵselectThreadsError } from "@copilotkit/vue/v2";
   * const v2SelectThreadsError = ɵselectThreadsError;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ɵselectThreadsError,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵselectThreadsIsLoading` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵselectThreadsIsLoading } from "@copilotkit/vue/v2";
   * const v2SelectThreadsIsLoading = ɵselectThreadsIsLoading;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ɵselectThreadsIsLoading,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵThread` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵThread } from "@copilotkit/vue/v2";
   * const v2Thread = ɵThread;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ɵThread,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵthreadAdapterEvents` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵthreadAdapterEvents } from "@copilotkit/vue/v2";
   * const v2ThreadAdapterEvents = ɵthreadAdapterEvents;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ɵthreadAdapterEvents,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵThreadEnvironment` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵThreadEnvironment } from "@copilotkit/vue/v2";
   * const v2ThreadEnvironment = ɵThreadEnvironment;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ɵThreadEnvironment,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵThreadMetadataEvent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵThreadMetadataEvent } from "@copilotkit/vue/v2";
   * const v2ThreadMetadataEvent = ɵThreadMetadataEvent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ɵThreadMetadataEvent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵThreadRuntimeContext` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵThreadRuntimeContext } from "@copilotkit/vue/v2";
   * const v2ThreadRuntimeContext = ɵThreadRuntimeContext;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ɵThreadRuntimeContext,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵThreadSelectors` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵThreadSelectors } from "@copilotkit/vue/v2";
   * const v2ThreadSelectors = ɵThreadSelectors;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ɵThreadSelectors,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ɵThreadStore` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ɵThreadStore } from "@copilotkit/vue/v2";
   * const v2ThreadStore = ɵThreadStore;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ɵThreadStore,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `parseProtoStream` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { parseProtoStream } from "@copilotkit/vue/v2";
   * const v2ParseProtoStream = parseProtoStream;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  parseProtoStream,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `parseSSEStream` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { parseSSEStream } from "@copilotkit/vue/v2";
   * const v2ParseSSEStream = parseSSEStream;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  parseSSEStream,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `parseToolArguments` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { parseToolArguments } from "@copilotkit/vue/v2";
   * const v2ParseToolArguments = parseToolArguments;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  parseToolArguments,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `processPartialHtml` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { processPartialHtml } from "@copilotkit/vue/v2";
   * const v2ProcessPartialHtml = processPartialHtml;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  processPartialHtml,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `props` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { props } from "@copilotkit/vue/v2";
   * const v2Props = props;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  props,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `PropsActionConfig` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { PropsActionConfig } from "@copilotkit/vue/v2";
   * const v2PropsActionConfig = PropsActionConfig;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type PropsActionConfig,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ProxiedCopilotRuntimeAgent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ProxiedCopilotRuntimeAgent } from "@copilotkit/vue/v2";
   * const v2ProxiedCopilotRuntimeAgent = new ProxiedCopilotRuntimeAgent({});
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ProxiedCopilotRuntimeAgent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ProxiedCopilotRuntimeAgentConfig` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ProxiedCopilotRuntimeAgentConfig } from "@copilotkit/vue/v2";
   * const v2ProxiedCopilotRuntimeAgentConfig = ProxiedCopilotRuntimeAgentConfig;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ProxiedCopilotRuntimeAgentConfig,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `randomUUID` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { randomUUID } from "@copilotkit/vue/v2";
   * const v2RandomUUID = randomUUID;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  randomUUID,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `RawEvent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { RawEvent } from "@copilotkit/vue/v2";
   * const v2RawEvent = RawEvent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type RawEvent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `RawEventProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { RawEventProps } from "@copilotkit/vue/v2";
   * const v2RawEventProps = RawEventProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type RawEventProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `RawEventSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { RawEventSchema } from "@copilotkit/vue/v2";
   * const v2RawEventSchema = RawEventSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  RawEventSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ReasoningCapabilities` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { ReasoningCapabilities } from "@copilotkit/vue/v2";
   * type V2ReasoningCapabilities = ReasoningCapabilities;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ReasoningCapabilities,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ReasoningCapabilitiesSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ReasoningCapabilitiesSchema } from "@copilotkit/vue/v2";
   * const v2ReasoningCapabilitiesSchema = ReasoningCapabilitiesSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ReasoningCapabilitiesSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ReasoningEncryptedValueEvent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ReasoningEncryptedValueEvent } from "@copilotkit/vue/v2";
   * const v2ReasoningEncryptedValueEvent = ReasoningEncryptedValueEvent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ReasoningEncryptedValueEvent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ReasoningEncryptedValueEventProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ReasoningEncryptedValueEventProps } from "@copilotkit/vue/v2";
   * const v2ReasoningEncryptedValueEventProps = ReasoningEncryptedValueEventProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ReasoningEncryptedValueEventProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ReasoningEncryptedValueEventSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ReasoningEncryptedValueEventSchema } from "@copilotkit/vue/v2";
   * const v2ReasoningEncryptedValueEventSchema = ReasoningEncryptedValueEventSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ReasoningEncryptedValueEventSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ReasoningEncryptedValueSubtype` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ReasoningEncryptedValueSubtype } from "@copilotkit/vue/v2";
   * const v2ReasoningEncryptedValueSubtype = ReasoningEncryptedValueSubtype;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ReasoningEncryptedValueSubtype,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ReasoningEncryptedValueSubtypeSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ReasoningEncryptedValueSubtypeSchema } from "@copilotkit/vue/v2";
   * const v2ReasoningEncryptedValueSubtypeSchema = ReasoningEncryptedValueSubtypeSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ReasoningEncryptedValueSubtypeSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ReasoningEndEvent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ReasoningEndEvent } from "@copilotkit/vue/v2";
   * const v2ReasoningEndEvent = ReasoningEndEvent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ReasoningEndEvent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ReasoningEndEventProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ReasoningEndEventProps } from "@copilotkit/vue/v2";
   * const v2ReasoningEndEventProps = ReasoningEndEventProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ReasoningEndEventProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ReasoningEndEventSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ReasoningEndEventSchema } from "@copilotkit/vue/v2";
   * const v2ReasoningEndEventSchema = ReasoningEndEventSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ReasoningEndEventSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ReasoningMessage` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ReasoningMessage } from "@copilotkit/vue/v2";
   * const v2ReasoningMessage = ReasoningMessage;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ReasoningMessage,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ReasoningMessageChunkEvent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ReasoningMessageChunkEvent } from "@copilotkit/vue/v2";
   * const v2ReasoningMessageChunkEvent = ReasoningMessageChunkEvent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ReasoningMessageChunkEvent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ReasoningMessageChunkEventProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ReasoningMessageChunkEventProps } from "@copilotkit/vue/v2";
   * const v2ReasoningMessageChunkEventProps = ReasoningMessageChunkEventProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ReasoningMessageChunkEventProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ReasoningMessageChunkEventSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ReasoningMessageChunkEventSchema } from "@copilotkit/vue/v2";
   * const v2ReasoningMessageChunkEventSchema = ReasoningMessageChunkEventSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ReasoningMessageChunkEventSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ReasoningMessageContentEvent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ReasoningMessageContentEvent } from "@copilotkit/vue/v2";
   * const v2ReasoningMessageContentEvent = ReasoningMessageContentEvent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ReasoningMessageContentEvent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ReasoningMessageContentEventProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ReasoningMessageContentEventProps } from "@copilotkit/vue/v2";
   * const v2ReasoningMessageContentEventProps = ReasoningMessageContentEventProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ReasoningMessageContentEventProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ReasoningMessageContentEventSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ReasoningMessageContentEventSchema } from "@copilotkit/vue/v2";
   * const v2ReasoningMessageContentEventSchema = ReasoningMessageContentEventSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ReasoningMessageContentEventSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ReasoningMessageEndEvent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ReasoningMessageEndEvent } from "@copilotkit/vue/v2";
   * const v2ReasoningMessageEndEvent = ReasoningMessageEndEvent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ReasoningMessageEndEvent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ReasoningMessageEndEventProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ReasoningMessageEndEventProps } from "@copilotkit/vue/v2";
   * const v2ReasoningMessageEndEventProps = ReasoningMessageEndEventProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ReasoningMessageEndEventProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ReasoningMessageEndEventSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ReasoningMessageEndEventSchema } from "@copilotkit/vue/v2";
   * const v2ReasoningMessageEndEventSchema = ReasoningMessageEndEventSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ReasoningMessageEndEventSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ReasoningMessageSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ReasoningMessageSchema } from "@copilotkit/vue/v2";
   * const v2ReasoningMessageSchema = ReasoningMessageSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ReasoningMessageSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ReasoningMessageStartEvent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ReasoningMessageStartEvent } from "@copilotkit/vue/v2";
   * const v2ReasoningMessageStartEvent = ReasoningMessageStartEvent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ReasoningMessageStartEvent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ReasoningMessageStartEventProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ReasoningMessageStartEventProps } from "@copilotkit/vue/v2";
   * const v2ReasoningMessageStartEventProps = ReasoningMessageStartEventProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ReasoningMessageStartEventProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ReasoningMessageStartEventSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ReasoningMessageStartEventSchema } from "@copilotkit/vue/v2";
   * const v2ReasoningMessageStartEventSchema = ReasoningMessageStartEventSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ReasoningMessageStartEventSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ReasoningStartEvent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ReasoningStartEvent } from "@copilotkit/vue/v2";
   * const v2ReasoningStartEvent = ReasoningStartEvent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ReasoningStartEvent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ReasoningStartEventProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ReasoningStartEventProps } from "@copilotkit/vue/v2";
   * const v2ReasoningStartEventProps = ReasoningStartEventProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ReasoningStartEventProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ReasoningStartEventSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ReasoningStartEventSchema } from "@copilotkit/vue/v2";
   * const v2ReasoningStartEventSchema = ReasoningStartEventSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ReasoningStartEventSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `Reducer` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { Reducer } from "@copilotkit/vue/v2";
   * const v2Reducer = Reducer;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type Reducer,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `resolveAgentDebugConfig` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { resolveAgentDebugConfig } from "@copilotkit/vue/v2";
   * const v2ResolveAgentDebugConfig = resolveAgentDebugConfig;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  resolveAgentDebugConfig,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ResolvedAgentDebugConfig` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { ResolvedAgentDebugConfig } from "@copilotkit/vue/v2";
   * type V2ResolvedAgentDebugConfig = ResolvedAgentDebugConfig;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ResolvedAgentDebugConfig,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `resolveDebugLogger` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { resolveDebugLogger } from "@copilotkit/vue/v2";
   * const v2ResolveDebugLogger = resolveDebugLogger;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  resolveDebugLogger,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ResumeEntry` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ResumeEntry } from "@copilotkit/vue/v2";
   * const v2ResumeEntry = ResumeEntry;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ResumeEntry,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ResumeEntrySchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ResumeEntrySchema } from "@copilotkit/vue/v2";
   * const v2ResumeEntrySchema = ResumeEntrySchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ResumeEntrySchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ResumeStatus` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ResumeStatus } from "@copilotkit/vue/v2";
   * const v2ResumeStatus = ResumeStatus;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ResumeStatus,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `Role` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { Role } from "@copilotkit/vue/v2";
   * const v2Role = Role;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type Role,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `RoleSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { RoleSchema } from "@copilotkit/vue/v2";
   * const v2RoleSchema = RoleSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  RoleSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `RunAgentInput` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { RunAgentInput } from "@copilotkit/vue/v2";
   * const v2RunAgentInput = RunAgentInput;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type RunAgentInput,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `RunAgentInputSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { RunAgentInputSchema } from "@copilotkit/vue/v2";
   * const v2RunAgentInputSchema = RunAgentInputSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  RunAgentInputSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `RunAgentParameters` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { RunAgentParameters } from "@copilotkit/vue/v2";
   * type V2RunAgentParameters = RunAgentParameters;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type RunAgentParameters,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `RunAgentResult` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { RunAgentResult } from "@copilotkit/vue/v2";
   * type V2RunAgentResult = RunAgentResult;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type RunAgentResult,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `RunCompletionAware` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { RunCompletionAware } from "@copilotkit/vue/v2";
   * const v2RunCompletionAware = RunCompletionAware;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type RunCompletionAware,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `RunErrorEvent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { RunErrorEvent } from "@copilotkit/vue/v2";
   * const v2RunErrorEvent = RunErrorEvent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type RunErrorEvent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `RunErrorEventProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { RunErrorEventProps } from "@copilotkit/vue/v2";
   * const v2RunErrorEventProps = RunErrorEventProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type RunErrorEventProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `RunErrorEventSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { RunErrorEventSchema } from "@copilotkit/vue/v2";
   * const v2RunErrorEventSchema = RunErrorEventSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  RunErrorEventSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `RunFinishedEvent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { RunFinishedEvent } from "@copilotkit/vue/v2";
   * const v2RunFinishedEvent = RunFinishedEvent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type RunFinishedEvent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `RunFinishedEventProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { RunFinishedEventProps } from "@copilotkit/vue/v2";
   * const v2RunFinishedEventProps = RunFinishedEventProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type RunFinishedEventProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `RunFinishedEventSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { RunFinishedEventSchema } from "@copilotkit/vue/v2";
   * const v2RunFinishedEventSchema = RunFinishedEventSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  RunFinishedEventSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `RunFinishedInterruptOutcome` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { RunFinishedInterruptOutcome } from "@copilotkit/vue/v2";
   * const v2RunFinishedInterruptOutcome = RunFinishedInterruptOutcome;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type RunFinishedInterruptOutcome,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `RunFinishedInterruptOutcomeSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { RunFinishedInterruptOutcomeSchema } from "@copilotkit/vue/v2";
   * const v2RunFinishedInterruptOutcomeSchema = RunFinishedInterruptOutcomeSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  RunFinishedInterruptOutcomeSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `RunFinishedOutcome` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { RunFinishedOutcome } from "@copilotkit/vue/v2";
   * const v2RunFinishedOutcome = RunFinishedOutcome;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type RunFinishedOutcome,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `RunFinishedOutcomeSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { RunFinishedOutcomeSchema } from "@copilotkit/vue/v2";
   * const v2RunFinishedOutcomeSchema = RunFinishedOutcomeSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  RunFinishedOutcomeSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `RunFinishedSuccessOutcome` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { RunFinishedSuccessOutcome } from "@copilotkit/vue/v2";
   * const v2RunFinishedSuccessOutcome = RunFinishedSuccessOutcome;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type RunFinishedSuccessOutcome,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `RunFinishedSuccessOutcomeSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { RunFinishedSuccessOutcomeSchema } from "@copilotkit/vue/v2";
   * const v2RunFinishedSuccessOutcomeSchema = RunFinishedSuccessOutcomeSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  RunFinishedSuccessOutcomeSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `RunHandler` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { RunHandler } from "@copilotkit/vue/v2";
   * const v2RunHandler = new RunHandler({});
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  RunHandler,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `runHttpRequest` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { runHttpRequest } from "@copilotkit/vue/v2";
   * const v2RunHttpRequest = runHttpRequest;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  runHttpRequest,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `RunStartedEvent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { RunStartedEvent } from "@copilotkit/vue/v2";
   * const v2RunStartedEvent = RunStartedEvent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type RunStartedEvent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `RunStartedEventProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { RunStartedEventProps } from "@copilotkit/vue/v2";
   * const v2RunStartedEventProps = RunStartedEventProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type RunStartedEventProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `RunStartedEventSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { RunStartedEventSchema } from "@copilotkit/vue/v2";
   * const v2RunStartedEventSchema = RunStartedEventSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  RunStartedEventSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `RuntimeLicenseStatus` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { RuntimeLicenseStatus } from "@copilotkit/vue/v2";
   * type V2RuntimeLicenseStatus = RuntimeLicenseStatus;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type RuntimeLicenseStatus,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `RuntimeMode` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { RuntimeMode } from "@copilotkit/vue/v2";
   * type V2RuntimeMode = RuntimeMode;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type RuntimeMode,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `SandboxFunction` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { SandboxFunction } from "@copilotkit/vue/v2";
   * type V2SandboxFunction = SandboxFunction;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type SandboxFunction,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ScopedContext` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ScopedContext } from "@copilotkit/vue/v2";
   * const v2ScopedContext = ScopedContext;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ScopedContext,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `select` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { select } from "@copilotkit/vue/v2";
   * const v2Select = select;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  select,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `Selector` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { Selector } from "@copilotkit/vue/v2";
   * const v2Selector = Selector;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type Selector,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `State` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { State } from "@copilotkit/vue/v2";
   * const v2State = State;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type State,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `StateCapabilities` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { StateCapabilities } from "@copilotkit/vue/v2";
   * type V2StateCapabilities = StateCapabilities;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type StateCapabilities,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `StateCapabilitiesSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { StateCapabilitiesSchema } from "@copilotkit/vue/v2";
   * const v2StateCapabilitiesSchema = StateCapabilitiesSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  StateCapabilitiesSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `StateDeltaEvent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { StateDeltaEvent } from "@copilotkit/vue/v2";
   * const v2StateDeltaEvent = StateDeltaEvent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type StateDeltaEvent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `StateDeltaEventProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { StateDeltaEventProps } from "@copilotkit/vue/v2";
   * const v2StateDeltaEventProps = StateDeltaEventProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type StateDeltaEventProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `StateDeltaEventSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { StateDeltaEventSchema } from "@copilotkit/vue/v2";
   * const v2StateDeltaEventSchema = StateDeltaEventSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  StateDeltaEventSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `StateManager` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { StateManager } from "@copilotkit/vue/v2";
   * const v2StateManager = new StateManager({});
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  StateManager,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `StateSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { StateSchema } from "@copilotkit/vue/v2";
   * const v2StateSchema = StateSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  StateSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `StateSnapshotEvent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { StateSnapshotEvent } from "@copilotkit/vue/v2";
   * const v2StateSnapshotEvent = StateSnapshotEvent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type StateSnapshotEvent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `StateSnapshotEventProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { StateSnapshotEventProps } from "@copilotkit/vue/v2";
   * const v2StateSnapshotEventProps = StateSnapshotEventProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type StateSnapshotEventProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `StateSnapshotEventSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { StateSnapshotEventSchema } from "@copilotkit/vue/v2";
   * const v2StateSnapshotEventSchema = StateSnapshotEventSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  StateSnapshotEventSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `StaticSuggestionsConfig` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { StaticSuggestionsConfig } from "@copilotkit/vue/v2";
   * const v2StaticSuggestionsConfig = StaticSuggestionsConfig;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type StaticSuggestionsConfig,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `StepFinishedEvent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { StepFinishedEvent } from "@copilotkit/vue/v2";
   * const v2StepFinishedEvent = StepFinishedEvent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type StepFinishedEvent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `StepFinishedEventProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { StepFinishedEventProps } from "@copilotkit/vue/v2";
   * const v2StepFinishedEventProps = StepFinishedEventProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type StepFinishedEventProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `StepFinishedEventSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { StepFinishedEventSchema } from "@copilotkit/vue/v2";
   * const v2StepFinishedEventSchema = StepFinishedEventSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  StepFinishedEventSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `StepStartedEvent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { StepStartedEvent } from "@copilotkit/vue/v2";
   * const v2StepStartedEvent = StepStartedEvent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type StepStartedEvent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `StepStartedEventProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { StepStartedEventProps } from "@copilotkit/vue/v2";
   * const v2StepStartedEventProps = StepStartedEventProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type StepStartedEventProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `StepStartedEventSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { StepStartedEventSchema } from "@copilotkit/vue/v2";
   * const v2StepStartedEventSchema = StepStartedEventSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  StepStartedEventSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `Store` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { Store } from "@copilotkit/vue/v2";
   * const v2Store = Store;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type Store,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `StoreLifecycleAction` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { StoreLifecycleAction } from "@copilotkit/vue/v2";
   * const v2StoreLifecycleAction = StoreLifecycleAction;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type StoreLifecycleAction,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `structuredClone_` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { structuredClone_ } from "@copilotkit/vue/v2";
   * const v2StructuredClone_ = structuredClone_;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  structuredClone_,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `SubAgentInfo` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { SubAgentInfo } from "@copilotkit/vue/v2";
   * type V2SubAgentInfo = SubAgentInfo;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type SubAgentInfo,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `SubAgentInfoSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { SubAgentInfoSchema } from "@copilotkit/vue/v2";
   * const v2SubAgentInfoSchema = SubAgentInfoSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  SubAgentInfoSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `SubscribeToAgentOptions` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { SubscribeToAgentOptions } from "@copilotkit/vue/v2";
   * const v2SubscribeToAgentOptions = SubscribeToAgentOptions;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type SubscribeToAgentOptions,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `SubscribeToAgentSubscriber` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { SubscribeToAgentSubscriber } from "@copilotkit/vue/v2";
   * const v2SubscribeToAgentSubscriber = SubscribeToAgentSubscriber;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type SubscribeToAgentSubscriber,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `Suggestion` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { Suggestion } from "@copilotkit/vue/v2";
   * const v2Suggestion = Suggestion;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type Suggestion,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `SuggestionAvailability` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { SuggestionAvailability } from "@copilotkit/vue/v2";
   * const v2SuggestionAvailability = SuggestionAvailability;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type SuggestionAvailability,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `SuggestionEngine` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { SuggestionEngine } from "@copilotkit/vue/v2";
   * const v2SuggestionEngine = new SuggestionEngine({});
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  SuggestionEngine,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `SuggestionsConfig` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { SuggestionsConfig } from "@copilotkit/vue/v2";
   * const v2SuggestionsConfig = SuggestionsConfig;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type SuggestionsConfig,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `SystemMessage` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { SystemMessage } from "@copilotkit/vue/v2";
   * const v2SystemMessage = SystemMessage;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type SystemMessage,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `SystemMessageSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { SystemMessageSchema } from "@copilotkit/vue/v2";
   * const v2SystemMessageSchema = SystemMessageSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  SystemMessageSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `TextInputContent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { TextInputContent } from "@copilotkit/vue/v2";
   * const v2TextInputContent = TextInputContent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type TextInputContent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `TextInputContentSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { TextInputContentSchema } from "@copilotkit/vue/v2";
   * const v2TextInputContentSchema = TextInputContentSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  TextInputContentSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `TextMessageChunkEvent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { TextMessageChunkEvent } from "@copilotkit/vue/v2";
   * const v2TextMessageChunkEvent = TextMessageChunkEvent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type TextMessageChunkEvent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `TextMessageChunkEventProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { TextMessageChunkEventProps } from "@copilotkit/vue/v2";
   * const v2TextMessageChunkEventProps = TextMessageChunkEventProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type TextMessageChunkEventProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `TextMessageChunkEventSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { TextMessageChunkEventSchema } from "@copilotkit/vue/v2";
   * const v2TextMessageChunkEventSchema = TextMessageChunkEventSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  TextMessageChunkEventSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `TextMessageContentEvent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { TextMessageContentEvent } from "@copilotkit/vue/v2";
   * const v2TextMessageContentEvent = TextMessageContentEvent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type TextMessageContentEvent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `TextMessageContentEventProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { TextMessageContentEventProps } from "@copilotkit/vue/v2";
   * const v2TextMessageContentEventProps = TextMessageContentEventProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type TextMessageContentEventProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `TextMessageContentEventSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { TextMessageContentEventSchema } from "@copilotkit/vue/v2";
   * const v2TextMessageContentEventSchema = TextMessageContentEventSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  TextMessageContentEventSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `TextMessageEndEvent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { TextMessageEndEvent } from "@copilotkit/vue/v2";
   * const v2TextMessageEndEvent = TextMessageEndEvent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type TextMessageEndEvent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `TextMessageEndEventProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { TextMessageEndEventProps } from "@copilotkit/vue/v2";
   * const v2TextMessageEndEventProps = TextMessageEndEventProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type TextMessageEndEventProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `TextMessageEndEventSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { TextMessageEndEventSchema } from "@copilotkit/vue/v2";
   * const v2TextMessageEndEventSchema = TextMessageEndEventSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  TextMessageEndEventSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `TextMessageStartEvent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { TextMessageStartEvent } from "@copilotkit/vue/v2";
   * const v2TextMessageStartEvent = TextMessageStartEvent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type TextMessageStartEvent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `TextMessageStartEventProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { TextMessageStartEventProps } from "@copilotkit/vue/v2";
   * const v2TextMessageStartEventProps = TextMessageStartEventProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type TextMessageStartEventProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `TextMessageStartEventSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { TextMessageStartEventSchema } from "@copilotkit/vue/v2";
   * const v2TextMessageStartEventSchema = TextMessageStartEventSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  TextMessageStartEventSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ThinkingEndEvent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ThinkingEndEvent } from "@copilotkit/vue/v2";
   * const v2ThinkingEndEvent = ThinkingEndEvent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ThinkingEndEvent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ThinkingEndEventProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ThinkingEndEventProps } from "@copilotkit/vue/v2";
   * const v2ThinkingEndEventProps = ThinkingEndEventProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ThinkingEndEventProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ThinkingEndEventSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ThinkingEndEventSchema } from "@copilotkit/vue/v2";
   * const v2ThinkingEndEventSchema = ThinkingEndEventSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ThinkingEndEventSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ThinkingStartEvent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ThinkingStartEvent } from "@copilotkit/vue/v2";
   * const v2ThinkingStartEvent = ThinkingStartEvent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ThinkingStartEvent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ThinkingStartEventProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ThinkingStartEventProps } from "@copilotkit/vue/v2";
   * const v2ThinkingStartEventProps = ThinkingStartEventProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ThinkingStartEventProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ThinkingStartEventSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ThinkingStartEventSchema } from "@copilotkit/vue/v2";
   * const v2ThinkingStartEventSchema = ThinkingStartEventSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ThinkingStartEventSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ThinkingTextMessageContentEvent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ThinkingTextMessageContentEvent } from "@copilotkit/vue/v2";
   * const v2ThinkingTextMessageContentEvent = ThinkingTextMessageContentEvent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ThinkingTextMessageContentEvent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ThinkingTextMessageContentEventProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ThinkingTextMessageContentEventProps } from "@copilotkit/vue/v2";
   * const v2ThinkingTextMessageContentEventProps = ThinkingTextMessageContentEventProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ThinkingTextMessageContentEventProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ThinkingTextMessageContentEventSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ThinkingTextMessageContentEventSchema } from "@copilotkit/vue/v2";
   * const v2ThinkingTextMessageContentEventSchema = ThinkingTextMessageContentEventSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ThinkingTextMessageContentEventSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ThinkingTextMessageEndEvent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ThinkingTextMessageEndEvent } from "@copilotkit/vue/v2";
   * const v2ThinkingTextMessageEndEvent = ThinkingTextMessageEndEvent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ThinkingTextMessageEndEvent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ThinkingTextMessageEndEventProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ThinkingTextMessageEndEventProps } from "@copilotkit/vue/v2";
   * const v2ThinkingTextMessageEndEventProps = ThinkingTextMessageEndEventProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ThinkingTextMessageEndEventProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ThinkingTextMessageEndEventSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ThinkingTextMessageEndEventSchema } from "@copilotkit/vue/v2";
   * const v2ThinkingTextMessageEndEventSchema = ThinkingTextMessageEndEventSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ThinkingTextMessageEndEventSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ThinkingTextMessageStartEvent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ThinkingTextMessageStartEvent } from "@copilotkit/vue/v2";
   * const v2ThinkingTextMessageStartEvent = ThinkingTextMessageStartEvent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ThinkingTextMessageStartEvent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ThinkingTextMessageStartEventProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ThinkingTextMessageStartEventProps } from "@copilotkit/vue/v2";
   * const v2ThinkingTextMessageStartEventProps = ThinkingTextMessageStartEventProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ThinkingTextMessageStartEventProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ThinkingTextMessageStartEventSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ThinkingTextMessageStartEventSchema } from "@copilotkit/vue/v2";
   * const v2ThinkingTextMessageStartEventSchema = ThinkingTextMessageStartEventSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ThinkingTextMessageStartEventSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `Thread` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { Thread } from "@copilotkit/vue/v2";
   * type V2Thread = Thread;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type Thread,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ThreadEndpointRuntimeInfo` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { ThreadEndpointRuntimeInfo } from "@copilotkit/vue/v2";
   * type V2ThreadEndpointRuntimeInfo = ThreadEndpointRuntimeInfo;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ThreadEndpointRuntimeInfo,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ThreadRunActivityNotification` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ThreadRunActivityNotification } from "@copilotkit/vue/v2";
   * const v2ThreadRunActivityNotification = ThreadRunActivityNotification;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ThreadRunActivityNotification,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `Tool` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { Tool } from "@copilotkit/vue/v2";
   * const v2Tool = Tool;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type Tool,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ToolCall` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ToolCall } from "@copilotkit/vue/v2";
   * const v2ToolCall = ToolCall;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ToolCall,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ToolCallArgsEvent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ToolCallArgsEvent } from "@copilotkit/vue/v2";
   * const v2ToolCallArgsEvent = ToolCallArgsEvent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ToolCallArgsEvent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ToolCallArgsEventProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ToolCallArgsEventProps } from "@copilotkit/vue/v2";
   * const v2ToolCallArgsEventProps = ToolCallArgsEventProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ToolCallArgsEventProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ToolCallArgsEventSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ToolCallArgsEventSchema } from "@copilotkit/vue/v2";
   * const v2ToolCallArgsEventSchema = ToolCallArgsEventSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ToolCallArgsEventSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ToolCallChunkEvent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ToolCallChunkEvent } from "@copilotkit/vue/v2";
   * const v2ToolCallChunkEvent = ToolCallChunkEvent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ToolCallChunkEvent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ToolCallChunkEventProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ToolCallChunkEventProps } from "@copilotkit/vue/v2";
   * const v2ToolCallChunkEventProps = ToolCallChunkEventProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ToolCallChunkEventProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ToolCallChunkEventSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ToolCallChunkEventSchema } from "@copilotkit/vue/v2";
   * const v2ToolCallChunkEventSchema = ToolCallChunkEventSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ToolCallChunkEventSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ToolCallEndEvent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ToolCallEndEvent } from "@copilotkit/vue/v2";
   * const v2ToolCallEndEvent = ToolCallEndEvent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ToolCallEndEvent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ToolCallEndEventProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ToolCallEndEventProps } from "@copilotkit/vue/v2";
   * const v2ToolCallEndEventProps = ToolCallEndEventProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ToolCallEndEventProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ToolCallEndEventSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ToolCallEndEventSchema } from "@copilotkit/vue/v2";
   * const v2ToolCallEndEventSchema = ToolCallEndEventSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ToolCallEndEventSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ToolCallResultEvent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ToolCallResultEvent } from "@copilotkit/vue/v2";
   * const v2ToolCallResultEvent = ToolCallResultEvent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ToolCallResultEvent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ToolCallResultEventProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ToolCallResultEventProps } from "@copilotkit/vue/v2";
   * const v2ToolCallResultEventProps = ToolCallResultEventProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ToolCallResultEventProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ToolCallResultEventSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ToolCallResultEventSchema } from "@copilotkit/vue/v2";
   * const v2ToolCallResultEventSchema = ToolCallResultEventSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ToolCallResultEventSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ToolCallSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ToolCallSchema } from "@copilotkit/vue/v2";
   * const v2ToolCallSchema = ToolCallSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ToolCallSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ToolCallStartEvent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ToolCallStartEvent } from "@copilotkit/vue/v2";
   * const v2ToolCallStartEvent = ToolCallStartEvent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ToolCallStartEvent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ToolCallStartEventProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ToolCallStartEventProps } from "@copilotkit/vue/v2";
   * const v2ToolCallStartEventProps = ToolCallStartEventProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ToolCallStartEventProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ToolCallStartEventSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ToolCallStartEventSchema } from "@copilotkit/vue/v2";
   * const v2ToolCallStartEventSchema = ToolCallStartEventSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ToolCallStartEventSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ToolCallStatus` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ToolCallStatus } from "@copilotkit/vue/v2";
   * const v2ToolCallStatus = ToolCallStatus;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ToolCallStatus,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ToolMessage` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ToolMessage } from "@copilotkit/vue/v2";
   * const v2ToolMessage = ToolMessage;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ToolMessage,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ToolMessageSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ToolMessageSchema } from "@copilotkit/vue/v2";
   * const v2ToolMessageSchema = ToolMessageSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ToolMessageSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ToolsCapabilities` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { ToolsCapabilities } from "@copilotkit/vue/v2";
   * type V2ToolsCapabilities = ToolsCapabilities;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ToolsCapabilities,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ToolsCapabilitiesSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ToolsCapabilitiesSchema } from "@copilotkit/vue/v2";
   * const v2ToolsCapabilitiesSchema = ToolsCapabilitiesSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ToolsCapabilitiesSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ToolSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { ToolSchema } from "@copilotkit/vue/v2";
   * const v2ToolSchema = ToolSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ToolSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `ToolsMenuItem` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { ToolsMenuItem } from "@copilotkit/vue/v2";
   * type V2ToolsMenuItem = ToolsMenuItem;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ToolsMenuItem,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `transformChunks` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { transformChunks } from "@copilotkit/vue/v2";
   * const v2TransformChunks = transformChunks;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  transformChunks,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `transformHttpEventStream` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { transformHttpEventStream } from "@copilotkit/vue/v2";
   * const v2TransformHttpEventStream = transformHttpEventStream;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  transformHttpEventStream,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `TransportCapabilities` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { TransportCapabilities } from "@copilotkit/vue/v2";
   * type V2TransportCapabilities = TransportCapabilities;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type TransportCapabilities,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `TransportCapabilitiesSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { TransportCapabilitiesSchema } from "@copilotkit/vue/v2";
   * const v2TransportCapabilitiesSchema = TransportCapabilitiesSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  TransportCapabilitiesSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `useAgent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { useAgent } from "@copilotkit/vue/v2";
   * useAgent({});
   * ```
   * See https://docs.copilotkit.ai/reference/vue/hooks/useAgent
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useAgent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `useAgentContext` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { useAgentContext } from "@copilotkit/vue/v2";
   * useAgentContext({});
   * ```
   * See https://docs.copilotkit.ai/reference/vue/hooks/useAgentContext
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useAgentContext,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `UseAgentUpdate` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { UseAgentUpdate } from "@copilotkit/vue/v2";
   * const v2UseAgentUpdate = UseAgentUpdate;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  UseAgentUpdate,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `useAttachments` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { useAttachments } from "@copilotkit/vue/v2";
   * useAttachments({});
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useAttachments,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `UseAttachmentsProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { UseAttachmentsProps } from "@copilotkit/vue/v2";
   * type V2UseAttachmentsProps = UseAttachmentsProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type UseAttachmentsProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `UseAttachmentsReturn` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { UseAttachmentsReturn } from "@copilotkit/vue/v2";
   * type V2UseAttachmentsReturn = UseAttachmentsReturn;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type UseAttachmentsReturn,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `useCapabilities` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { useCapabilities } from "@copilotkit/vue/v2";
   * useCapabilities({});
   * ```
   * See https://docs.copilotkit.ai/reference/vue/hooks/useCapabilities
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useCapabilities,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `useComponent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { useComponent } from "@copilotkit/vue/v2";
   * useComponent({});
   * ```
   * See https://docs.copilotkit.ai/reference/vue/hooks/useComponent
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useComponent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `useConfigureSuggestions` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { useConfigureSuggestions } from "@copilotkit/vue/v2";
   * useConfigureSuggestions({});
   * ```
   * See https://docs.copilotkit.ai/reference/vue/hooks/useConfigureSuggestions
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useConfigureSuggestions,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `useCopilotChatConfiguration` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { useCopilotChatConfiguration } from "@copilotkit/vue/v2";
   * useCopilotChatConfiguration({});
   * ```
   * See https://docs.copilotkit.ai/reference/vue/hooks/useCopilotChatConfiguration
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useCopilotChatConfiguration,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `useCopilotKit` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { useCopilotKit } from "@copilotkit/vue/v2";
   * useCopilotKit({});
   * ```
   * See https://docs.copilotkit.ai/reference/vue/hooks/useCopilotKit
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useCopilotKit,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `useDefaultRenderTool` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { useDefaultRenderTool } from "@copilotkit/vue/v2";
   * useDefaultRenderTool({});
   * ```
   * See https://docs.copilotkit.ai/reference/vue/hooks/useDefaultRenderTool
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useDefaultRenderTool,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `useHumanInTheLoop` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { useHumanInTheLoop } from "@copilotkit/vue/v2";
   * useHumanInTheLoop({});
   * ```
   * See https://docs.copilotkit.ai/reference/vue/hooks/useHumanInTheLoop
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useHumanInTheLoop,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `useInterrupt` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { useInterrupt } from "@copilotkit/vue/v2";
   * useInterrupt({});
   * ```
   * See https://docs.copilotkit.ai/reference/vue/hooks/useInterrupt
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useInterrupt,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `UseInterruptConfig` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { UseInterruptConfig } from "@copilotkit/vue/v2";
   * type V2UseInterruptConfig = UseInterruptConfig;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type UseInterruptConfig,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `UseInterruptResult` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { UseInterruptResult } from "@copilotkit/vue/v2";
   * type V2UseInterruptResult = UseInterruptResult;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type UseInterruptResult,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `useKatexStyles` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { useKatexStyles } from "@copilotkit/vue/v2";
   * useKatexStyles({});
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useKatexStyles,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `useKeyboardHeight` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { useKeyboardHeight } from "@copilotkit/vue/v2";
   * useKeyboardHeight({});
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useKeyboardHeight,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `useLicenseContext` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { useLicenseContext } from "@copilotkit/vue/v2";
   * useLicenseContext({});
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useLicenseContext,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `useRenderActivityMessage` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { useRenderActivityMessage } from "@copilotkit/vue/v2";
   * useRenderActivityMessage({});
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useRenderActivityMessage,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `useRenderCustomMessages` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { useRenderCustomMessages } from "@copilotkit/vue/v2";
   * useRenderCustomMessages({});
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useRenderCustomMessages,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `useRenderTool` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { useRenderTool } from "@copilotkit/vue/v2";
   * useRenderTool({});
   * ```
   * See https://docs.copilotkit.ai/reference/vue/hooks/useRenderTool
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useRenderTool,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `UserMessage` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { UserMessage } from "@copilotkit/vue/v2";
   * const v2UserMessage = UserMessage;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type UserMessage,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `UserMessageSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { UserMessageSchema } from "@copilotkit/vue/v2";
   * const v2UserMessageSchema = UserMessageSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  UserMessageSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `useSandboxFunctions` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { useSandboxFunctions } from "@copilotkit/vue/v2";
   * useSandboxFunctions({});
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useSandboxFunctions,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `useSuggestions` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { useSuggestions } from "@copilotkit/vue/v2";
   * useSuggestions({});
   * ```
   * See https://docs.copilotkit.ai/reference/vue/hooks/useSuggestions
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useSuggestions,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `UseSuggestionsOptions` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { UseSuggestionsOptions } from "@copilotkit/vue/v2";
   * type V2UseSuggestionsOptions = UseSuggestionsOptions;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type UseSuggestionsOptions,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `UseSuggestionsResult` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { UseSuggestionsResult } from "@copilotkit/vue/v2";
   * type V2UseSuggestionsResult = UseSuggestionsResult;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type UseSuggestionsResult,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `useThreads` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { useThreads } from "@copilotkit/vue/v2";
   * useThreads({});
   * ```
   * See https://docs.copilotkit.ai/reference/vue/hooks/useThreads
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useThreads,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `UseThreadsInput` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { UseThreadsInput } from "@copilotkit/vue/v2";
   * type V2UseThreadsInput = UseThreadsInput;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type UseThreadsInput,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `UseThreadsResult` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { UseThreadsResult } from "@copilotkit/vue/v2";
   * type V2UseThreadsResult = UseThreadsResult;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type UseThreadsResult,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `verifyEvents` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { verifyEvents } from "@copilotkit/vue/v2";
   * const v2VerifyEvents = verifyEvents;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  verifyEvents,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `VideoInputContent` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { VideoInputContent } from "@copilotkit/vue/v2";
   * const v2VideoInputContent = VideoInputContent;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type VideoInputContent,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `VideoInputContentSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { VideoInputContentSchema } from "@copilotkit/vue/v2";
   * const v2VideoInputContentSchema = VideoInputContentSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  VideoInputContentSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `VideoInputPart` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { VideoInputPart } from "@copilotkit/vue/v2";
   * const v2VideoInputPart = VideoInputPart;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type VideoInputPart,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `VideoInputPartSchema` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { VideoInputPartSchema } from "@copilotkit/vue/v2";
   * const v2VideoInputPartSchema = VideoInputPartSchema;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  VideoInputPartSchema,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `VueActivityMessageRenderer` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { VueActivityMessageRenderer } from "@copilotkit/vue/v2";
   * type V2VueActivityMessageRenderer = VueActivityMessageRenderer;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type VueActivityMessageRenderer,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `VueActivityMessageRendererProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { VueActivityMessageRendererProps } from "@copilotkit/vue/v2";
   * type V2VueActivityMessageRendererProps = VueActivityMessageRendererProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type VueActivityMessageRendererProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `VueActivityMessageRendererRenderFn` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { VueActivityMessageRendererRenderFn } from "@copilotkit/vue/v2";
   * type V2VueActivityMessageRendererRenderFn = VueActivityMessageRendererRenderFn;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type VueActivityMessageRendererRenderFn,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `vueBasicCatalog` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import { vueBasicCatalog } from "@copilotkit/vue/v2";
   * const v2VueBasicCatalog = vueBasicCatalog;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  vueBasicCatalog,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `VueCustomMessageRenderer` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { VueCustomMessageRenderer } from "@copilotkit/vue/v2";
   * type V2VueCustomMessageRenderer = VueCustomMessageRenderer;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type VueCustomMessageRenderer,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `VueCustomMessageRendererPosition` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { VueCustomMessageRendererPosition } from "@copilotkit/vue/v2";
   * type V2VueCustomMessageRendererPosition = VueCustomMessageRendererPosition;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type VueCustomMessageRendererPosition,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `VueCustomMessageRendererProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { VueCustomMessageRendererProps } from "@copilotkit/vue/v2";
   * type V2VueCustomMessageRendererProps = VueCustomMessageRendererProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type VueCustomMessageRendererProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `VueCustomMessageRendererRenderFn` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { VueCustomMessageRendererRenderFn } from "@copilotkit/vue/v2";
   * type V2VueCustomMessageRendererRenderFn = VueCustomMessageRendererRenderFn;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type VueCustomMessageRendererRenderFn,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `VueFrontendTool` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { VueFrontendTool } from "@copilotkit/vue/v2";
   * type V2VueFrontendTool = VueFrontendTool;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type VueFrontendTool,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `VueHumanInTheLoop` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { VueHumanInTheLoop } from "@copilotkit/vue/v2";
   * type V2VueHumanInTheLoop = VueHumanInTheLoop;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type VueHumanInTheLoop,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `VueHumanInTheLoopRenderFn` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { VueHumanInTheLoopRenderFn } from "@copilotkit/vue/v2";
   * type V2VueHumanInTheLoopRenderFn = VueHumanInTheLoopRenderFn;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type VueHumanInTheLoopRenderFn,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `VueHumanInTheLoopRenderProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { VueHumanInTheLoopRenderProps } from "@copilotkit/vue/v2";
   * type V2VueHumanInTheLoopRenderProps = VueHumanInTheLoopRenderProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type VueHumanInTheLoopRenderProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `VueToolCallRenderer` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { VueToolCallRenderer } from "@copilotkit/vue/v2";
   * type V2VueToolCallRenderer = VueToolCallRenderer;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type VueToolCallRenderer,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `VueToolCallRendererRenderFn` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { VueToolCallRendererRenderFn } from "@copilotkit/vue/v2";
   * type V2VueToolCallRendererRenderFn = VueToolCallRendererRenderFn;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type VueToolCallRendererRenderFn,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `VueToolCallRendererRenderProps` from `@copilotkit/vue/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { VueToolCallRendererRenderProps } from "@copilotkit/vue/v2";
   * type V2VueToolCallRendererRenderProps = VueToolCallRendererRenderProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type VueToolCallRendererRenderProps,
} from "./v2";

/* END GENERATED V1 DEPRECATED EXPORTS. USE V2 INSTEAD. */
