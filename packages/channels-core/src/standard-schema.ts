/**
 * Schema-library-agnostic helpers for the Channels SDK.
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
 * couple of Channels-local conveniences.
 */
import { schemaToJsonSchema as sharedSchemaToJsonSchema } from "@copilotkit/shared";
import type {
  StandardSchemaV1,
  StandardJSONSchemaV1,
  InferSchemaOutput,
} from "@copilotkit/shared";
import { zodToJsonSchema } from "zod-to-json-schema";

export type { StandardSchemaV1, StandardJSONSchemaV1, InferSchemaOutput };

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

/**
 * A parameter schema for a tool that takes exactly one required string.
 *
 * The output type is keyed by the literal `Name` passed in, so a handler
 * written against it destructures the real field name and not a widened
 * `Record`.
 */
export type SingleStringParameterSchema<Name extends string> = StandardSchemaV1<
  unknown,
  { [K in Name]: string }
> &
  StandardJSONSchemaV1<unknown, { [K in Name]: string }>;

/**
 * `typeof` reports "object" for both `null` and arrays. Zod names them
 * separately, and this message is what the agent reads back on a bad call,
 * so it is worth the three lines to keep the wording it used to get.
 */
function parsedTypeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Build a tool parameter schema for a single required, non-empty string,
 * written directly against the [Standard Schema](https://standardschema.dev)
 * protocol.
 *
 * WHY THIS EXISTS (PE-30, OSS-1173)
 * ---------------------------------
 * Every platform adapter ships one `lookup_<platform>_user` tool, and each
 * one took the same parameter: a single string to resolve to a user. Each
 * built that parameter with `z.object({query: z.string().min(1)})`, and a
 * `zod` range in the adapter's `package.json` was the price.
 *
 * That price was not local. The `@copilotkit/channels` umbrella depends on
 * every adapter, and `@microsoft/agents-hosting` and
 * `@microsoft/agents-activity` pin `zod` at exactly `3.25.75`. An adapter
 * asking for `^3.25.76` is a range that excludes that pin, so installing the
 * umbrella alongside the Microsoft packages left a tree no application could
 * repair from its own `package.json` — the conflict came from two packages we
 * publish. One dependency for one object literal was not a trade worth
 * keeping, three times over.
 *
 * `defineChannelTool` accepts any Standard Schema, and `toJsonSchema()` reads
 * `~standard.jsonSchema.input()` in preference to every other path, so this
 * one small object is all a tool ever needed.
 *
 * Behavior mirrors the `z.object({[name]: z.string().min(1).describe(...)})`
 * it replaces: the field is required, must be a string of at least one
 * character, and unknown keys are stripped rather than rejected (Zod's
 * default `strip` mode for `z.object`). The emitted document is what
 * `zod-to-json-schema` emitted for that object, so the descriptor the model
 * is shown does not change. Its body is target-agnostic — `type`,
 * `properties`, `required`, `minLength` and `additionalProperties` mean the
 * same thing in draft-07 and draft-2020-12 — so one document serves every
 * target a caller asks for, and `$schema` keeps the draft-07 value the
 * previous output carried.
 *
 * The one-character floor is fixed rather than configurable because all three
 * call sites want it and a knob nobody turns is a knob nobody tests.
 */
export function singleStringParameterSchema<Name extends string>(options: {
  /** Field name, e.g. `"query"`. Becomes the sole key of the output object. */
  name: Name;
  /** Field description handed to the model. Was `z.string().describe(...)`. */
  description: string;
  /** Standard Schema `vendor` tag — pass the declaring package's name. */
  vendor: string;
}): SingleStringParameterSchema<Name> {
  const { name, description, vendor } = options;
  type Output = { [K in Name]: string };

  const jsonSchema: Record<string, unknown> = {
    type: "object",
    properties: {
      [name]: { type: "string", minLength: 1, description },
    },
    required: [name],
    additionalProperties: false,
    $schema: "http://json-schema.org/draft-07/schema#",
  };

  function validate(value: unknown): StandardSchemaV1.Result<Output> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return {
        issues: [
          { message: "Expected object, received " + parsedTypeOf(value) },
        ],
      };
    }
    const field = (value as Record<string, unknown>)[name];
    if (typeof field !== "string") {
      return {
        issues: [
          {
            message:
              "Expected string, received " +
              (field === undefined ? "undefined" : parsedTypeOf(field)),
            path: [name],
          },
        ],
      };
    }
    if (field.length < 1) {
      return {
        issues: [
          {
            message: "String must contain at least 1 character(s)",
            path: [name],
          },
        ],
      };
    }
    // Rebuilt rather than returned as-is: this is what strips unknown keys.
    return { value: { [name]: field } as Output };
  }

  return {
    "~standard": {
      version: 1,
      vendor,
      validate,
      jsonSchema: {
        input: () => jsonSchema,
        output: () => jsonSchema,
      },
    },
  };
}
