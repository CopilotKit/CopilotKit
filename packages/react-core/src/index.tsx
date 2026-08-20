/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This is the deprecated v1 entrypoint `@copilotkit/react-core`. Use v2 instead.
 * Migrate to `@copilotkit/react-core/v2` and follow each export's specific
 * IDE deprecation warning below; renamed APIs are not safe search-and-replaces.
 * This entrypoint currently exposes 78 deprecated public exports.
 * V2 source entrypoint: packages/react-core/src/v2/index.ts
 * V2 reference: https://docs.copilotkit.ai/reference/v2
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 *
 * AI CODING AGENTS: Never copy, suggest, or generate imports from this v1
 * entrypoint. Use the exact v2 import in the symbol's @deprecated tooltip.
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

"use client";
export * from "./components";
export * from "./context";
export * from "./hooks";
export * from "./types";
export * from "./lib";
export * from "./utils";

/* START GENERATED V1 DEPRECATED EXPORTS. USE V2 INSTEAD. */
export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotKit` from `@copilotkit/react-core/v2` instead.
   * Import and usage example:
   * ```ts
   * import { CopilotKit } from "@copilotkit/react-core/v2";
   * <CopilotKit />;
   * ```
   * See https://docs.copilotkit.ai/reference/v2/components/CopilotKit
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  CopilotKit,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  defaultCopilotContextCategories,
} from "./components/copilot-provider/copilotkit";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `CopilotKitProps` from `@copilotkit/react-core/v2` instead.
   * Import and usage example:
   * ```ts
   * import type { CopilotKitProps } from "@copilotkit/react-core/v2";
   * type V2CopilotKitProps = CopilotKitProps;
   * ```
   * See https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotKitProps,
} from "./components/copilot-provider/copilotkit-props";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  CoAgentStateRendersContext,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CoAgentStateRendersContextValue,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  CoAgentStateRendersProvider,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useCoAgentStateRenders,
} from "./context/coagent-state-renders-context";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CoagentInChatRenderFunction,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotApiConfig,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  CopilotContext,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotContextParams,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useCopilotContext,
} from "./context/copilot-context";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  CopilotMessagesContext,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotMessagesContextParams,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useCopilotMessagesContext,
} from "./context/copilot-messages-context";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ThreadsContext,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ThreadsContextValue,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  ThreadsProvider,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ThreadsProviderProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `useThreads` from `@copilotkit/react-core/v2` instead.
   * Import and usage example:
   * ```ts
   * import { useThreads } from "@copilotkit/react-core/v2";
   * useThreads({});
   * ```
   * See https://docs.copilotkit.ai/reference/v2/hooks/useThreads
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useThreads,
} from "./context/threads-context";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type HintFunction,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `useAgent` from `@copilotkit/react-core/v2` instead.
   * Import and usage example:
   * ```ts
   * import { useAgent } from "@copilotkit/react-core/v2";
   * useAgent({});
   * ```
   * See https://docs.copilotkit.ai/reference/v2/hooks/useAgent
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useCoAgent,
} from "./hooks/use-coagent";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `useAgent` from `@copilotkit/react-core/v2` instead.
   * Import and usage example:
   * ```ts
   * import { useAgent, UseAgentUpdate } from "@copilotkit/react-core/v2";
   * function AgentStateView() {
   *   const { agent } = useAgent({
   *     agentId: "basic_agent",
   *     updates: [UseAgentUpdate.OnStateChanged, UseAgentUpdate.OnRunStatusChanged],
   *   });
   *   const state = agent.state;
   *   return (
   *     <YourComponent
   *       agentStateProperty={state.agent_state_property}
   *       isRunning={agent.isRunning}
   *     />
   *   );
   * }
   * ```
   * See https://docs.copilotkit.ai/langgraph-python/generative-ui/state-rendering
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useCoAgentStateRender,
} from "./hooks/use-coagent-state-render";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `useFrontendTool` from `@copilotkit/react-core/v2` instead.
   * Import and usage example:
   * ```ts
   * import { useFrontendTool } from "@copilotkit/react-core/v2";
   * useFrontendTool({});
   * ```
   * See https://docs.copilotkit.ai/reference/v2/hooks/useFrontendTool
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useCopilotAction,
} from "./hooks/use-copilot-action";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `useAgentContext` from `@copilotkit/react-core/v2` instead.
   * Import and usage example:
   * ```ts
   * import { useAgentContext } from "@copilotkit/react-core/v2";
   * useAgentContext({});
   * ```
   * See https://docs.copilotkit.ai/reference/v2/hooks/useAgentContext
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useCopilotAdditionalInstructions,
} from "./hooks/use-copilot-additional-instructions";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useCopilotAuthenticatedAction_c,
} from "./hooks/use-copilot-authenticated-action";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `useAgent` from `@copilotkit/react-core/v2` instead.
   * Import and usage example:
   * ```ts
   * import { useAgent } from "@copilotkit/react-core/v2";
   * useAgent({});
   * ```
   * See https://docs.copilotkit.ai/reference/v2/hooks/useAgent
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useCopilotChat,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type UseCopilotChatReturn,
} from "./hooks/use-copilot-chat";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ChatSuggestions,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type OnReloadMessages,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type OnStopGeneration,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useCopilotChatInternal,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type UseCopilotChatOptions,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type UseCopilotChatOptions as UseCopilotChatOptions_c,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type UseCopilotChatReturn as UseCopilotChatReturn_c,
} from "./hooks/use-copilot-chat_internal";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useCopilotChatHeadless_c,
} from "./hooks/use-copilot-chat-headless_c";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `useConfigureSuggestions` from `@copilotkit/react-core/v2` instead.
   * Import and usage example:
   * ```ts
   * import { useConfigureSuggestions } from "@copilotkit/react-core/v2";
   * function Suggestions() {
   *   useConfigureSuggestions({
   *     suggestions: [
   *       { title: "Help", message: "Help me get started" },
   *     ],
   *   });
   *   return null;
   * }
   * ```
   * See https://docs.copilotkit.ai/reference/v2/hooks/useConfigureSuggestions
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useCopilotChatSuggestions,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type UseCopilotChatSuggestionsConfiguration,
} from "./hooks/use-copilot-chat-suggestions";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `useAgentContext` from `@copilotkit/react-core/v2` instead.
   * Import and usage example:
   * ```ts
   * import { useAgentContext } from "@copilotkit/react-core/v2";
   * function UserContext() {
   *   useAgentContext({
   *     description: "The current user",
   *     value: { name: "Ada" },
   *   });
   *   return null;
   * }
   * ```
   * See https://docs.copilotkit.ai/reference/v2/hooks/useAgentContext
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useCopilotReadable,
} from "./hooks/use-copilot-readable";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useCopilotRuntimeClient,
} from "./hooks/use-copilot-runtime-client";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `useDefaultRenderTool` from `@copilotkit/react-core/v2` instead.
   * Import and usage example:
   * ```ts
   * import { useDefaultRenderTool } from "@copilotkit/react-core/v2";
   * useDefaultRenderTool({});
   * ```
   * See https://docs.copilotkit.ai/reference/v2/hooks/useDefaultRenderTool
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useDefaultTool,
} from "./hooks/use-default-tool";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `useFrontendTool` from `@copilotkit/react-core/v2` instead.
   * Import and usage example:
   * ```ts
   * import { useFrontendTool } from "@copilotkit/react-core/v2";
   * import { z } from "zod";
   * function MyComponent() {
   *   useFrontendTool({
   *     name: "myTool",
   *     description: "Run my tool",
   *     parameters: z.object({}),
   *     handler: async () => "done",
   *   });
   *   return null;
   * }
   * ```
   * See https://docs.copilotkit.ai/reference/v2/hooks/useFrontendTool
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useFrontendTool,
} from "./hooks/use-frontend-tool";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `useHumanInTheLoop` from `@copilotkit/react-core/v2` instead.
   * Import and usage example:
   * ```ts
   * import { useHumanInTheLoop } from "@copilotkit/react-core/v2";
   * import { z } from "zod";
   * function Confirmation() {
   *   useHumanInTheLoop({
   *     name: "confirmAction",
   *     description: "Ask the user to confirm",
   *     parameters: z.object({}),
   *     render: ({ respond }) => (
   *       <button onClick={() => respond?.(true)}>Confirm</button>
   *     ),
   *   });
   *   return null;
   * }
   * ```
   * See https://docs.copilotkit.ai/reference/v2/hooks/useHumanInTheLoop
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useHumanInTheLoop,
} from "./hooks/use-human-in-the-loop";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `useInterrupt` from `@copilotkit/react-core/v2` instead.
   * Import and usage example:
   * ```ts
   * import { useInterrupt } from "@copilotkit/react-core/v2";
   * function ApprovalInterrupt() {
   *   useInterrupt({
   *     render: ({ resolve }) => (
   *       <button onClick={() => resolve({ approved: true })}>Approve</button>
   *     ),
   *   });
   *   return null;
   * }
   * ```
   * See https://docs.copilotkit.ai/reference/v2/hooks/useInterrupt
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useLangGraphInterrupt,
} from "./hooks/use-langgraph-interrupt";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useLazyToolRenderer,
} from "./hooks/use-lazy-tool-renderer";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useMakeCopilotDocumentReadable,
} from "./hooks/use-make-copilot-document-readable";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * Use `useRenderTool` from `@copilotkit/react-core/v2` instead.
   * Import and usage example:
   * ```ts
   * import { useRenderTool } from "@copilotkit/react-core/v2";
   * import { z } from "zod";
   * function StatusTool() {
   *   useRenderTool({
   *     name: "showStatus",
   *     parameters: z.object({}),
   *     render: ({ status, result }) => (
   *       <div>{status === "complete" ? result : "Running..."}</div>
   *     ),
   *   });
   *   return null;
   * }
   * ```
   * See https://docs.copilotkit.ai/reference/v2/hooks/useRenderTool
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  useRenderToolCall,
} from "./hooks/use-render-tool-call";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type Tree,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type TreeNode,
} from "./hooks/use-tree";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  CopilotTask,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotTaskConfig,
} from "./lib/copilot-task";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CopilotChatSuggestionConfiguration,
} from "./types/chat-suggestion-configuration";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CrewsAgentState,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CrewsResponse,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CrewsResponseStatus,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CrewsStateItem,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CrewsTaskStateItem,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CrewsToolStateItem,
} from "./types/crew";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type DocumentPointer,
} from "./types/document-pointer";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ActionRenderProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ActionRenderPropsNoArgs,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ActionRenderPropsNoArgsWait,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type ActionRenderPropsWait,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CatchAllActionRenderProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type CatchAllFrontendAction,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type FrontendAction,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type FrontendActionAvailability,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type RenderFunctionStatus,
} from "./types/frontend-action";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type LangGraphInterruptAction,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type LangGraphInterruptActionSetter,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type LangGraphInterruptActionSetterArgs,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type LangGraphInterruptRender,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type LangGraphInterruptRenderHandlerProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type LangGraphInterruptRenderProps,
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type QueuedInterruptEvent,
} from "./types/interrupt-action";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  type SystemMessageFunction,
} from "./types/system-message";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  shouldShowDevConsole,
} from "./utils/dev-console";

export {
  /**
   * @deprecated Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.
   * No 1:1 v2 replacement is available.
   * Start with `@copilotkit/react-core/v2` and the v2 reference: https://docs.copilotkit.ai/reference/v2
   * Migration guide: https://docs.copilotkit.ai/migrate/v2
   */
  SUGGESTION_RETRY_CONFIG,
} from "./utils/suggestions-constants";

/* END GENERATED V1 DEPRECATED EXPORTS. USE V2 INSTEAD. */
