/**
 * @copilotkit/react-native
 *
 * React Native bindings for CopilotKit. Provides a lightweight provider
 * and re-exports platform-agnostic hooks from @copilotkit/react-core.
 *
 * Polyfills (DOMException, ReadableStream, TextEncoder, etc.) are
 * auto-imported when this module loads -- no manual
 * `import "@copilotkit/react-native/polyfills"` needed.
 *
 * Quick start:
 * ```tsx
 * import { CopilotKitProvider, useAgent, useCopilotKit } from "@copilotkit/react-native";
 * ```
 */

// Auto-install polyfills so consumers don't need a manual import.
// Must run before any CopilotKit code that relies on ReadableStream / fetch streaming.
import "./polyfills";

// React Native provider (no web dependencies)
export { CopilotKitProvider } from "./CopilotKitProvider";
export type { CopilotKitNativeProviderProps } from "./CopilotKitProvider";

// Provider props alias (mirrors web's CopilotKitProviderProps)
export type { CopilotKitNativeProviderProps as CopilotKitProviderProps } from "./CopilotKitProvider";

// Headless chat components (no DOM, consumer provides UI)
export { CopilotChat, useCopilotChatContext } from "./CopilotChat";
export type { CopilotChatProps, CopilotChatContextValue } from "./CopilotChat";
export { CopilotModal } from "./CopilotModal";
export type { CopilotModalProps } from "./CopilotModal";

// Native attachments hook and types
export { useAttachments } from "./hooks/use-attachments";
export type {
  NativeAttachmentsConfig,
  NativeFileInput,
  UseNativeAttachmentsProps,
  UseNativeAttachmentsReturn,
} from "./hooks/use-attachments";

// Pre-built UI components
export { CopilotSidebar } from "./CopilotSidebar";
export type {
  CopilotSidebarProps,
  CopilotSidebarHandle,
} from "./CopilotSidebar";
export { CopilotPopup } from "./CopilotPopup";
export type { CopilotPopupProps, CopilotPopupHandle } from "./CopilotPopup";

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
  useRenderTool,
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
  type ReactFrontendTool,
  type ReactHumanInTheLoop,
  type RenderToolProps,
  type RenderToolInProgressProps,
  type RenderToolExecutingProps,
  type RenderToolCompleteProps,
} from "@copilotkit/react-core/v2/headless";

// useRenderToolCall — web-specific (depends on DOM elements via DefaultToolCallRenderer)
// useRenderCustomMessages — web-specific (tightly coupled to web chat UI rendering pipeline)
// useRenderActivityMessage — web-specific (tightly coupled to web chat UI rendering pipeline)
// useDefaultRenderTool — web-specific (DefaultToolCallRenderer uses <div>, <svg>, etc.)

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
  AssistantMessage,
  ToolCall,
  ToolMessage,
  AbstractAgent,
  AgentCapabilities,
} from "@ag-ui/client";
