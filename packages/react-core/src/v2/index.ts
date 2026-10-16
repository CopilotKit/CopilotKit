"use client";

import "./index.css";

// Re-export @copilotkit/core and @ag-ui/client. The names are listed one by one
// in a generated file rather than starred in here, because this module is a
// "use client" boundary and a bundler has to be able to enumerate its exports.
// A star re-export of an external package survives into the build and makes
// Next.js reject the module, which is what stops the provider being imported
// straight into a server component. Regenerate with:
//   pnpm --filter @copilotkit/react-core generate:external-reexports
export * from "./external-reexports";

// Local V2 react code (absorbed into @copilotkit/react-core)
export * from "./components";
export * from "./hooks";
export * from "./providers";
export * from "./types";
export * from "./lib/react-core";
export { createA2UIMessageRenderer } from "./a2ui/A2UIMessageRenderer";
export type {
  A2UIMessageRendererOptions,
  A2UIUserAction,
  A2UIActionInterceptor,
} from "./a2ui/A2UIMessageRenderer";
export type { A2UIRecoveryRendererOptions } from "./a2ui/A2UIRecoveryStates";
export type { Theme as A2UITheme } from "@copilotkit/a2ui-renderer";
export { defaultTheme as a2uiDefaultTheme } from "@copilotkit/a2ui-renderer";

// V1 backward-compat re-exports
export { CopilotKit } from "../v1-deprecated/components/copilot-provider/copilotkit";
export type { CopilotKitProps } from "../v1-deprecated/components/copilot-provider/copilotkit-props";
