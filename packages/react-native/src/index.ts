/**
 * @copilotkit/react-native
 *
 * React Native bindings for CopilotKit. Provides a lightweight provider
 * and re-exports platform-agnostic hooks from @copilotkit/react-core.
 *
 * Quick start:
 * ```tsx
 * // In your app entry (index.js), BEFORE other imports:
 * import "@copilotkit/react-native/polyfills";
 *
 * // In your app:
 * import { CopilotKitProvider, useAgent, useCopilotKit } from "@copilotkit/react-native";
 * ```
 */

// React Native provider (no web dependencies)
export { CopilotKitProvider } from "./CopilotKitProvider";
export type { CopilotKitNativeProviderProps } from "./CopilotKitProvider";

// Streaming fetch installer
export { installStreamingFetch } from "./streaming-fetch";

// Re-export context and hooks from react-core (platform-agnostic)
export {
  useCopilotKit,
  CopilotKitContext,
  type CopilotKitContextValue,
} from "@copilotkit/react-core/v2/context";

// Re-export hooks that work without web deps
// These consume the CopilotKitContext which our provider sets
export {
  useAgent,
  useFrontendTool,
  useHumanInTheLoop,
  useInterrupt,
  useSuggestions,
  useConfigureSuggestions,
  useAgentContext,
  useThreads,
  type UseAgentUpdate,
} from "@copilotkit/react-core/v2";

// Re-export core types commonly needed
export { type CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/core";
