export type A2UITheme = Record<string, unknown>;

export interface A2UISurfaceOperationPayload {
  operations: unknown[];
}

export { a2uiDefaultTheme } from "./vue-renderer/theme/ThemeContext";
