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
// core + AG-UI types, and the render-tool hooks are re-exported from "./headless"
// above (`export * from "./headless"`).
//
// Deliberately NOT re-exported — these genuinely render host DOM or link the
// web chat-message stack, from @copilotkit/react-core/v2 (the fat entry):
//   useDefaultRenderTool  — DefaultToolCallRenderer uses <div>, <svg>, etc.
//   useRenderCustomMessages / useRenderActivityMessage — link @copilotkit/a2ui-renderer
//
// NOTE: useRenderToolCall is NOT in this list. It was excluded until 2026-07-23
// on the stated grounds that it "depends on DOM via DefaultToolCallRenderer" —
// which was never true of the hook itself; it was only reachable through the fat
// /v2 entry, whose weight is the real hazard (#4893). PR #5883 moved it into
// /v2/headless, and we consume it from there. Never import from bare
// "@copilotkit/react-core/v2" in this package — the import-graph guard in
// src/__tests__/headless-entry-surface.test.ts fails the build if you do.

// Pluggable markdown renderer context
export {
  MarkdownRendererProvider,
  useMarkdownRenderer,
} from "./components/MarkdownRendererContext";
export type {
  NativeMarkdownRenderer,
  NativeMarkdownRendererProps,
} from "./components/MarkdownRendererContext";

// Built-in markdown renderer
export { CopilotMarkdown, defaultMarkdownStyles } from "./components/Markdown";
export type {
  CopilotMarkdownProps,
  MarkdownStyle,
} from "./components/Markdown";
