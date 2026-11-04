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

// Schemas, built-in tool, agent context and placeholder rotation (internal)
export {
  OPEN_GENERATIVE_UI_CONTENT_SCHEMA as ɵOPEN_GENERATIVE_UI_CONTENT_SCHEMA,
  GENERATE_SANDBOXED_UI_ARGS_SCHEMA as ɵGENERATE_SANDBOXED_UI_ARGS_SCHEMA,
} from "./schemas";
export type { OpenGenerativeUISchema as ɵOpenGenerativeUISchema } from "./schemas";
export {
  isOpenGenerativeUIActive as ɵisOpenGenerativeUIActive,
  createOpenGenerativeUITool as ɵcreateOpenGenerativeUITool,
  buildOpenGenerativeUIContexts as ɵbuildOpenGenerativeUIContexts,
  OPEN_GENERATIVE_UI_DESIGN_CONTEXT_DESCRIPTION as ɵOPEN_GENERATIVE_UI_DESIGN_CONTEXT_DESCRIPTION,
  OPEN_GENERATIVE_UI_SANDBOX_FUNCTIONS_CONTEXT_DESCRIPTION as ɵOPEN_GENERATIVE_UI_SANDBOX_FUNCTIONS_CONTEXT_DESCRIPTION,
} from "./tool";
export type { OpenGenerativeUISandboxFunction as ɵOpenGenerativeUISandboxFunction } from "./tool";
export {
  PlaceholderCycler as ɵPlaceholderCycler,
  PLACEHOLDER_CYCLE_MS as ɵPLACEHOLDER_CYCLE_MS,
} from "./placeholder";
export type { PlaceholderCyclerSnapshot as ɵPlaceholderCyclerSnapshot } from "./placeholder";
export type {
  SandboxLocalApi as ɵSandboxLocalApi,
  SandboxFunctionHandle as ɵSandboxFunctionHandle,
  WebsandboxInstance as ɵWebsandboxInstance,
  WebsandboxConstructor as ɵWebsandboxConstructor,
  WebsandboxLoader as ɵWebsandboxLoader,
} from "./websandbox";
