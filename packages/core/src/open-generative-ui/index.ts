/**
 * Open Generative UI: the sandbox that React, Vue, and Angular share. It runs
 * the HTML, CSS, and JavaScript an agent generates in websandbox iframes.
 *
 * Names without a prefix are public API. Names that start with `ɵ` are
 * internal: the framework packages use them, and they can change in any
 * release.
 */

// Content (public)
export {
  OPEN_GENERATIVE_UI_ACTIVITY_TYPE,
  GENERATE_SANDBOXED_UI_TOOL_NAME,
  DEFAULT_OPEN_GENERATIVE_UI_DESIGN_SKILL,
} from "./content";
export type {
  OpenGenerativeUIContent,
  GenerateSandboxedUiArgs,
} from "./content";

// Partial HTML (internal)
export {
  processPartialHtml as ɵprocessPartialHtml,
  extractCompleteStyles as ɵextractCompleteStyles,
} from "./html";

// Sandbox controller (internal)
export { OpenGenerativeUIController as ɵOpenGenerativeUIController } from "./controller";
export type {
  OpenGenerativeUIPhase as ɵOpenGenerativeUIPhase,
  OpenGenerativeUIState as ɵOpenGenerativeUIState,
  OpenGenerativeUIControllerOptions as ɵOpenGenerativeUIControllerOptions,
} from "./controller";
export { loadWebsandbox as ɵloadWebsandbox } from "./websandbox";
export type {
  SandboxLocalApi as ɵSandboxLocalApi,
  SandboxFunctionHandle as ɵSandboxFunctionHandle,
  WebsandboxInstance as ɵWebsandboxInstance,
  WebsandboxConstructor as ɵWebsandboxConstructor,
  WebsandboxLoader as ɵWebsandboxLoader,
} from "./websandbox";
