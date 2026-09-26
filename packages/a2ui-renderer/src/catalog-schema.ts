import { schemaToJsonSchema } from "@copilotkit/shared";
import type { StandardSchemaV1 } from "@copilotkit/shared";
import { zodToJsonSchema } from "zod-to-json-schema";

// `zodToJsonSchema` also accepts a bare name string; the catalog only ever passes
// the options object, and narrowing to it keeps the merge below well-typed.
type ZodToJsonSchemaOptions = Extract<
  Parameters<typeof zodToJsonSchema>[1],
  Record<string, unknown>
>;

function isStandardSchema(schema: unknown): schema is StandardSchemaV1 {
  return (
    typeof schema === "object" &&
    schema !== null &&
    "~standard" in schema &&
    typeof (schema as { "~standard": unknown })["~standard"] === "object"
  );
}

/**
 * Convert a catalog component's props schema to JSON Schema.
 *
 * Catalogs are built from schemas the *application* supplies, so the schema
 * library version is outside this package's control: `@copilotkit/react-core`
 * accepts `zod >= 3.0.0` as a peer, while this package pins `zod ^3` for its own
 * built-in catalog. `zodToJsonSchema` only understands Zod v3 internals and
 * returns a bare `{ $schema }` — no `properties`, no `required`, and no error —
 * for a Zod v4 schema. That silently strips every prop from the catalog the
 * model is shown, so it emits components the renderer can never paint.
 *
 * Dispatch through `schemaToJsonSchema`, which prefers Standard JSON Schema V1
 * (Zod v4, Valibot, ArkType), then a native `toJSONSchema()`, and only then the
 * injected Zod v3 converter — and throws rather than returning something empty
 * when it recognises nothing.
 */
export function catalogSchemaToJsonSchema(
  schema: unknown,
  options?: ZodToJsonSchemaOptions,
): Record<string, unknown> {
  // Zod v3 releases before 3.24 predate Standard Schema and carry no
  // `~standard` marker, so `schemaToJsonSchema` cannot dispatch on them at all.
  // Convert those directly to keep older-but-supported setups working.
  if (!isStandardSchema(schema)) {
    return zodToJsonSchema(
      schema as Parameters<typeof zodToJsonSchema>[0],
      options,
    ) as Record<string, unknown>;
  }

  return schemaToJsonSchema(schema, {
    // `schemaToJsonSchema` supplies `$refStrategy: "none"` so the model sees an
    // inlined schema rather than dangling `$ref`s; the caller's `target` still
    // wins, keeping the emitted dialect identical to the previous behaviour.
    zodToJsonSchema: (zodSchema, injectedOptions) =>
      zodToJsonSchema(zodSchema as Parameters<typeof zodToJsonSchema>[0], {
        ...(injectedOptions as ZodToJsonSchemaOptions),
        ...options,
      }) as Record<string, unknown>,
  });
}
