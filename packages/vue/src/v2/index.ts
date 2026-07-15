// Re-export core (framework-agnostic)
export * from "@copilotkit/core";
export * from "@ag-ui/client";

// Local V2 vue code
export * from "./components";
// Explicit re-export so the default A2UI catalog is reachable as a public
// named export. Vue users need a catalog to pass to `a2ui.catalog` for the
// catalog-on-provider path; the nested `export *` barrel above gets
// tree-shaken by the library build, so surface it directly here.
export { vueBasicCatalog } from "./a2ui/vue-renderer/catalog/basic";
export * from "./hooks";
export * from "./providers";
export * from "./types";
export * from "./lib/vue-core";
export * from "./lib/processPartialHtml";
