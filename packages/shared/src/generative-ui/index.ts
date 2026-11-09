// The `@copilotkit/shared/generative-ui` entry: the framework-free part of
// generative UI. The generative UI engine of `@copilotkit/core` builds on
// it, and through core so do the framework packages (`@copilotkit/react-core`,
// its React Native entry, and `@copilotkit/angular`). The A2UI protocol
// types stay on the package root, in `./base`.
export * from "./types";
export * from "./validate-operation";
export * from "./render-ui-args";
export * from "./basic-functions";
export * from "./child-refs";
export * from "./prompt";
export { buildCompactGenerativeUISchema } from "./compact-schema";
export * from "./prompt-spec";
export * from "./schema-render";
export * from "./catalog";
export * from "./standard";
export { isRecord } from "./is-record";
export { hasOwnKey } from "./is-record";
export { cloneValue } from "./clone-value";
