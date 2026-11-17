import type { CopilotKitProviderProps } from "./CopilotKitProvider.types";

export { default as CopilotKitProvider } from "./CopilotKitProvider.vue";
export type {
  CopilotKitLearningOptions,
  CopilotKitProviderProps,
} from "./CopilotKitProvider.types";

// `CopilotKit` is an alias of `CopilotKitProvider`: the same component under
// its v1 name, so `<CopilotKit>` keeps working. `CopilotKitProvider` is the
// preferred name. A re-export (not `export const CopilotKit = ...`) keeps the
// declaration file from inlining the whole component type.
export { default as CopilotKit } from "./CopilotKitProvider.vue";

/**
 * Alias of {@link CopilotKitProviderProps}, the props of {@link CopilotKit}.
 * Prefer `CopilotKitProviderProps` in new code.
 */
export type CopilotKitProps = CopilotKitProviderProps;

export type { DebugConfig } from "@copilotkit/shared";
export { default as CopilotChatConfigurationProvider } from "./CopilotChatConfigurationProvider.vue";
export type { CopilotChatConfigurationProviderProps } from "./CopilotChatConfigurationProvider.types";
export { useCopilotKit } from "./useCopilotKit";
export { useLicenseContext } from "./useLicenseContext";
export {
  LicenseContextKey,
  createLicenseContextValue,
  createDefaultLicenseRef,
  type LicenseContextValue,
} from "./license-context";
export { useSandboxFunctions } from "./SandboxFunctionsContext";
export { useCopilotChatConfiguration } from "./useCopilotChatConfiguration";
export {
  CopilotChatDefaultLabels,
  type CopilotChatLabels,
  type CopilotChatConfigurationValue,
} from "./types";
export type { CopilotKitContextValue } from "./keys";
export {
  MARKDOWN_RENDERER_KEY,
  isVueComponentRenderer,
  useMarkdownRenderer,
  type DefaultMarkdownRendererProps,
  type MarkdownRendererValue,
} from "./markdown-renderer";
