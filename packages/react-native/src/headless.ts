/**
 * @copilotkit/react-native/headless
 *
 * Lean entry for headless React Native consumers: just the provider and the
 * platform-agnostic agent/tool hooks, with NONE of the prebuilt chat UI.
 *
 * The default barrel (`@copilotkit/react-native`) re-exports the prebuilt chat
 * components (`CopilotChat` / `CopilotModal` / `CopilotSidebar` / `CopilotPopup`,
 * which import `@gorhom/bottom-sheet`) and `useAttachments` (which imports
 * `expo-document-picker` + `expo-file-system`). Those are declared as optional
 * peer dependencies, but a static re-export still forces Metro to resolve them
 * at bundle time — so a consumer that only uses `CopilotKitProvider` + `useAgent`
 * + `useFrontendTool` (a fully custom UI) had to install every chat/attachment
 * native dep or stub them in `metro.config.js`, or the release bundle fails with
 * `Unable to resolve module expo-document-picker`.
 *
 * Import from here to skip that stack entirely:
 * ```tsx
 * import { CopilotKitProvider, useAgent, useFrontendTool } from "@copilotkit/react-native/headless";
 * ```
 *
 * Mirrors `@copilotkit/react-core/v2/headless` (issue #4893 / PR #5883), which
 * this entry builds on. The default barrel re-exports everything here plus the
 * chat UI, so existing imports from `@copilotkit/react-native` are unchanged.
 */

// Auto-install polyfills so consumers don't need a manual import.
// Must run before any CopilotKit code that relies on ReadableStream / fetch streaming.
import "./polyfills";

// React Native provider (no web deps, no bottom-sheet, no expo native modules)
export { CopilotKitProvider } from "./CopilotKitProvider";
export type { CopilotKitNativeProviderProps } from "./CopilotKitProvider";

// Provider props alias (mirrors web's CopilotKitProviderProps)
export type { CopilotKitNativeProviderProps as CopilotKitProviderProps } from "./CopilotKitProvider";

// Re-export context and hooks from react-core (platform-agnostic)
export {
  useCopilotKit,
  useLicenseContext,
  CopilotKitContext,
  type CopilotKitContextValue,
} from "@copilotkit/react-core/v2/context";

// Re-export hooks that work without web deps
// These consume the CopilotKitContext which our provider sets
export {
  useAgent,
  useFrontendTool,
  useComponent,
  useHumanInTheLoop,
  useInterrupt,
  useSuggestions,
  useConfigureSuggestions,
  useAgentContext,
  useThreads,
  useCapabilities,
  defineToolCallRenderer,
  CopilotChatDefaultLabels,
  type UseAgentUpdate,
  type UseInterruptConfig,
  type AgentContextInput,
  type JsonSerializable,
  type Thread,
  type UseThreadsInput,
  type UseThreadsResult,
  type CopilotChatLabels,
  type CopilotChatConfigurationValue,
  type InterruptEvent,
  type InterruptHandlerProps,
  type InterruptRenderProps,
  type Interrupt,
  type ResumeEntry,
  type ResumeStatus,
  type ReactFrontendTool,
  type ReactHumanInTheLoop,
  type RenderToolInProgressProps,
  type RenderToolExecutingProps,
  type RenderToolCompleteProps,
} from "@copilotkit/react-core/v2/headless";

// Re-export core types commonly needed
export type {
  CopilotKitCoreRuntimeConnectionStatus,
  CopilotKitCoreErrorCode,
  Suggestion,
  FrontendTool,
  ToolCallStatus,
} from "@copilotkit/core";

// Re-export AG-UI types for consumer convenience (matches web SDK surface)
export type {
  Message,
  AssistantMessage as AssistantMessageType,
  ToolCall,
  ToolMessage,
  AbstractAgent,
  AgentCapabilities,
} from "@ag-ui/client";

// Render tool hook (React Native version with render registry integration).
// No DOM and no chat-UI stack: the app supplies the renderers.
export { useRenderTool } from "./hooks/useRenderTool";
export type { UseRenderToolOptions } from "./hooks/useRenderTool";
export {
  RenderToolProvider,
  useRenderToolRegistry,
} from "./hooks/RenderToolContext";
export type { RenderToolProps } from "./hooks/RenderToolContext";
