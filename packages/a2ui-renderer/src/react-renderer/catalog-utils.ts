import { basicCatalog } from "./a2ui-react";
import type { ComponentApi, Catalog } from "@a2ui/web_core/v0_9";
import { zodToJsonSchema } from "zod-to-json-schema";
import { z } from "zod";

const BASIC_CATALOG_ID =
  "https://a2ui.org/specification/v0_9/basic_catalog.json";

/**
 * Context description used to identify the A2UI component schema in RunAgentInput.context.
 * Must match the constant in @ag-ui/a2ui-middleware so the middleware can overwrite
 * a frontend-provided schema with a server-side one.
 */
export const A2UI_SCHEMA_CONTEXT_DESCRIPTION =
  "A2UI Component Schema — available components for generating UI surfaces. Use these component names and properties when creating A2UI operations.";

/**
 * Check whether a catalog is a superset of the basic catalog
 * (i.e., it contains all basic components by name).
 */
export function extendsBasicCatalog(catalog: Catalog<ComponentApi>): boolean {
  for (const name of basicCatalog.components.keys()) {
    if (!catalog.components.has(name)) {
      return false;
    }
  }
  return true;
}

/**
 * Return the names of components in a catalog that are not in the basic catalog.
 */
export function getCustomComponentNames(
  catalog: Catalog<ComponentApi>,
): string[] {
  const custom: string[] = [];
  for (const name of catalog.components.keys()) {
    if (!basicCatalog.components.has(name)) {
      custom.push(name);
    }
  }
  return custom;
}

/**
 * Build a context string describing the available A2UI catalog and custom components.
 * Custom components (those not in the basic catalog) are described using their
 * JSON Schema representation, matching the canonical A2UI catalog format.
 */
export interface CatalogContextValueOptions {
  /**
   * Describe each custom component with its JSON Schema. Default true. Pass
   * false when the component schema travels as its own context entry, so the
   * definitions are not sent twice (for a 67-component catalog the duplicate
   * is ~165 KB per run); the entry then lists component names only.
   */
  includeDefinitions?: boolean;
}

export function buildCatalogContextValue(
  catalog?: Catalog<ComponentApi>,
  options: CatalogContextValueOptions = {},
): string {
  const { includeDefinitions = true } = options;
  const resolved = catalog ?? basicCatalog;
  const lines: string[] = [];
  lines.push("Available A2UI catalog:");

  if (resolved.id === BASIC_CATALOG_ID) {
    lines.push(`- ${resolved.id} (basic catalog)`);
    return lines.join("\n");
  }

  const isSuperset = extendsBasicCatalog(resolved);
  const customNames = getCustomComponentNames(resolved);

  lines.push(`- ${resolved.id}`);
  if (isSuperset) {
    lines.push(
      "  Extends the basic catalog with all standard components plus:",
    );
  } else {
    lines.push("  Custom catalog (does NOT include all basic components).");
    lines.push("  Custom components:");
  }
  if ((resolved.functions?.size ?? 0) === 0) {
    lines.push(
      '  This catalog defines no functions: never use { "call": ... }; a value is a literal or a { "path": "..." } binding.',
    );
  }

  if (!includeDefinitions) {
    lines.push(`  ${customNames.join(", ")}`);
    lines.push("  (schemas are in the A2UI Component Schema context entry)");
    return lines.join("\n");
  }

  for (const name of customNames) {
    const comp = resolved.components.get(name);
    if (!comp) continue;
    const jsonSchema = zodToJsonSchema(comp.schema);
    lines.push(`  - ${name}:`);
    lines.push(
      `    ${JSON.stringify(jsonSchema, null, 2).split("\n").join("\n    ")}`,
    );
  }

  return lines.join("\n");
}

/**
 * A2UI v0.9 inline catalog format — matches the structure defined by the
 * A2UI specification (basic_catalog.json).  Each component is keyed by
 * name and uses `allOf` to compose ComponentCommon with component-specific
 * properties so the schema mirrors the flat wire format the LLM must produce.
 */
export interface InlineCatalogSchema {
  catalogId: string;
  components: Record<string, Record<string, unknown>>;
}

/**
 * Extract component schemas from a catalog in the A2UI v0.9 inline catalog
 * format.  This mirrors `generateInlineCatalog` from `@a2ui/web_core` so
 * the schema the LLM sees matches the spec and the flat wire format:
 *
 *   { "Column": { "allOf": [
 *       { "$ref": "common_types.json#/$defs/ComponentCommon" },
 *       { "properties": { "component": {"const":"Column"}, "gap": ..., "children": ... },
 *         "required": ["component"] }
 *   ]}}
 *
 * When sent via `useAgentContext` with `A2UI_SCHEMA_CONTEXT_DESCRIPTION`,
 * the middleware can optionally overwrite it with a server-side schema.
 */
export interface InlineCatalogSchemaOptions {
  /**
   * Keep the `{ call, args, returnType }` FunctionCall alternative on Dynamic
   * props and the `{ functionCall }` action variant. Default: only when the
   * catalog registers functions. A catalog without functions must not
   * advertise them, or the model writes `{ "call": ... }` for computed data
   * and the component fails validation.
   */
  includeFunctionCalls?: boolean;
}

/** Whether a JSON Schema node is a FunctionCall or functionCall-action variant. */
function isFunctionCallVariant(node: unknown): boolean {
  if (typeof node !== "object" || node === null) return false;
  const props = (node as { properties?: Record<string, unknown> }).properties;
  return !!props && ("call" in props || "functionCall" in props);
}

/** The JSON Schema with FunctionCall variants removed from every union. */
export function stripFunctionCallVariants<T>(schema: T): T {
  if (Array.isArray(schema)) {
    return schema.map((item) => stripFunctionCallVariants(item)) as T;
  }
  if (typeof schema !== "object" || schema === null) return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(
    schema as Record<string, unknown>,
  )) {
    if ((key === "anyOf" || key === "oneOf") && Array.isArray(value)) {
      const kept = value.filter((v) => !isFunctionCallVariant(v));
      out[key] = stripFunctionCallVariants(kept.length > 0 ? kept : value);
    } else {
      out[key] = stripFunctionCallVariants(value);
    }
  }
  return out as T;
}

export function extractCatalogComponentSchemas(
  catalog?: Catalog<ComponentApi>,
  options: InlineCatalogSchemaOptions = {},
): InlineCatalogSchema {
  const resolved = catalog ?? basicCatalog;
  const includeFunctionCalls =
    options.includeFunctionCalls ?? (resolved.functions?.size ?? 0) > 0;
  const components: Record<string, Record<string, unknown>> = {};

  for (const [name, comp] of resolved.components) {
    const raw = zodToJsonSchema(comp.schema, {
      target: "jsonSchema2019-09",
    }) as { properties?: Record<string, unknown>; required?: string[] };
    const zodSchema = includeFunctionCalls
      ? raw
      : stripFunctionCallVariants(raw);

    components[name] = {
      allOf: [
        { $ref: "common_types.json#/$defs/ComponentCommon" },
        {
          properties: {
            component: { const: name },
            ...(zodSchema.properties ?? {}),
          },
          required: ["component", ...(zodSchema.required ?? [])],
        },
      ],
    };
  }

  return { catalogId: resolved.id, components };
}

// ─── Compact catalog format (markdown mode) ──────────────────────────

/** Options for {@link buildCompactCatalogSchema}. */
export interface CompactCatalogSchemaOptions {
  /**
   * Keep the `{ call, args, returnType }` FunctionCall alternative on Dynamic
   * props and the `{ functionCall }` action variant. Default false: catalogs
   * that register no functions should not advertise them.
   */
  includeFunctionCalls?: boolean;
}

/** A catalog summarised as one short TypeScript-like type string per prop. */
export interface CompactCatalogSchema {
  catalogId: string;
  /**
   * Props (key → type) that many components carry verbatim, listed once.
   * Every component flagged `includesCommonProps` also accepts all of these.
   * Absent when no prop set is shared widely enough to be worth hoisting.
   */
  commonProps?: Record<string, string>;
  components: Record<
    string,
    {
      description?: string;
      includesCommonProps?: true;
      props: Record<string, string>;
    }
  >;
}

/** A prop must appear verbatim in at least this many components to be hoisted. */
const COMMON_PROP_MIN_COMPONENTS = 8;

/** Objects nested deeper than this collapse to `object`. */
const COMPACT_MAX_OBJECT_DEPTH = 2;

type AnyZod = z.ZodTypeAny;

/** Descriptions from `@a2ui/web_core` common types (`REF:...`) are generic noise. */
function ownDescription(schema: AnyZod): string | undefined {
  const text = schema.description;
  if (!text || text.startsWith("REF:")) return undefined;
  return text;
}

function unwrap(schema: AnyZod): AnyZod {
  let current: AnyZod = schema;
  for (let i = 0; i < 20; i++) {
    const def = current._def as { typeName?: string } & Record<string, any>;
    switch (def.typeName) {
      case "ZodOptional":
      case "ZodNullable":
      case "ZodDefault":
      case "ZodCatch":
      case "ZodReadonly":
        current = def.innerType;
        break;
      case "ZodBranded":
        current = def.type;
        break;
      case "ZodEffects":
        current = def.schema;
        break;
      case "ZodLazy":
        current = def.getter();
        break;
      case "ZodPipeline":
        current = def.in;
        break;
      default:
        return current;
    }
  }
  return current;
}

/**
 * `@a2ui/web_core` may resolve its own copy of zod, so check the type name
 * rather than `instanceof`.
 */
function isZodObject(schema: AnyZod): schema is z.AnyZodObject {
  return (schema._def as { typeName?: string }).typeName === "ZodObject";
}

function isFunctionCallShape(schema: AnyZod): boolean {
  const inner = unwrap(schema);
  if (!isZodObject(inner)) return false;
  const keys = Object.keys(inner.shape);
  return keys.includes("call") || keys.includes("functionCall");
}

function summarizeObject(
  shape: Record<string, AnyZod>,
  depth: number,
  options: CompactCatalogSchemaOptions,
): string {
  if (depth >= COMPACT_MAX_OBJECT_DEPTH) return "object";
  const fields = Object.entries(shape).map(
    ([key, value]) =>
      `${key}${value.isOptional() ? "?" : ""}: ${summarizeType(value, depth + 1, options)}`,
  );
  return fields.length ? `{ ${fields.join(", ")} }` : "{}";
}

function summarizeType(
  schema: AnyZod,
  depth: number,
  options: CompactCatalogSchemaOptions,
): string {
  const inner = unwrap(schema);
  const def = inner._def as { typeName?: string } & Record<string, any>;
  switch (def.typeName) {
    case "ZodString":
      return "string";
    case "ZodNumber":
    case "ZodBigInt":
      return "number";
    case "ZodBoolean":
      return "boolean";
    case "ZodNull":
      return "null";
    case "ZodLiteral":
      return JSON.stringify(def.value);
    case "ZodEnum":
      return (def.values as unknown[])
        .map((v) => JSON.stringify(v))
        .join(" | ");
    case "ZodNativeEnum":
      return Object.values(def.values as Record<string, unknown>)
        .map((v) => JSON.stringify(v))
        .join(" | ");
    case "ZodArray":
      return `Array<${summarizeType(def.type, depth, options)}>`;
    case "ZodTuple":
      return `[${(def.items as AnyZod[])
        .map((item) => summarizeType(item, depth, options))
        .join(", ")}]`;
    case "ZodRecord":
      return `Record<string, ${summarizeType(def.valueType, depth + 1, options)}>`;
    case "ZodObject":
      return summarizeObject((inner as z.AnyZodObject).shape, depth, options);
    case "ZodUnion":
    case "ZodDiscriminatedUnion": {
      const members = Array.from(def.options as Iterable<AnyZod>).filter(
        (member) =>
          options.includeFunctionCalls || !isFunctionCallShape(member),
      );
      const parts = members.map((member) =>
        summarizeType(member, depth, options),
      );
      return Array.from(new Set(parts)).join(" | ") || "any";
    }
    case "ZodIntersection":
      return `${summarizeType(def.left, depth, options)} & ${summarizeType(def.right, depth, options)}`;
    default:
      return "any";
  }
}

/**
 * Summarise a catalog as `{ catalogId, components: { Name: { description,
 * props: { "prop?": "type // description" } } } }`.
 *
 * Much smaller than {@link extractCatalogComponentSchemas}: each prop is a
 * short TypeScript-like type string. Dynamic props read
 * `string | { path: string }`; the FunctionCall alternative is dropped unless
 * `includeFunctionCalls` is set. Used by markdown mode, which has no
 * middleware that needs the full JSON Schema format.
 */
export function buildCompactCatalogSchema(
  catalog?: Catalog<ComponentApi>,
  options: CompactCatalogSchemaOptions = {},
): CompactCatalogSchema {
  const resolved = catalog ?? basicCatalog;
  const components: CompactCatalogSchema["components"] = {};
  const summaries: Array<{
    name: string;
    description?: string;
    props: Record<string, string>;
  }> = [];

  for (const [name, comp] of resolved.components) {
    const props: Record<string, string> = {};
    const objectSchema = unwrap(comp.schema);
    if (isZodObject(objectSchema)) {
      for (const [key, value] of Object.entries(
        objectSchema.shape as Record<string, AnyZod>,
      )) {
        const type = summarizeType(value, 0, options);
        const comment = ownDescription(value);
        props[`${key}${value.isOptional() ? "?" : ""}`] = comment
          ? `${type} // ${comment}`
          : type;
      }
    }
    const description =
      (comp as { description?: string }).description ??
      ownDescription(comp.schema);
    summaries.push({ name, description, props });
  }

  const common = findCommonProps(summaries.map((summary) => summary.props));
  const commonKeys = common ? Object.keys(common) : [];

  for (const { name, description, props } of summaries) {
    const includesCommon =
      common !== undefined &&
      commonKeys.every((key) => props[key] === common[key]);
    const ownProps = includesCommon
      ? Object.fromEntries(
          Object.entries(props).filter(([key]) => !(key in common)),
        )
      : props;
    components[name] = {
      ...(description ? { description } : {}),
      ...(includesCommon ? { includesCommonProps: true as const } : {}),
      props: ownProps,
    };
  }

  return common
    ? { catalogId: resolved.id, commonProps: common, components }
    : { catalogId: resolved.id, components };
}

/**
 * Pick the prop set worth listing once. Candidates are (key, type) pairs that
 * at least {@link COMMON_PROP_MIN_COMPONENTS} components carry verbatim; each
 * component's candidate subset is a possible common set, scored by the chars
 * it saves (set size × components that contain all of it). Returns undefined
 * when no set is shared by enough components.
 */
function findCommonProps(
  propsList: Array<Record<string, string>>,
): Record<string, string> | undefined {
  const pairKey = (key: string, type: string) => `${key}\u0000${type}`;
  const counts = new Map<string, number>();
  for (const props of propsList) {
    for (const [key, type] of Object.entries(props)) {
      const id = pairKey(key, type);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }

  let best: Record<string, string> | undefined;
  let bestScore = 0;
  const seen = new Set<string>();
  for (const props of propsList) {
    const subset = Object.entries(props).filter(
      ([key, type]) =>
        (counts.get(pairKey(key, type)) ?? 0) >= COMMON_PROP_MIN_COMPONENTS,
    );
    if (subset.length < 2) continue;
    const signature = subset
      .map(([key, type]) => pairKey(key, type))
      .join("\n");
    if (seen.has(signature)) continue;
    seen.add(signature);

    const members = propsList.filter((other) =>
      subset.every(([key, type]) => other[key] === type),
    ).length;
    if (members < COMMON_PROP_MIN_COMPONENTS) continue;
    const size = subset.reduce(
      (total, [key, type]) => total + key.length + type.length,
      0,
    );
    const score = size * (members - 1);
    if (score > bestScore) {
      bestScore = score;
      best = Object.fromEntries(subset);
    }
  }
  return best;
}

/**
 * Short capabilities text for markdown mode: the catalog id and component
 * names, no schemas (those travel in {@link buildCompactCatalogSchema}).
 */
export function buildCompactCatalogCapabilities(
  catalog?: Catalog<ComponentApi>,
): string {
  const resolved = catalog ?? basicCatalog;
  const names = Array.from(resolved.components.keys());
  return `Available A2UI catalog: ${resolved.id}\nComponents (${names.length}): ${names.join(", ")}`;
}
