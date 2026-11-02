import { schemaToJsonSchema } from "@copilotkit/shared";
import type { SchemaToJsonSchemaOptions } from "@copilotkit/shared";
import type { ToolDefinition } from "./index";

/**
 * A server tool in a form that no model SDK owns.
 *
 * The `/ai-sdk` and `/tanstack-ai` subpaths map each spec to their SDK's
 * native tool. Custom factories can map it to any other SDK.
 */
export interface AgentToolSpec {
  /** The tool name the model calls. */
  name: string;
  /** Tells the model what the tool does and when to call it. */
  description: string;
  /** JSON Schema (draft-07) object for the tool input, as the model sees it. */
  parameters: Record<string, unknown>;
  /**
   * Runs the tool on the server with the parsed input from the model.
   * Not set for interrupt tools (`interrupt: true`), which pause the run.
   */
  execute?: (args: Record<string, unknown>) => Promise<unknown>;
  /** When true, a call to this tool pauses the run with an AG-UI interrupt. */
  interrupt?: boolean;
  /** Categorical reason on the interrupt. The runtime uses "tool_call" when not set. */
  interruptReason?: string;
  /** Human-readable prompt on the interrupt. */
  interruptMessage?: string;
}

/** Name of the tool that replaces the whole application state. */
export const STATE_SNAPSHOT_TOOL_NAME = "AGUISendStateSnapshot";

/** Name of the tool that applies JSON Patch operations to the application state. */
export const STATE_DELTA_TOOL_NAME = "AGUISendStateDelta";

/**
 * The two AG-UI state tools: `AGUISendStateSnapshot` and `AGUISendStateDelta`.
 *
 * Each `execute` returns its input with `success: true`. The stream
 * converters turn these results into `STATE_SNAPSHOT` and `STATE_DELTA`
 * events, so add both specs to the model's tools to let it edit state.
 *
 * @example
 * ```ts
 * const tools = [...stateToolSpecs, ...myToolSpecs];
 * ```
 */
export const stateToolSpecs: AgentToolSpec[] = [
  {
    name: STATE_SNAPSHOT_TOOL_NAME,
    description: "Replace the entire application state with a new snapshot",
    parameters: {
      type: "object",
      properties: {
        snapshot: { description: "The complete new state object" },
      },
      additionalProperties: false,
    },
    execute: async ({ snapshot }) => ({ success: true, snapshot }),
  },
  {
    name: STATE_DELTA_TOOL_NAME,
    description:
      "Apply incremental updates to application state using JSON Patch operations",
    parameters: {
      type: "object",
      properties: {
        delta: {
          type: "array",
          items: {
            type: "object",
            properties: {
              op: {
                type: "string",
                enum: ["add", "replace", "remove"],
                description: "The operation to perform",
              },
              path: {
                type: "string",
                description: "JSON Pointer path (e.g., '/foo/bar')",
              },
              value: {
                description:
                  "The value to set. Required for 'add' and 'replace' operations, ignored for 'remove'.",
              },
            },
            required: ["op", "path"],
            additionalProperties: false,
          },
          description: "Array of JSON Patch operations",
        },
      },
      required: ["delta"],
      additionalProperties: false,
    },
    execute: async ({ delta }) => ({ success: true, delta }),
  },
];

/**
 * Converts a `defineTool` result to an {@link AgentToolSpec}.
 *
 * The Standard Schema in `parameters` becomes JSON Schema through
 * `schemaToJsonSchema` from `@copilotkit/shared`. `execute` and the
 * interrupt fields are carried over unchanged.
 *
 * @param definition - The tool from `defineTool`.
 * @param options - Passed to `schemaToJsonSchema`. Zod v3 schemas do not
 *   implement Standard JSON Schema, so they need `options.zodToJsonSchema`.
 * @throws Error when the schema cannot be converted to JSON Schema.
 *
 * @example
 * ```ts
 * const spec = toolDefinitionToSpec(
 *   defineTool({ name: "getWeather", description: "...", parameters, execute }),
 * );
 * ```
 */
export function toolDefinitionToSpec(
  definition: ToolDefinition,
  options?: SchemaToJsonSchemaOptions,
) {
  const spec: AgentToolSpec = {
    name: definition.name,
    description: definition.description,
    parameters: schemaToJsonSchema(definition.parameters, options),
    execute: definition.execute,
    interrupt: definition.interrupt,
    interruptReason: definition.interruptReason,
    interruptMessage: definition.interruptMessage,
  };
  return spec;
}
