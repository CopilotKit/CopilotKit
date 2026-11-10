// The `@copilotkit/react-core/generative-ui/native` entry: generative UI
// without the DOM. It has the catalog API, the hooks and the surface
// renderer, and leaves out what only a browser can run: the standard
// catalog (DOM components, portals, KaTeX), the markdown surfaces
// (streamdown) and the DOM `<GenerativeUISurface>` mount. A platform gives
// its host elements through `GenerativeUIHostContext`. That context defaults
// to the DOM host, which renders HTML elements, so a platform
// without a DOM MUST provide its own host above every surface it renders.
// Nothing checks that it did: without one, on React Native, the `<div>` of
// the surface root fails to render, the surface fallback (a `<div>` too)
// fails as well, and the surface renders nothing; only the reported errors
// show it. `@copilotkit/react-native/generative-ui` is built on this entry,
// and its `GenerativeUIProvider` provides the native host.
//
// It is built together with the root entry and `/generative-ui`, so the three
// entries share one copy of each React context.

// The catalog API, as in `/generative-ui`.
export { createGenerativeUI } from "./catalog";
export type {
  CreateGenerativeUIConfig,
  GenerativeUI,
  GenerativeUIComponentDefinition,
  GenerativeUIComponentName,
  GenerativeUIComponentProps,
  GenerativeUIEventDefinition,
  GenerativeUIFunctionArgs,
  GenerativeUIFunctionDefinition,
  GenerativeUIFunctionInput,
  GenerativeUIFunctionName,
  GenerativeUISlotKind,
  GenerativeUIStateOf,
} from "./catalog";
export { child, childList } from "./refs";
export { exportA2UICatalog } from "@copilotkit/shared/generative-ui";
export type { ExportA2UICatalogOptions } from "@copilotkit/shared/generative-ui";
export { useGenerativeUIAccessibility } from "./accessibility";
export type {
  GenerativeUIAccessibility,
  GenerativeUIAriaAttributes,
} from "./accessibility";
export { GenerativeUIError } from "@copilotkit/shared/generative-ui";
export type {
  GenerativeUIErrorCode,
  GenerativeUIErrorInfo,
  GenerativeUIEventHandler,
  GenerativeUIInvokeResult,
} from "@copilotkit/shared/generative-ui";
export type {
  GenerativeUIConfig,
  GenerativeUIErrorBoundaryConfig,
  GenerativeUIMarkdownConfig,
  GenerativeUITheme,
  GenerativeUIToolConfig,
} from "./runtime-context";
export { useGenerativeUIRuntime } from "./runtime-context";
export { useGenerativeUIFunction, useGenerativeUIState } from "./hooks";

// The plumbing that a platform package uses to build its provider and
// surfaces.
import { useGenerativeUIRoot as useGenerativeUIRootImpl } from "./use-generative-ui-root";
import type { CopilotKitCoreReact } from "../context";
import type {
  GenerativeUIConfig,
  GenerativeUIRuntime,
} from "./runtime-context";
/**
 * Provider-side wiring: the surface manager, the agent subscriptions and the
 * envelope of each run. Typed with the `CopilotKitCoreReact` of
 * `/context`, which is the instance a React Native provider holds.
 *
 * In source it is the same class that `use-generative-ui-root.ts` imports
 * from `../lib/react-core`, so no cast is needed. The annotation is for the
 * emitted declarations: `../context` is external to the build, so they import
 * the class from `@copilotkit/react-core/context`. Re-exported as is, the
 * hook would be declared with a copy of the class from a bundled chunk, which
 * the `/context` instance is not assignable to (the class has private
 * members). `scripts/assert-dist-context-types.mjs` checks this.
 */
export const useGenerativeUIRoot: (
  copilotkit: CopilotKitCoreReact,
  config: GenerativeUIConfig | undefined,
) => GenerativeUIRuntime | null = useGenerativeUIRootImpl;
export {
  GenerativeUIRuntimeContext,
  useRequiredGenerativeUIRuntime,
} from "./runtime-context";
export type { GenerativeUIRuntime } from "./runtime-context";
export { useManagerVersion } from "./hooks";
export { SurfaceView } from "./SurfaceView";
export { GenerativeUIToolCallRenderer } from "./chat";
export {
  GenerativeUISurfaceContentSchema,
  parseGenerativeUISurfaceContent,
  useGenerativeUIActivitySurface,
  useGenerativeUIRejected,
} from "./activity";
export type { ParsedGenerativeUISurfaceContent } from "./activity";
export type { GenerativeUIChatSurfaceProps } from "./chat";
export { GenerativeUIHostContext, useGenerativeUIHost } from "./host";
export type {
  GenerativeUIAccessibilityWrapperProps,
  GenerativeUIHost,
  GenerativeUINodeFallbackProps,
  GenerativeUISurfaceRootProps,
} from "./host";
