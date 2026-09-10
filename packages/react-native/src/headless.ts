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

// Type-only, so both are erased and neither can run before the polyfills above.
import type React from "react";
import type { ReactToolCallRenderer } from "@copilotkit/react-core/v2/headless";

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

// Render tool registration. `useRenderTool` is a TEMPORARY, deprecated
// COMPATIBILITY SHIM over BOTH core hooks — routing rules and reasoning in
// src/hooks/useRenderTool.ts — scheduled for removal in the next minor (tracked
// in CopilotKit/CopilotKit#6976, Linear OSS-1148), after
// which this line goes back to a plain re-export from
// @copilotkit/react-core/v2/headless. Contract and migration notes:
// /reference/react-native/hooks/useRenderTool.
//
// DO NOT reintroduce a LOCAL hook under either name. RN's old `useRenderTool`
// forwarded its whole body to `useFrontendTool` — core's OTHER hook, wearing
// this one's name — so `name: "*"` registered a frontend tool literally called
// `*`. Core never advertised it (`buildFrontendTools` filters that name out),
// but `*` IS core's catch-all handler name: a display-only wildcard therefore
// auto-answered every otherwise-unanswered tool call with an empty tool result
// and asked for a follow-up turn. The shim registers nothing itself: every
// path delegates to a react-core hook, and
// src/__tests__/headless-entry-surface.test.ts fails the build if any module in
// this entry's graph grows a registry of its own.
export { useRenderTool } from "./hooks/useRenderTool";
export type { RenderToolProps } from "@copilotkit/react-core/v2/headless";

// Render tool consumption. react-core's hook is platform-agnostic — it pulls no
// DOM and no chat-UI stack, and it returns ReactElement | null, which is exactly
// what FlatList's renderItem requires. Use it to render a registered component
// on any surface, chat or not.
export { useRenderToolCall } from "@copilotkit/react-core/v2/headless";
export type { ReactToolCallRenderer } from "@copilotkit/react-core/v2/headless";

/**
 * A tool-call render function whose return type is narrowed to React Native's
 * `ReactElement | null`. Annotate a `useFrontendTool` renderer with it to have
 * the compiler reject a return React Native cannot draw.
 *
 * `useFrontendTool`'s `render` is `ReactToolCallRenderer<T>["render"]`, i.e. a
 * `React.ComponentType`, so it returns `ReactNode` — which means
 * `render: ({ args }) => \`Weather in ${args.city}\`` typechecks and then throws
 * *Text strings must be rendered within a `<Text>` component* on a device. This
 * type is what rejects it at `check-types` instead. (core's `useRenderTool`
 * already declares its own `render` as `ReactElement | null`, so the gap is
 * `useFrontendTool`'s.)
 *
 * OPT-IN, and only that. It changes no hook signature: a renderer written
 * inline in a `useFrontendTool` call is still checked against core's
 * `ReactNode`-returning contract, and a bare string still compiles there. This
 * type gives the narrowing back on renderers you annotate; it does not make the
 * package safe.
 *
 * DERIVED from core's canonical `ReactToolCallRenderer` contract rather than
 * declared separately: the props come from it unchanged through
 * `React.ComponentProps`, and only the return type is React Native's. That is
 * deliberate — the last time this package declared its own render-prop shape it
 * drifted from the contract (`{ args: T; status: "executing" | "complete";
 * result?: string }`: no `name`, no `toolCallId`, no in-progress arm, and `args`
 * unconditionally complete). Deriving means a change to the contract changes
 * this type with it, and `check-types` names every renderer that breaks.
 *
 * @typeParam T - The parsed tool arguments; the same `T` as `useFrontendTool`'s.
 *
 * @example
 * ```tsx
 * import { useFrontendTool } from "@copilotkit/react-native/headless";
 * import type { FrontendToolRenderFunction } from "@copilotkit/react-native/headless";
 * import { Text } from "react-native";
 * import { z } from "zod";
 *
 * const renderWeather: FrontendToolRenderFunction<{ city: string }> = ({
 *   args,
 * }) => <Text>{args.city}</Text>;
 *
 * useFrontendTool({
 *   name: "showWeather",
 *   description: "Show the weather",
 *   parameters: z.object({ city: z.string() }),
 *   handler: async ({ city }) => city,
 *   render: renderWeather,
 * });
 * ```
 */
export type FrontendToolRenderFunction<
  T extends Record<string, unknown> = Record<string, unknown>,
> = (
  props: React.ComponentProps<ReactToolCallRenderer<T>["render"]>,
) => React.ReactElement | null;
