/**
 * @copilotkit/react-native/generative-ui
 *
 * Experimental. Generative UI on React Native: the agent renders the
 * components of your catalog (`createGenerativeUI`) with the `render_ui`
 * tool, and the runtime validates each operation before it streams it to the
 * app. The same catalog API as `@copilotkit/react-core/generative-ui`,
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
 * `child()` and `childList()` return zod 4 schemas, so write a catalog that
 * uses them with zod 4.
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
} from "@copilotkit/react-core/generative-ui/native";
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
} from "@copilotkit/react-core/generative-ui/native";
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
