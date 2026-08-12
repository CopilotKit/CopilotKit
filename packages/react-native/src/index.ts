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

// Headless surface: provider + platform-agnostic hooks + core/AG-UI types.
// This also side-effect-imports "./polyfills" (as its first statement), so the
// polyfills install before any chat-UI module below is evaluated. The prebuilt
// chat components + useAttachments are layered on top here; consumers who don't
// need them (and want to skip the @gorhom/bottom-sheet + expo-* native deps)
// can import from "@copilotkit/react-native/headless" instead.
export * from "./headless";

// Prebuilt chat components (import @gorhom/bottom-sheet; not in the
// /headless entry). Consumers who don't need these can import the provider
// and hooks from "@copilotkit/react-native/headless" instead.
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

// The provider, platform-agnostic hooks (useAgent / useFrontendTool / ...),
// core + AG-UI types, and the render-tool registry are re-exported from
// "./headless" above (`export * from "./headless"`).
//
// Deliberately NOT re-exported (web-specific, from @copilotkit/react-core/v2):
//   useRenderToolCall     — depends on DOM elements via DefaultToolCallRenderer
//   useRenderCustomMessages / useRenderActivityMessage — web chat UI pipeline
//   useDefaultRenderTool  — DefaultToolCallRenderer uses <div>, <svg>, etc.
