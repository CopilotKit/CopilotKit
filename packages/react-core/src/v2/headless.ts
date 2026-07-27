/**
 * Headless (platform-agnostic) exports from @copilotkit/react-core/v2.
 *
 * No CSS and no built-in chat UI components — and, crucially, none of the
 * built-in chat-message rendering stack (Markdown / syntax highlighting via
 * `streamdown` → shiki, plus mermaid, cytoscape and katex). The few browser
 * APIs it touches (e.g. `window.matchMedia`) are feature-detected, so it stays
 * SSR- and React-Native-safe. Because this is a separate build entry, it ships
 * as its own small chunk instead of the monolithic shared chunk the main
 * `@copilotkit/react-core/v2` entry re-exports from — importing any symbol from
 * that entry drags the whole rendering stack into the consumer's bundle with no
 * way to tree-shake it out (issue #4893), adding several MB to a build.
 *
 * Import hooks from here when you build a fully custom chat UI and don't use any
 * of the prebuilt `CopilotChat*` components. Also used by
 * `@copilotkit/react-native`.
 */

// Re-export from context (which is external in this build) so the .d.ts
// references the same type declaration. This avoids a nominal type mismatch
// caused by private class members being declared in two separate .d.ts files.
// The relative "./context" specifier is rewritten to the external package path
// in the emitted declarations by the tsdown `build:done` hook (a relative
// extensionless import is invalid in ESM declarations).
export { CopilotKitCoreReact, useCopilotKit } from "./context";
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

// Platform-agnostic hooks.
// UseAgentUpdate is a runtime enum (passed as a value to useAgent's `updates`
// option), so it must be a value export — `export type` would strip its runtime
// binding from this entry under isolatedModules, breaking consumers.
export { useAgent, UseAgentUpdate } from "./hooks/use-agent";
export { useFrontendTool } from "./hooks/use-frontend-tool";
export { useComponent } from "./hooks/use-component";
export { useHumanInTheLoop } from "./hooks/use-human-in-the-loop";
export {
  useInterrupt,
  type UseInterruptConfig,
  type InterruptEvent,
  type InterruptHandlerProps,
  type InterruptRenderProps,
} from "./hooks/use-interrupt";
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

export {
  useRenderTool,
  type RenderToolProps,
  type RenderToolInProgressProps,
  type RenderToolExecutingProps,
  type RenderToolCompleteProps,
} from "./hooks/use-render-tool";
// Consumption counterpart to useRenderTool: renders a tool call using the app's
// registered renderers. Like useRenderTool it introduces no host DOM of its own
// (the app-supplied renderers do) and pulls no chat-UI rendering stack — unlike
// useDefaultRenderTool (renders web-only <div>/<svg>) or useRenderCustomMessages
// / useRenderActivityMessage (link @copilotkit/a2ui-renderer), which stay in the
// main /v2 entry.
export { useRenderToolCall } from "./hooks/use-render-tool-call";
export { defineToolCallRenderer } from "./types/defineToolCallRenderer";

// Platform-agnostic types
export type { ReactFrontendTool } from "./types/frontend-tool";
export type { ReactHumanInTheLoop } from "./types/human-in-the-loop";
export type { Interrupt, ResumeEntry } from "./types/interrupt";
export type { ResumeStatus } from "@ag-ui/client";

// Platform-agnostic capability introspection
export { useCapabilities } from "./hooks/use-capabilities";
