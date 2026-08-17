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
  // Runtime enum, not a type: it is passed BY VALUE to useAgent's `updates`
  // option (`updates: [UseAgentUpdate.OnMessagesChanged]`). `export type` would
  // strip the runtime binding and leave consumers unable to name a member.
  // react-core's own headless entry exports it as a value for the same reason.
  UseAgentUpdate,
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

// Re-export core runtime ENUMS as values. Each of these is `export enum` in
// @copilotkit/core, and each is the type of a prop or field a consumer has to
// branch on — `status === ToolCallStatus.Executing`,
// `status === CopilotKitCoreRuntimeConnectionStatus.Connected`. An enum-typed
// field rejects a bare string literal, so a type-only re-export leaves the
// member names unreachable and the field impossible to compare against.
export {
  ToolCallStatus,
  CopilotKitCoreRuntimeConnectionStatus,
  CopilotKitCoreErrorCode,
} from "@copilotkit/core";

// Re-export core types commonly needed
export type { Suggestion, FrontendTool } from "@copilotkit/core";

// AbstractAgent is a runtime CLASS, not a type: it is the AG-UI extension point
// consumers subclass (`class MyAgent extends AbstractAgent`) and test with
// `instanceof`. @ag-ui/client is a dependency of this package rather than a peer,
// so a consumer cannot reliably import the class from there directly — a
// type-only re-export left the extension point unreachable from RN.
export { AbstractAgent } from "@ag-ui/client";

// Re-export AG-UI types for consumer convenience (matches web SDK surface)
export type {
  Message,
  AssistantMessage as AssistantMessageType,
  ToolCall,
  ToolMessage,
  AgentCapabilities,
} from "@ag-ui/client";

// Render tool registration. React Native has ZERO render-tool API of its own:
// this IS react-core's hook, re-exported unchanged, and its companion
// `useFrontendTool` is re-exported with the other platform-agnostic hooks above.
//
// The two are NOT interchangeable, which is why RN no longer stands between a
// consumer and either of them:
//
//   • `useFrontendTool` registers a TOOL *and* its renderer. The tool is
//     advertised to the model on every run and the model may call it, so it
//     needs a `description` and a handler (or HITL) to be worth offering.
//   • `useRenderTool` registers a RENDERER ONLY. Nothing is advertised and
//     nothing becomes callable; it supplies UI for a tool call somebody else
//     owns — a server-side tool, or, with `name: "*"`, every tool call that has
//     no renderer of its own.
//
// RN used to export a LOCAL `useRenderTool` whose whole body forwarded to
// `useFrontendTool` — core's other hook, wearing this one's name. The visible
// cost was `name: "*"`: it registered a frontend tool literally called `*`,
// with no description and no schema, and offered it to the model. Do not
// reintroduce a local hook under either name; the identity of this re-export is
// asserted in src/__tests__/headless-entry-surface.test.ts.
export { useRenderTool } from "@copilotkit/react-core/v2/headless";
export type { RenderToolProps } from "@copilotkit/react-core/v2/headless";

// Render tool consumption. react-core's hook is platform-agnostic — it pulls no
// DOM and no chat-UI stack, and it returns ReactElement | null, which is exactly
// what FlatList's renderItem requires. Use it to render a registered component
// on any surface, chat or not.
export { useRenderToolCall } from "@copilotkit/react-core/v2/headless";
export type { ReactToolCallRenderer } from "@copilotkit/react-core/v2/headless";
