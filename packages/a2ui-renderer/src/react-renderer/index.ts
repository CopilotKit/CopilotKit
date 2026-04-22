// Core components and provider
export {
  A2UIProvider,
  useA2UIActions,
  useA2UIState,
  useA2UIContext,
  useA2UIStore, // @deprecated - use useA2UIContext
  useA2UIStoreSelector, // @deprecated - use useA2UIContext or useA2UI
  useA2UIError,
} from "./core/A2UIProvider";
export type { A2UIProviderProps } from "./core/A2UIProvider";
export { A2UIRenderer } from "./core/A2UIRenderer";
export type { A2UIRendererProps } from "./core/A2UIRenderer";

// Hooks
export { useA2UI } from "./hooks/useA2UI";
export type { UseA2UIResult } from "./hooks/useA2UI";

// Theme
export {
  ThemeProvider,
  useTheme,
  useThemeOptional,
} from "./theme/ThemeContext";

// Utilities
export { cn } from "./lib/utils";

// Catalog utilities
export {
  A2UI_SCHEMA_CONTEXT_DESCRIPTION,
  extendsBasicCatalog,
  getCustomComponentNames,
  buildCatalogContextValue,
  extractCatalogComponentSchemas,
} from "./catalog-utils";
export type { InlineCatalogSchema } from "./catalog-utils";

// Catalog creation — new API (definitions + renderers)
export { createCatalog, extractSchema } from "./create-catalog";
export type {
  CatalogComponentDefinition,
  CatalogDefinitions,
  CatalogRenderers,
  RendererProps,
  ComponentRenderer,
  PropsOf,
} from "./create-catalog";

// Catalog creation — deprecated API (combined definitions + renderers)
export { createA2UICatalog, extractA2UISchema } from "./create-catalog";
export type {
  A2UIComponentDefinition,
  A2UIComponentMap,
} from "./create-catalog";

// Styles
export { injectStyles, removeStyles } from "./styles";

// Types
export type {
  Types,
  Primitives,
  AnyComponentNode,
  Surface,
  SurfaceID,
  Theme,
  ServerToClientMessage,
  A2UIClientEventMessage,
  Action,
  DataValue,
  MessageProcessor,
  StringValue,
  NumberValue,
  BooleanValue,
  A2UIComponentProps,
  ComponentRegistration,
  ComponentLoader,
  OnActionCallback,
  A2UIProviderConfig,
} from "./types";

// Low-level a2ui-react primitives (vendored from @a2ui/react)
export { createReactComponent } from "./a2ui-react/adapter";
export type { ReactComponentImplementation } from "./a2ui-react/adapter";
export { basicCatalog } from "./a2ui-react/catalog/basic";
export { Catalog } from "@a2ui/web_core/v0_9";

// Backward compat: no-op functions for initializeDefaultCatalog
export function registerDefaultCatalog() {
  /* v0.9: catalog is built-in */
}
export function initializeDefaultCatalog() {
  /* v0.9: catalog is built-in */
}

// Backward compat: defaultTheme export (v0.9 themes are handled internally)
export const defaultTheme: Record<string, unknown> = {};
export const litTheme = defaultTheme;
