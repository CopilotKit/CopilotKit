// The `@copilotkit/vue/v2/generative-ui` entry. It mirrors the
// `@copilotkit/react-core/v2/generative-ui` export list, plus the Vue-only
// types for emits, slots and the error fallback. Every export is named.
// The chart and map plugins have their own entries (`/chart`, `/map`).
export { createGenerativeUI } from "./catalog";
export type {
  CreateGenerativeUIConfig,
  GenerativeUI,
  GenerativeUIComponentDefinition,
  GenerativeUIComponentEmits,
  GenerativeUIComponentName,
  GenerativeUIComponentProps,
  GenerativeUIComponentSlots,
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
  GenerativeUIErrorFallbackProps,
  GenerativeUIMarkdownConfig,
  GenerativeUITheme,
  GenerativeUIToolConfig,
} from "./runtime-context";
export type {
  GenerativeUIThemeValues,
  GenerativeUIThemeVariable,
  GenerativeUIThemeVariables,
} from "@copilotkit/shared/generative-ui";
export { default as GenerativeUISurface } from "./GenerativeUISurface.vue";
export type { GenerativeUISurfaceProps } from "./GenerativeUISurface.vue";
export { default as DefaultGenerativeUIChatCard } from "./DefaultGenerativeUIChatCard.vue";
export type {
  GenerativeUIChatSurfaceProps,
  GenerativeUIChatSurfaceSlotProps,
} from "./chat";
export { default as MarkdownSurfaces } from "./markdown/MarkdownSurfaces.vue";
export type { MarkdownSurfacesProps } from "./markdown/MarkdownSurfaces.vue";
export { useGenerativeUIRuntime } from "./runtime-context";
export { useGenerativeUIFunction, useGenerativeUIState } from "./hooks";
export { standardUI } from "./standard";
