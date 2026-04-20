/**
 * Headless (platform-agnostic) exports from @copilotkit/react-core/v2.
 *
 * No CSS, no web UI components, no DOM dependencies.
 * Used by @copilotkit/react-native.
 */

// Re-export from context (which is external in this build) so the .d.ts
// references the same type declaration. This avoids a nominal type mismatch
// caused by private class members being declared in two separate .d.ts files.
export { CopilotKitCoreReact } from "./context";
export type { CopilotKitCoreReactConfig } from "./context";

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
