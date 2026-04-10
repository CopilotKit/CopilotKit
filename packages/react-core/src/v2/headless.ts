/**
 * Headless (platform-agnostic) exports from @copilotkit/react-core/v2.
 *
 * No CSS, no web UI components, no DOM dependencies.
 * Used by @copilotkit/react-native.
 *
 * IMPORTANT: This file imports context from the package path (not relative)
 * so that the bundled output keeps it as an external import. This ensures
 * the headless bundle shares the same React context instance as the
 * CopilotKitProvider (which also imports from v2/context).
 */

// Re-export context from the package path so it stays external
export {
  CopilotKitContext,
  useCopilotKit,
  EMPTY_SET,
  type CopilotKitContextValue,
} from "@copilotkit/react-core/v2/context";

export { CopilotKitCoreReact } from "./lib/react-core";
export type { CopilotKitCoreReactConfig } from "./lib/react-core";

// Chat configuration provider (no UI, just context)
export {
  CopilotChatConfigurationProvider,
  useCopilotChatConfiguration,
  CopilotChatDefaultLabels,
  type CopilotChatLabels,
  type CopilotChatConfigurationValue,
  type CopilotChatConfigurationProviderProps,
} from "./providers/CopilotChatConfigurationProvider";

// Platform-agnostic hooks
export { useAgent, type UseAgentUpdate } from "./hooks/use-agent";
export { useFrontendTool } from "./hooks/use-frontend-tool";
export { useHumanInTheLoop } from "./hooks/use-human-in-the-loop";
export { useInterrupt, type UseInterruptConfig } from "./hooks/use-interrupt";
export { useSuggestions } from "./hooks/use-suggestions";
export { useConfigureSuggestions } from "./hooks/use-configure-suggestions";
export {
  useAgentContext,
  type AgentContextInput,
  type JsonSerializable,
} from "./hooks/use-agent-context";
export {
  useThreads,
  type Thread,
  type UseThreadsInput,
  type UseThreadsResult,
} from "./hooks/use-threads";
