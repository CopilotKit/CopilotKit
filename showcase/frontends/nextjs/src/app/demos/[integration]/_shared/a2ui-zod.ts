// The zod that A2UI catalog definitions must use.
//
// `@copilotkit/a2ui-renderer` types its catalog API (`CatalogDefinitions`,
// `createCatalog`) against zod 3, and the A2UI binder reads zod 3 schema
// internals at runtime. The app's `zod` package is zod 4, which json-render
// needs, so the app also installs zod 3 as `zod-v3` (npm:zod@3.25.76, the
// version the renderer installs). TypeScript treats packages with the same
// name and version as one, so these schemas match the renderer's types.
// Schemas built with zod 4, or with the `zod/v3` entry of zod 4, do not.
export { z } from "zod-v3";
