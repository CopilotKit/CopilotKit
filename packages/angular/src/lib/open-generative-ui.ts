import type { StandardSchemaV1 } from "@copilotkit/shared";
import type {
  FrontendToolHandlerContext,
  GenerateSandboxedUiArgs,
  OpenGenerativeUIContent,
} from "@copilotkit/core";
import {
  ɵGENERATE_SANDBOXED_UI_ARGS_SCHEMA,
  ɵOPEN_GENERATIVE_UI_CONTENT_SCHEMA,
} from "@copilotkit/core";

export {
  OPEN_GENERATIVE_UI_ACTIVITY_TYPE,
  GENERATE_SANDBOXED_UI_TOOL_NAME,
  DEFAULT_OPEN_GENERATIVE_UI_DESIGN_SKILL,
} from "@copilotkit/core";
export type {
  OpenGenerativeUIContent,
  GenerateSandboxedUiArgs,
} from "@copilotkit/core";

export { GENERATE_SANDBOXED_UI_DESCRIPTION } from "@copilotkit/shared";

/** Validates Open Generative UI activity content (shared with React and Vue). */
export const OpenGenerativeUIContentSchema = ɵOPEN_GENERATIVE_UI_CONTENT_SCHEMA;

/**
 * Schema for the generateSandboxedUi tool call arguments (shared with React
 * and Vue). It also describes the arguments to the model as JSON Schema.
 */
export const GenerateSandboxedUiArgsSchema = ɵGENERATE_SANDBOXED_UI_ARGS_SCHEMA;

export type SandboxFunction<
  Args extends Record<string, unknown> = Record<string, unknown>,
> = {
  name: string;
  description: string;
  parameters: StandardSchemaV1<unknown, Args>;
  handler: (
    args: Args,
    context?: FrontendToolHandlerContext,
  ) => Promise<unknown> | unknown;
};

export interface OpenGenerativeUIConfig {
  sandboxFunctions?: SandboxFunction[];
  designSkill?: string;
}
