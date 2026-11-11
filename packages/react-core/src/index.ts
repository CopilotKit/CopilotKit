"use client";

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
export { CopilotKitStyles } from "./styles/copilot-kit-styles";
export * from "./hooks";
export * from "./providers";
export * from "./types";
export * from "./lib/react-core";
