"use client";

// The `@copilotkit/react-core/v2/generative-ui` entry. It is a "use client"
// module like the `/v2` entry, so every export is named.
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
export { exportA2UICatalog } from "./catalog-export";
export type { ExportA2UICatalogOptions } from "./catalog-export";
export { useGenerativeUIAccessibility } from "./accessibility";
export type {
  GenerativeUIAccessibility,
  GenerativeUIAriaAttributes,
} from "./accessibility";
export { GenerativeUIError } from "./errors";
export type {
  GenerativeUIErrorCode,
  GenerativeUIErrorInfo,
  GenerativeUIEventHandler,
  GenerativeUIInvokeResult,
} from "./errors";
export type {
  GenerativeUIConfig,
  GenerativeUIErrorBoundaryConfig,
  GenerativeUIMarkdownConfig,
  GenerativeUITheme,
  GenerativeUIToolConfig,
} from "./runtime-context";
export type {
  GenerativeUIThemeValues,
  GenerativeUIThemeVariable,
  GenerativeUIThemeVariables,
} from "./theme";
export { GenerativeUISurface } from "./GenerativeUISurface";
export type { GenerativeUISurfaceProps } from "./GenerativeUISurface";
export { DefaultGenerativeUIChatCard } from "./chat";
export type { GenerativeUIChatSurfaceProps } from "./chat";
export { MarkdownSurfaces } from "./markdown/MarkdownSurfaces";
export type { MarkdownSurfacesProps } from "./markdown/MarkdownSurfaces";
export { useGenerativeUIRuntime } from "./runtime-context";
export { useGenerativeUIFunction, useGenerativeUIState } from "./hooks";
export { standardUI } from "./standard";
