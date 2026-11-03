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
  /**
   * One copy of each common type the schemas reference, so every
   * `common_types.json#/$defs/<Name>` ref resolves within this payload.
   */
  "common_types.json"?: { $defs: A2UICommonTypes };
}

/** Common type shapes keyed by their `common_types.json` `$defs` name. */
export type A2UICommonTypes = Record<string, JsonSchema>;

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
 * - A `REF:<ref>|<description>` marker becomes a bare `$ref`, as upstream, but
 *   the shape it replaced is kept once under
 *   `"common_types.json": { "$defs": { <Name>: ... } }`. Every
 *   `common_types.json#/$defs/<Name>` ref therefore resolves within the
 *   payload, both for agents that only see it as prompt text and for SDKs
 *   (such as Google's A2UI SDK used by ADK) that read the `$ref`. Each type is
 *   stated once rather than at every use site, which keeps the payload small.
 *   A use whose shape differs from the stored one keeps its shape inline next
 *   to the `$ref`, so the agent never sees a looser type than the client
 *   accepts.
 * - A `REF:` marker on a schema's root only sets its description; replacing
 *   the root would drop every property.
 * - A component's root `.describe()` is kept as the component `description`.
 * - Function parameters drop `$schema` and the description already given on
 *   the function itself, to keep the prompt small.
 */
export function extractA2UICatalogSchemas(
  catalog: A2UICatalogSchemaSource,
): A2UIInlineCatalogSchema {
  // Null prototypes, so a component or type named `__proto__` is kept as an
  // entry.
  const components: Record<string, JsonSchema> = Object.create(null);
  const commonTypes: A2UICommonTypes = Object.create(null);

  for (const [name, component] of catalog.components) {
    const schema = serializeA2UISchema(component.schema, commonTypes);
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
    const { description, ...parameters } = serializeA2UISchema(
      fn.schema,
      commonTypes,
    );
    return {
      name: fn.name,
      ...(typeof description === "string" ? { description } : {}),
      returnType: fn.returnType ?? "any",
      parameters,
    };
  });

  const theme = catalog.themeSchema
    ? (serializeA2UISchema(catalog.themeSchema, commonTypes).properties as
        | Record<string, JsonSchema>
        | undefined)
    : undefined;

  return {
    catalogId: catalog.id,
    components,
    ...(functions.length > 0 ? { functions } : {}),
    ...(theme ? { theme } : {}),
    ...(Object.keys(commonTypes).length > 0
      ? { "common_types.json": { $defs: commonTypes } }
      : {}),
  };
}

/**
 * Build a context string describing the catalog's id and the components it
 * adds beyond the basic catalog.
 *
 * Schemas are serialized as in {@link extractA2UICatalogSchemas}, with the
 * common types they reference listed once after the components.
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

  const commonTypes: A2UICommonTypes = Object.create(null);

  for (const [name, component] of catalog.components) {
    if (basicComponentNames.has(name)) continue;
    if (options?.includeSchema === false) {
      lines.push(`  - ${name}`);
      continue;
    }
    lines.push(`  - ${name}:`);
    lines.push(indented(serializeA2UISchema(component.schema, commonTypes)));
  }

  if (Object.keys(commonTypes).length > 0) {
    lines.push("  Common types referenced above (common_types.json#/$defs):");
    lines.push(indented(commonTypes));
  }

  return lines.join("\n");
}

/** JSON for the catalog context value, indented under a list item. */
function indented(value: unknown): string {
  return `    ${JSON.stringify(value, null, 2).split("\n").join("\n    ")}`;
}

/** Raw zod-to-json-schema output per Zod schema, stored as JSON text. */
const serializedSchemas = new WeakMap<object, string>();

/**
 * zod-to-json-schema's own parameter type. Casting to it (rather than to
 * `ZodTypeAny`) avoids a TS2589 "excessively deep" instantiation.
 */
type ZodSchemaArg = Parameters<typeof zodToJsonSchema>[0];

/**
 * Convert one A2UI Zod schema to JSON Schema 2019-09, inlining reused schemas
 * and resolving `REF:` markers (see {@link extractA2UICatalogSchemas}). The
 * shapes behind `common_types.json` refs are recorded in `commonTypes`; pass
 * the same map for every schema of one payload.
 *
 * The raw conversion is cached per schema object as JSON text, and every call
 * parses a fresh copy. The JSON round-trip, unlike structuredClone, never
 * throws on values such as a function or a Vue reactive proxy in a
 * `.default()`, and yields exactly what the agent receives.
 */
export function serializeA2UISchema(
  schema: unknown,
  commonTypes: A2UICommonTypes = Object.create(null),
): JsonSchema {
  const key = typeof schema === "object" && schema !== null ? schema : null;
  let serialized = key ? serializedSchemas.get(key) : undefined;
  if (serialized === undefined) {
    const jsonSchema = zodToJsonSchema(schema as ZodSchemaArg, {
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
    delete jsonSchema.$schema;
    serialized = JSON.stringify(jsonSchema);
    if (key) serializedSchemas.set(key, serialized);
  }

  const root = JSON.parse(serialized) as JsonSchema;
  const marker = parseRefMarker(root.description);
  if (marker) {
    delete root.description;
    if (marker.description) root.description = marker.description;
  }
  return resolveSubschemas(root, commonTypes);
}

/** Keywords whose value is a subschema, or an array of subschemas. */
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
  "allOf",
  "anyOf",
  "oneOf",
  "prefixItems",
];
/** Keywords whose value maps names to subschemas. */
const SUBSCHEMA_MAP_KEYWORDS = [
  "properties",
  "patternProperties",
  "dependentSchemas",
  "$defs",
  "definitions",
];

const COMMON_TYPE_REF = /^common_types\.json#\/\$defs\/([^/]+)$/;

function isObject(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Split a `REF:<ref>|<description>` marker at its first `|`, so a description
 * containing `|` is kept whole. The convention comes from
 * `MessageProcessor.processRefs` in `@a2ui/web_core`.
 */
function parseRefMarker(
  description: unknown,
): { ref: string; description?: string } | undefined {
  if (typeof description !== "string" || !description.startsWith("REF:")) {
    return undefined;
  }
  const body = description.slice(4);
  const separator = body.indexOf("|");
  return separator === -1
    ? { ref: body }
    : { ref: body.slice(0, separator), description: body.slice(separator + 1) };
}

/**
 * Resolve `REF:` markers in a schema's subschemas, innermost first, so a
 * stored common type refers to the types it contains by bare `$ref` too.
 *
 * Only schema-valued keywords are traversed, so literal values under
 * `default`, `const`, `enum` or `examples` are never rewritten.
 */
function resolveSubschemas(
  node: JsonSchema,
  commonTypes: A2UICommonTypes,
): JsonSchema {
  const resolve = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(resolve)
      : isObject(value)
        ? resolveRefMarker(resolveSubschemas(value, commonTypes), commonTypes)
        : value;

  const out: JsonSchema = { ...node };
  for (const keyword of SUBSCHEMA_KEYWORDS) {
    if (keyword in out) out[keyword] = resolve(out[keyword]);
  }
  for (const keyword of SUBSCHEMA_MAP_KEYWORDS) {
    const map = out[keyword];
    if (isObject(map)) {
      out[keyword] = Object.fromEntries(
        Object.entries(map).map(([name, child]) => [name, resolve(child)]),
      );
    }
  }
  return out;
}

/**
 * Turn a node carrying a `REF:` marker into a bare `$ref`, recording the
 * shape it replaced under its `common_types.json` name. A shape that differs
 * from the one already recorded, or a ref outside `common_types.json`, stays
 * inline next to the `$ref`.
 */
function resolveRefMarker(
  node: JsonSchema,
  commonTypes: A2UICommonTypes,
): JsonSchema {
  const marker = parseRefMarker(node.description);
  if (!marker) return node;

  const { description: _marker, ...shape } = node;
  const ref: JsonSchema = {
    $ref: marker.ref,
    ...(marker.description ? { description: marker.description } : {}),
  };
  const name = COMMON_TYPE_REF.exec(marker.ref)?.[1];
  if (name !== undefined) {
    const known = commonTypes[name];
    if (known === undefined) {
      commonTypes[name] = shape;
      return ref;
    }
    if (JSON.stringify(known) === JSON.stringify(shape)) return ref;
  }
  return { ...ref, ...shape };
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
