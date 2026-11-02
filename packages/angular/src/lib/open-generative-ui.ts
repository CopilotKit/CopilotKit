import type { StandardSchemaV1 } from "@copilotkit/shared";
import type {
  FrontendToolHandlerContext,
  GenerateSandboxedUiArgs,
  OpenGenerativeUIContent,
} from "@copilotkit/core";
import { z } from "zod";

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

export const OpenGenerativeUIContentSchema = z.object({
  initialHeight: z.number().optional(),
  generating: z.boolean().optional(),
  css: z.string().optional(),
  cssComplete: z.boolean().optional(),
  html: z.array(z.string()).optional(),
  htmlComplete: z.boolean().optional(),
  jsFunctions: z.string().optional(),
  jsFunctionsComplete: z.boolean().optional(),
  jsExpressions: z.array(z.string()).optional(),
  jsExpressionsComplete: z.boolean().optional(),
}) satisfies z.ZodType<OpenGenerativeUIContent>;

export const GenerateSandboxedUiArgsSchema = z.object({
  initialHeight: z.number().optional(),
  placeholderMessages: z.array(z.string()).optional(),
  css: z.string().optional(),
  html: z.string().optional(),
  jsFunctions: z.string().optional(),
  jsExpressions: z.array(z.string()).optional(),
}) satisfies z.ZodType<GenerateSandboxedUiArgs>;

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
