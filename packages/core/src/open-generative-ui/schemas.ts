import type {
  StandardJSONSchemaV1,
  StandardSchemaV1,
} from "@copilotkit/shared";
import type {
  GenerateSandboxedUiArgs,
  OpenGenerativeUIContent,
} from "./content";

type FieldType = "number" | "boolean" | "string" | "string[]";

/** A Standard Schema that also describes itself as JSON Schema. */
export type OpenGenerativeUISchema<T> = StandardSchemaV1<unknown, T> &
  StandardJSONSchemaV1<unknown, T>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function matches(value: unknown, type: FieldType) {
  if (type === "string[]") {
    return (
      Array.isArray(value) && value.every((item) => typeof item === "string")
    );
  }
  return typeof value === type;
}

function fieldJsonSchema(type: FieldType) {
  if (type === "string[]") return { type: "array", items: { type: "string" } };
  return { type };
}

/**
 * A schema for an object whose fields are all optional and typed: the shape
 * of `z.object({ ...: z.<type>().optional() })`, without zod. Unknown keys are
 * dropped, as zod does; a field of the wrong type is an issue.
 */
function optionalObjectSchema<T>(fields: Record<keyof T & string, FieldType>) {
  const entries = Object.entries<FieldType>(fields);
  const jsonSchema = {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: Object.fromEntries(
      entries.map(([name, type]) => [name, fieldJsonSchema(type)]),
    ),
  };
  const schema: OpenGenerativeUISchema<T> = {
    "~standard": {
      version: 1,
      vendor: "copilotkit",
      validate: (value) => {
        if (!isRecord(value)) {
          return { issues: [{ message: "Expected an object" }] };
        }
        const output: Record<string, unknown> = {};
        const issues: StandardSchemaV1.Issue[] = [];
        for (const [name, type] of entries) {
          const field = value[name];
          if (field === undefined) continue;
          if (matches(field, type)) output[name] = field;
          else issues.push({ message: `Expected ${type}`, path: [name] });
        }
        if (issues.length > 0) return { issues };
        // Every kept field matched its declared type above.
        return { value: output as T };
      },
      jsonSchema: {
        input: () => jsonSchema,
        output: () => jsonSchema,
      },
    },
  };
  return schema;
}

/** Validates Open Generative UI activity content. */
export const OPEN_GENERATIVE_UI_CONTENT_SCHEMA =
  optionalObjectSchema<OpenGenerativeUIContent>({
    initialHeight: "number",
    generating: "boolean",
    css: "string",
    cssComplete: "boolean",
    html: "string[]",
    htmlComplete: "boolean",
    jsFunctions: "string",
    jsFunctionsComplete: "boolean",
    jsExpressions: "string[]",
    jsExpressionsComplete: "boolean",
  });

/**
 * Validates the `generateSandboxedUi` tool arguments, and describes them to
 * the model as JSON Schema.
 */
export const GENERATE_SANDBOXED_UI_ARGS_SCHEMA =
  optionalObjectSchema<GenerateSandboxedUiArgs>({
    initialHeight: "number",
    placeholderMessages: "string[]",
    css: "string",
    html: "string",
    jsFunctions: "string",
    jsExpressions: "string[]",
  });
