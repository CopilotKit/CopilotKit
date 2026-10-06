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
// Explicit re-export so the default A2UI catalog is reachable as a public
// named export. Vue users need a catalog to pass to `a2ui.catalog` for the
// catalog-on-provider path; the nested `export *` barrel above gets
// tree-shaken by the library build, so surface it directly here.
export { vueBasicCatalog } from "./components/a2ui/catalog";
export * from "./hooks";
export * from "./providers";
export * from "./types";
export * from "./lib/vue-core";
export * from "./lib/processPartialHtml";
