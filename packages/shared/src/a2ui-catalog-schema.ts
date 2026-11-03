import { ignoreOverride, zodToJsonSchema } from "zod-to-json-schema";

/**
 * Context description used to identify the A2UI component schema in
 * RunAgentInput.context. Must match the constant in @ag-ui/a2ui-middleware so
 * the middleware can overwrite a frontend-provided schema with a server-side one.
 */
export const A2UI_SCHEMA_CONTEXT_DESCRIPTION =
  "A2UI Component Schema — available components for generating UI surfaces. Use these component names and properties when creating A2UI operations.";

/** Id of the A2UI v0.9 basic catalog. */
export const A2UI_BASIC_CATALOG_ID =
  "https://a2ui.org/specification/v0_9/basic_catalog.json";

type JsonSchema = Record<string, unknown>;

/**
 * The parts of an `@a2ui/web_core` v0.9 `Catalog` that the serializers read.
 * Typed structurally so this module does not depend on web_core, and so the
 * minimal catalog-shaped objects some apps pass in still work.
 */
export interface A2UICatalogSchemaSource {
  readonly id: string;
  readonly components: ReadonlyMap<string, { readonly schema: unknown }>;
  /** A `ReadonlyMap` on a real `Catalog`; anything else is tolerated. */
  readonly functions?: unknown;
  readonly themeSchema?: unknown;
}

/** One entry of {@link A2UIInlineCatalogSchema.functions}. */
export interface A2UIFunctionSchema {
  name: string;
  description?: string;
  returnType: string;
  parameters: JsonSchema;
}

/**
 * A2UI v0.9 inline catalog, the shape of `InlineCatalog` in
 * `@a2ui/web_core/v0_9`, sent to the agent as the component schema.
 */
export interface A2UIInlineCatalogSchema {
  catalogId: string;
  components: Record<string, JsonSchema>;
  functions?: A2UIFunctionSchema[];
  theme?: Record<string, JsonSchema>;
}

/**
 * Serialize a catalog's Zod schemas in the A2UI v0.9 inline catalog format.
 *
 * Each component composes `ComponentCommon` with its own properties, matching
 * the flat wire format the agent must produce:
 *
 *   { "Column": { "allOf": [
 *       { "$ref": "common_types.json#/$defs/ComponentCommon" },
 *       { "properties": { "component": {"const":"Column"}, "gap": ..., "children": ... },
 *         "required": ["component"] }
 *   ]}}
 *
 * This follows `getClientCapabilities` in `@a2ui/web_core` with these
 * deliberate differences:
 *
 * - Reused Zod schemas are inlined rather than emitted as local `$ref`s, which
 *   would dangle once properties move under `allOf[1]`.
 * - A `REF:<ref>|<description>` marker keeps the inlined shape and adds the
 *   `$ref` alongside it. Agent SDKs that understand `common_types.json` (such
 *   as Google's A2UI SDK used by ADK) read the `$ref`; agents that only see
 *   this JSON as prompt text still get the concrete shape.
 * - A component's root `.describe()` is kept as the component `description`.
 * - Function parameters drop `$schema` and the description already given on
 *   the function itself, to keep the prompt small.
 */
export function extractA2UICatalogSchemas(
  catalog: A2UICatalogSchemaSource,
): A2UIInlineCatalogSchema {
  const components: Record<string, JsonSchema> = {};

  for (const [name, component] of catalog.components) {
    const schema = serializeA2UISchema(component.schema);
    const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
    const required = (schema.required ?? []) as string[];

    components[name] = {
      ...(typeof schema.description === "string"
        ? { description: schema.description }
        : {}),
      allOf: [
        { $ref: "common_types.json#/$defs/ComponentCommon" },
        {
          properties: { component: { const: name }, ...properties },
          required: ["component", ...required],
        },
      ],
    };
  }

  const functions = catalogFunctions(catalog.functions).map((fn) => {
    const { description, ...parameters } = serializeA2UISchema(fn.schema);
    return {
      name: fn.name,
      ...(typeof description === "string" ? { description } : {}),
      returnType: fn.returnType ?? "any",
      parameters,
    };
  });

  const theme = catalog.themeSchema
    ? (serializeA2UISchema(catalog.themeSchema).properties as
        | Record<string, JsonSchema>
        | undefined)
    : undefined;

  return {
    catalogId: catalog.id,
    components,
    ...(functions.length > 0 ? { functions } : {}),
    ...(theme ? { theme } : {}),
  };
}

/**
 * Build a context string describing the catalog's id and the components it
 * adds beyond the basic catalog.
 *
 * When `options.includeSchema` is `false`, custom components are listed by name
 * only and their JSON schemas are omitted.
 */
export function buildA2UICatalogContextValue(
  catalog: A2UICatalogSchemaSource,
  basicComponentNames: ReadonlySet<string>,
  options?: { includeSchema?: boolean },
): string {
  const lines: string[] = ["Available A2UI catalog:"];

  if (catalog.id === A2UI_BASIC_CATALOG_ID) {
    lines.push(`- ${catalog.id} (basic catalog)`);
    return lines.join("\n");
  }

  const isSuperset = [...basicComponentNames].every((name) =>
    catalog.components.has(name),
  );

  lines.push(`- ${catalog.id}`);
  if (isSuperset) {
    lines.push(
      "  Extends the basic catalog with all standard components plus:",
    );
  } else {
    lines.push("  Custom catalog (does NOT include all basic components).");
    lines.push("  Custom components:");
  }

  for (const [name, component] of catalog.components) {
    if (basicComponentNames.has(name)) continue;
    if (options?.includeSchema === false) {
      lines.push(`  - ${name}`);
      continue;
    }
    const jsonSchema = serializeA2UISchema(component.schema);
    lines.push(`  - ${name}:`);
    lines.push(
      `    ${JSON.stringify(jsonSchema, null, 2).split("\n").join("\n    ")}`,
    );
  }

  return lines.join("\n");
}

const serializedSchemas = new WeakMap<object, JsonSchema>();

/**
 * zod-to-json-schema's own parameter type. Casting to it (rather than to
 * `ZodTypeAny`) avoids a TS2589 "excessively deep" instantiation.
 */
type ZodSchemaArg = Parameters<typeof zodToJsonSchema>[0];

/**
 * Convert one A2UI Zod schema to JSON Schema 2019-09, inlining reused schemas
 * and resolving `REF:` markers (see {@link extractA2UICatalogSchemas}).
 * Results are cached per schema object; each call returns a fresh copy.
 */
export function serializeA2UISchema(schema: unknown): JsonSchema {
  const key = typeof schema === "object" && schema !== null ? schema : null;
  let serialized = key ? serializedSchemas.get(key) : undefined;
  if (!serialized) {
    serialized = zodToJsonSchema(schema as ZodSchemaArg, {
      target: "jsonSchema2019-09",
      $refStrategy: "none",
      // With "none", zod-to-json-schema already turns a recursive reference
      // into `{}` (any), but logs a warning every time it does. Return `{}`
      // here directly so re-serializing a recursive catalog stays quiet.
      override: (_def, refs, seen, forceResolution) =>
        seen &&
        !forceResolution &&
        seen.path.length < refs.currentPath.length &&
        seen.path.every((part, i) => refs.currentPath[i] === part)
          ? {}
          : ignoreOverride,
    }) as JsonSchema;
    delete serialized.$schema;
    applyRefMarkers(serialized);
    if (key) serializedSchemas.set(key, serialized);
  }
  return structuredClone(serialized);
}

/** Keywords whose value is a single subschema. */
const SUBSCHEMA_KEYWORDS = [
  "items",
  "additionalItems",
  "additionalProperties",
  "unevaluatedItems",
  "unevaluatedProperties",
  "contains",
  "propertyNames",
  "not",
  "if",
  "then",
  "else",
];
/** Keywords whose value is an array of subschemas. */
const SUBSCHEMA_ARRAY_KEYWORDS = ["allOf", "anyOf", "oneOf", "prefixItems"];
/** Keywords whose value maps names to subschemas. */
const SUBSCHEMA_MAP_KEYWORDS = [
  "properties",
  "patternProperties",
  "dependentSchemas",
  "$defs",
  "definitions",
];

/**
 * Resolve `REF:<ref>|<description>` markers in place. The `REF:` convention
 * comes from `MessageProcessor.processRefs` in `@a2ui/web_core`, which
 * replaces the whole subtree with `$ref`; here the subtree is kept (see
 * {@link extractA2UICatalogSchemas}).
 *
 * Only schema-valued keywords are traversed, so literal values under
 * `default`, `const`, `enum` or `examples` (which zod-to-json-schema may share
 * with the caller's live Zod schema) are never rewritten.
 */
function applyRefMarkers(schema: unknown): void {
  if (typeof schema !== "object" || schema === null) return;
  if (Array.isArray(schema)) {
    for (const item of schema) applyRefMarkers(item);
    return;
  }

  const node = schema as JsonSchema;
  if (
    typeof node.description === "string" &&
    node.description.startsWith("REF:")
  ) {
    const body = node.description.slice(4);
    const separator = body.indexOf("|");
    const ref = separator === -1 ? body : body.slice(0, separator);
    const description =
      separator === -1 ? undefined : body.slice(separator + 1);
    // Rebuild the node so `$ref` and the description lead, then the shape.
    const { description: _marker, ...shape } = node;
    for (const key of Object.keys(node)) delete node[key];
    Object.assign(
      node,
      { $ref: ref },
      description ? { description } : {},
      shape,
    );
  }

  for (const keyword of SUBSCHEMA_KEYWORDS) applyRefMarkers(node[keyword]);
  for (const keyword of SUBSCHEMA_ARRAY_KEYWORDS) {
    applyRefMarkers(node[keyword]);
  }
  for (const keyword of SUBSCHEMA_MAP_KEYWORDS) {
    const map = node[keyword];
    if (typeof map === "object" && map !== null) {
      for (const child of Object.values(map)) applyRefMarkers(child);
    }
  }
}

interface CatalogFunction {
  name: string;
  returnType?: string;
  schema: unknown;
}

/**
 * Read a catalog's functions, tolerating catalog-shaped objects whose
 * `functions` is missing, a plain object or an array, and skipping entries
 * without a name or schema.
 */
function catalogFunctions(functions: unknown): CatalogFunction[] {
  if (typeof functions !== "object" || functions === null) return [];
  const entries =
    functions instanceof Map
      ? [...functions.values()]
      : Array.isArray(functions)
        ? functions
        : Object.values(functions);
  return entries.filter(
    (fn): fn is CatalogFunction =>
      typeof fn === "object" &&
      fn !== null &&
      typeof fn.name === "string" &&
      typeof fn.schema === "object" &&
      fn.schema !== null,
  );
}
