export { basicCatalog } from "./lib/basic/catalog";
export { CopilotA2UICatalog } from "./lib/catalog";
export { CopilotA2UIChild } from "./lib/child";
export {
  A2UI_COMPONENT_CONTEXT,
  injectA2UIComponentContext,
  type A2UIComponentContext,
} from "./lib/component-context";
export {
  createAngularCatalog,
  type CreateAngularCatalogOptions,
} from "./lib/create-catalog";
export { CopilotA2UISurface } from "./lib/surface";
export type {
  A2UICatalogDefinitions,
  A2UIChildRef,
  A2UIComponentDefinition,
  A2UIProps,
  A2UIWebComponent,
  CopilotA2UICatalogEntry,
  CopilotA2UIComponentImplementation,
} from "./lib/types";
export type {
  A2uiWebComponentElement,
  WebComponentImplementation,
} from "./lib/universal";
export {
  ActionSchema,
  ChildListSchema,
  DynamicBooleanSchema,
  DynamicNumberSchema,
  DynamicStringSchema,
} from "@a2ui/web_core/v0_9";
