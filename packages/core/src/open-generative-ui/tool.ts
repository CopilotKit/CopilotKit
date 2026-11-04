import {
  GENERATE_SANDBOXED_UI_DESCRIPTION,
  schemaToJsonSchema,
} from "@copilotkit/shared";
import type { StandardSchemaV1 } from "@copilotkit/shared";
import {
  DEFAULT_OPEN_GENERATIVE_UI_DESIGN_SKILL,
  GENERATE_SANDBOXED_UI_TOOL_NAME,
} from "./content";
import { GENERATE_SANDBOXED_UI_ARGS_SCHEMA } from "./schemas";

/**
 * Whether Open Generative UI is on: the runtime enables it, or the app
 * configures it on the provider.
 */
export function isOpenGenerativeUIActive({
  runtimeEnabled,
  configured,
}: {
  runtimeEnabled: boolean;
  configured: boolean;
}) {
  return runtimeEnabled || configured;
}

/**
 * The built-in `generateSandboxedUi` frontend tool, without its renderer.
 * Its handler only acknowledges the call: the agent streams the UI on the
 * Open Generative UI activity. The acknowledgement has no side effects, so a
 * call still pending after a reconnect is safe to answer again.
 *
 * @example
 * ```ts
 * const tool = { ...ɵcreateOpenGenerativeUITool(), render: MyToolRenderer };
 * ```
 */
export function createOpenGenerativeUITool() {
  return {
    name: GENERATE_SANDBOXED_UI_TOOL_NAME,
    description: GENERATE_SANDBOXED_UI_DESCRIPTION,
    parameters: GENERATE_SANDBOXED_UI_ARGS_SCHEMA,
    handler: () => Promise.resolve("UI generated"),
    reconnectBehavior: "resume-pending" as const,
    followUp: true,
  };
}

/** A host function that sandboxed UI code can call. */
export interface OpenGenerativeUISandboxFunction {
  name: string;
  description: string;
  parameters: StandardSchemaV1;
}

export const OPEN_GENERATIVE_UI_DESIGN_CONTEXT_DESCRIPTION =
  "Design guidelines for the generateSandboxedUi tool. Follow these when building UI.";
export const OPEN_GENERATIVE_UI_SANDBOX_FUNCTIONS_CONTEXT_DESCRIPTION =
  "Sandbox functions available in generated sandboxed UI code. Call via: await Websandbox.connection.remote.<functionName>(args)";

/**
 * The agent context entries for Open Generative UI: the design skill (the
 * default one when none is set), and the sandbox functions as JSON Schema
 * descriptors when there are any.
 *
 * @param options.designSkill - The app's design guidance, if any.
 * @param options.sandboxFunctions - The host functions sandboxed code can call.
 */
export function buildOpenGenerativeUIContexts({
  designSkill,
  sandboxFunctions,
}: {
  designSkill?: string;
  sandboxFunctions: readonly OpenGenerativeUISandboxFunction[];
}) {
  const entries = [
    {
      description: OPEN_GENERATIVE_UI_DESIGN_CONTEXT_DESCRIPTION,
      value: designSkill ?? DEFAULT_OPEN_GENERATIVE_UI_DESIGN_SKILL,
    },
  ];
  if (sandboxFunctions.length === 0) return entries;
  entries.push({
    description: OPEN_GENERATIVE_UI_SANDBOX_FUNCTIONS_CONTEXT_DESCRIPTION,
    value: JSON.stringify(
      sandboxFunctions.map((fn) => ({
        name: fn.name,
        description: fn.description,
        parameters: schemaToJsonSchema(fn.parameters),
      })),
    ),
  });
  return entries;
}
