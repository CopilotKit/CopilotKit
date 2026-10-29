// The `@copilotkit/shared/generative-ui` entry: the framework-free part of
// generative UI. The framework packages (`@copilotkit/react-core`,
// `@copilotkit/angular`) build their generative UI on it. The A2UI protocol
// types stay on the package root, in `./base`.
export * from "./catalog";
export * from "./standard";
export { isRecord } from "./is-record";
