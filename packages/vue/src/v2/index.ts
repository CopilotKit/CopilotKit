// Re-export core (framework-agnostic)
export * from "@copilotkit/core";
export * from "@ag-ui/client";
// AG-UI 1.0 moved the zod validators from `@ag-ui/client` to this subpath.
// Re-export them so existing imports keep working. Both modules export
// PROTOCOL_VERSION, so name it once to keep it from being ambiguous.
export * from "@ag-ui/core/schemas";
export { PROTOCOL_VERSION } from "@ag-ui/client";

// Local V2 vue code
export * from "./components";
export * from "./hooks";
export * from "./providers";
export { CopilotKitStyles } from "./styles/CopilotKitStyles";
export * from "./types";
export * from "./lib/vue-core";
export * from "./lib/processPartialHtml";
