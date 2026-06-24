/**
 * Schema-library-agnostic helpers for the Slack SDK.
 *
 * The public API accepts any [Standard Schema](https://standardschema.dev)
 * validator — Zod 3.24+, Valibot v1+, ArkType v2+, and anything else that
 * implements the `~standard` protocol. We deliberately keep `zod` out of
 * the public type surface so consumers aren't locked to a single library
 * or a single Zod major (the v3 ↔ v4 type split otherwise leaks into
 * every signature that mentions `z.ZodType`).
 *
 * These wrap the canonical primitives from `@copilotkit/shared` (the same
 * ones `@copilotkit/core` uses for its `FrontendTool` parameters) plus a
 * couple of Slack-local conveniences.
 */
import {
  schemaToJsonSchema as sharedSchemaToJsonSchema,
  type StandardSchemaV1,
  type InferSchemaOutput,
} from "@copilotkit/shared";
import { zodToJsonSchema } from "zod-to-json-schema";

export type { StandardSchemaV1, InferSchemaOutput };

/**
 * A Standard Schema whose validated output is an object record.
 *
 * Tool args, component props, HITL props, and interrupt payloads are all
 * objects (and `@copilotkit/core` constrains tool args to
 * `Record<string, unknown>`). Bounding those generics by `ObjectSchema`
 * — rather than coercing a non-object output to `Record` after the fact —
 * makes a primitive/array schema (e.g. `z.string()`) a compile error at
 * the `parameters`/`props` field instead of silently widening it.
 */
export type ObjectSchema = StandardSchemaV1<unknown, Record<string, unknown>>;

/**
 * Convert any Standard Schema to a JSON Schema object suitable for an LLM
 * tool/parameter descriptor. Prefers a native JSON Schema (Standard JSON
 * Schema for Valibot/ArkType, `toJSONSchema()` for Zod v4); falls back to
 * `zod-to-json-schema` only for Zod v3 schemas, which don't emit JSON
 * Schema themselves. `$ref`s are inlined (`$refStrategy: "none"`) because
 * most LLM tool-call APIs reject composite `$ref` schemas.
 */
export function toJsonSchema(
  schema: StandardSchemaV1,
): Record<string, unknown> {
  return sharedSchemaToJsonSchema(schema, {
    // Adapt `zod-to-json-schema`'s `(schema: ZodType, ...)` signature to
    // shared's `(schema: unknown, ...)` injection point. Only invoked for
    // Zod v3 inputs that don't emit Standard JSON Schema themselves.
    zodToJsonSchema: (s, options) =>
      zodToJsonSchema(
        s as Parameters<typeof zodToJsonSchema>[0],
        options as never,
      ) as Record<string, unknown>,
  });
}

/** Discriminated result of validating a value against a Standard Schema. */
export type SchemaParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/**
 * Validate a value against a Standard Schema, awaiting async validators.
 * Returns a discriminated result with a path-qualified, human-readable
 * error string on failure — the caller (turn-runner) turns the error into
 * a JSON tool result so the agent can recover from a bad tool call.
 */
export async function validateSchema<S extends StandardSchemaV1>(
  schema: S,
  value: unknown,
): Promise<SchemaParseResult<InferSchemaOutput<S>>> {
  const raw = schema["~standard"].validate(value);
  // The Standard Schema spec permits `validate` to return any thenable,
  // not strictly a native `Promise` (e.g. a Promise from another realm or
  // a library's custom async result). Detect thenables, not `Promise`
  // instances, so async validators are always awaited.
  const result = isThenable(raw) ? await raw : raw;
  if (result.issues) {
    return { ok: false, error: formatIssues(result.issues) };
  }
  return { ok: true, value: result.value as InferSchemaOutput<S> };
}

function isThenable<T>(value: T | Promise<T>): value is Promise<T> {
  return (
    value != null && typeof (value as { then?: unknown }).then === "function"
  );
}

/** Format Standard Schema issues as `path: message; path: message`. */
function formatIssues(issues: ReadonlyArray<StandardSchemaV1.Issue>): string {
  return issues
    .map((issue) => {
      const path = (issue.path ?? [])
        .map((segment) =>
          typeof segment === "object" && segment !== null
            ? String(segment.key)
            : String(segment),
        )
        .join(".");
      return `${path || "(root)"}: ${issue.message}`;
    })
    .join("; ");
}
