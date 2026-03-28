"use client";

import "./index.css";

// Re-export core (still a separate package)
export * from "@copilotkit/core";

// Re-export AG-UI client types (was done by V2 react's index.ts)
export * from "@ag-ui/client";

// Local V2 react code (absorbed into @copilotkit/react-core)
export * from "./components";
export * from "./hooks";
export * from "./providers";
export * from "./types";
export * from "./lib/react-core";
export { createA2UIMessageRenderer } from "./a2ui/A2UIMessageRenderer";
export type { A2UIMessageRendererOptions } from "./a2ui/A2UIMessageRenderer";
export type { Theme as A2UITheme } from "@copilotkit/a2ui-renderer";

// V1 backward-compat re-exports
export { CopilotKit } from "../components/copilot-provider/copilotkit";
export type { CopilotKitProps } from "../components/copilot-provider/copilotkit-props";
