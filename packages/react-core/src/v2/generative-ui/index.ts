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
export type {
  GenerativeUIThemeValues,
  GenerativeUIThemeVariable,
  GenerativeUIThemeVariables,
} from "@copilotkit/shared/generative-ui";
export { GenerativeUISurface } from "./GenerativeUISurface";
export type { GenerativeUISurfaceProps } from "./GenerativeUISurface";
export { DefaultGenerativeUIChatCard } from "./chat";
export type { GenerativeUIChatSurfaceProps } from "./chat";
export { MarkdownSurfaces } from "./markdown/MarkdownSurfaces";
export type { MarkdownSurfacesProps } from "./markdown/MarkdownSurfaces";
export { useGenerativeUIRuntime } from "./runtime-context";
export { useGenerativeUIFunction, useGenerativeUIState } from "./hooks";
export { standardUI } from "./standard";
