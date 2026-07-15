export { createVueComponent, createBinderlessVueComponent } from "./adapter";
export type {
  VueComponentImplementation,
  VueA2uiComponentProps,
} from "./adapter";
export { A2uiSurface, DeferredChild } from "./A2uiSurface";
export { vueBasicCatalog } from "./catalog/basic";
export {
  ThemeProvider,
  useTheme,
  useThemeOptional,
  a2uiDefaultTheme,
} from "./theme/ThemeContext";
