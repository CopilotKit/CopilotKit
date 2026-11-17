/**
 * @copilotkit/react-native/generative-ui
 *
 * Experimental. Generative UI on React Native: the agent renders the
 * components of your catalog (`createGenerativeUI`) with the `render_ui`
 * tool, and the runtime validates each operation before it streams it to the
 * app. The same catalog API as `@copilotkit/react-core/v2/generative-ui`,
 * with React Native host elements and without the DOM standard catalog.
 *
 * ```tsx
 * import {
 *   GenerativeUIActivity,
 *   GenerativeUIProvider,
 *   createGenerativeUI,
 * } from "@copilotkit/react-native/generative-ui";
 * ```
 *
 * Supported: the tool transport, custom catalogs, state bindings, functions,
 * events, `<GenerativeUIActivity>` and `<GenerativeUISurface>`. Not yet: the
 * markdown transport, the standard catalog and surfaces inside the prebuilt
 * `CopilotChat`. There is no `theme` option (React Native has no CSS
 * variables): `GenerativeUIToolConfig` here is the web config without it.
 *
 * This entry needs `zod` (>=3.25), as every entry of the package does:
 * `@copilotkit/react-core` requires it as a peer and loads it on import, and
 * this entry also loads it through `@copilotkit/core` and
 * `@copilotkit/shared`. It is declared an optional peer of
 * `@copilotkit/react-native`, at `>=3.0.0`, only because making it required
 * or narrowing its range would be a breaking change; install zod `>=3.25`.
 * `child()` and `childList()` return zod 3 schemas, so write a catalog that
 * uses them with zod 3.
 */

// Auto-install polyfills before anything else loads: an app can import this
// entry before the root one, and @copilotkit/core and @ag-ui/client fail at
// load time on Hermes without them (scripts/verify-polyfill-barrel.mjs checks
// that this stays the built entry's first statement).
import "../polyfills";

// The catalog API.
export {
  createGenerativeUI,
  child,
  childList,
  exportA2UICatalog,
  GenerativeUIError,
  useGenerativeUIAccessibility,
  useGenerativeUIFunction,
  useGenerativeUIRuntime,
  useGenerativeUIState,
} from "@copilotkit/react-core/v2/generative-ui/native";
export type {
  CreateGenerativeUIConfig,
  ExportA2UICatalogOptions,
  GenerativeUI,
  GenerativeUIAccessibility,
  GenerativeUIAriaAttributes,
  GenerativeUIComponentDefinition,
  GenerativeUIComponentName,
  GenerativeUIComponentProps,
  GenerativeUIErrorBoundaryConfig,
  GenerativeUIErrorCode,
  GenerativeUIErrorInfo,
  GenerativeUIEventDefinition,
  GenerativeUIEventHandler,
  GenerativeUIFunctionArgs,
  GenerativeUIFunctionDefinition,
  GenerativeUIFunctionInput,
  GenerativeUIFunctionName,
  GenerativeUIAccessibilityWrapperProps,
  GenerativeUIHost,
  GenerativeUIInvokeResult,
  GenerativeUINodeFallbackProps,
  GenerativeUIRuntime,
  GenerativeUISlotKind,
  GenerativeUIStateOf,
  GenerativeUISurfaceRootProps,
} from "@copilotkit/react-core/v2/generative-ui/native";
export type { GenerativeUIRejectedOperation } from "@copilotkit/shared";

// React Native components.
export { GenerativeUIProvider } from "./GenerativeUIProvider";
export type {
  GenerativeUIProviderProps,
  GenerativeUIToolConfig,
} from "./GenerativeUIProvider";
export {
  DefaultGenerativeUIActivityWrapper,
  GenerativeUIActivity,
  isGenerativeUIActivity,
} from "./GenerativeUIActivity";
export type {
  GenerativeUIActivityMessage,
  GenerativeUIActivityProps,
  GenerativeUIActivityWrapperProps,
} from "./GenerativeUIActivity";
export { GenerativeUISurface } from "./GenerativeUISurface";
export type { GenerativeUISurfaceProps } from "./GenerativeUISurface";
export { nativeGenerativeUIHost, NativeNodeFallback } from "./host";
