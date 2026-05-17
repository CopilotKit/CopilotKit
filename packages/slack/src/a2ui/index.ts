export type {
  Catalog,
  CatalogComponentDefinition,
  CatalogDefinitions,
  CatalogRenderers,
  ComponentRenderer,
  RendererProps,
  PropsOf,
  ActionPayload,
  EncodedAction,
} from "./types.js";
export { createCatalog } from "./create-catalog.js";
export type { CreateCatalogOptions } from "./create-catalog.js";
export type {
  A2UIComponent,
  A2UIOperation,
  SurfaceState,
} from "./surface-state.js";
export { applyA2UIOperations } from "./surface-state.js";
export { renderA2UISurface } from "./render.js";
export {
  createA2UIActivityRenderer,
  A2UI_ACTIVITY_TYPE,
} from "./activity-renderer.js";
export type {
  A2UIActivityContent,
  CreateA2UIActivityRendererOptions,
} from "./activity-renderer.js";
