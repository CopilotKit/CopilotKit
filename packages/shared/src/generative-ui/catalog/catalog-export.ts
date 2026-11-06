import {
  A2UI_CHILD_LIST_REF,
  A2UI_COMPONENT_ID_REF,
  GENERATIVE_UI_FUNCTIONS,
  childRefKind,
  functionCallers,
} from "../base";
import type {
  A2UIAllowedCallers,
  A2UIFunctionPermissions,
  GenerativeUIComponentManifest,
  GenerativeUIJSONSchema,
} from "../base";
import type { GenerativeUI } from "./catalog";
import { toJsonSchema } from "./json-schema";
import { hasOwnKey, isRecord } from "../is-record";

const COMMON = "common_types.json#/$defs/";
const DATA_BINDING_REF = `${COMMON}DataBinding`;
const FUNCTION_CALL_REF = `${COMMON}FunctionCall`;
const ACTION_REF = `${COMMON}Action`;
const DYNAMIC_REFS: Record<string, string> = {
  string: `${COMMON}DynamicString`,
  number: `${COMMON}DynamicNumber`,
  boolean: `${COMMON}DynamicBoolean`,
  "string[]": `${COMMON}DynamicStringList`,
  unknown: `${COMMON}DynamicValue`,
};

/** What `exportA2UICatalog` adds at the top of the catalog. */
export interface ExportA2UICatalogOptions {
  /** The title of the catalog. */
  title?: string;
  /** What the catalog is for. */
  description?: string;
  /** Markdown design guidelines for a model that writes this catalog. */
  instructions?: string;
}

/**
 * The A2UI 1.0 catalog definition of a generative UI, as a JSON value that
 * follows `catalog_definition.json`: one `components` entry per component,
 * with `component` as a `const`, `functions` for the built-ins and the
 * declared functions, and `$defs.anyComponent` / `$defs.anyFunction`. Other
 * A2UI tools (a validator, another renderer, a prompt builder) read it.
 *
 * - A prop that `child()` or `childList()` marks is a `ComponentId` or a
 *   `ChildList` reference; so is a slot. An event prop is an `Action`.
 * - Every other value, at any depth of a prop or of the args of a declared
 *   function, takes its literal schema, a `DataBinding` or a `FunctionCall`,
 *   because the renderer resolves dynamic values at any depth.
 * - Every function states `returnType` and `allowedCallers`: the built-ins
 *   are `rendererOnly`, and so is a declared function without
 *   `allowedCallers`, as in A2UI 1.0.
 *
 * @param ui - The generative UI to describe.
 * @param options - The title, description and instructions of the catalog.
 *
 * @example
 * ```ts
 * const catalog = exportA2UICatalog(shopUI, { title: "Acme shop" });
 * fs.writeFileSync("shop-catalog.json", JSON.stringify(catalog, null, 2));
 * ```
 */
export function exportA2UICatalog(
  ui: GenerativeUI,
  options: ExportA2UICatalogOptions = {},
) {
  const components = Object.fromEntries(
    Object.entries(ui.manifestComponents).map(([name, manifest]) => [
      name,
      toDraft2020(
        rebaseRefs(
          componentDefinition(name, manifest),
          `#/components/${pointerSegment(name)}`,
        ),
      ),
    ]),
  );
  const functions: Record<string, GenerativeUIJSONSchema> = {};
  for (const [name, info] of Object.entries(GENERATIVE_UI_FUNCTIONS)) {
    // A declared function of the same name is the app's.
    if (ui.functions.has(name)) continue;
    functions[name] = functionEntry(name, info, {
      description: info.description,
      returnType: info.returnType,
      args: argsSchemaFromSignature(info.parameters),
    });
  }
  for (const [name, fn] of ui.functions) {
    functions[name] = functionEntry(name, fn, {
      description: fn.description,
      returnType: fn.returnType ?? "any",
      args: toDraft2020(
        rebaseRefs(
          dynamicArgs(toJsonSchema(fn.parameters)),
          `#/functions/${pointerSegment(name)}/properties/args`,
        ),
      ),
    });
  }
  const { title, description, instructions } = options;
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    protocolVersion: "1.0",
    catalogId: ui.id,
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    ...(instructions === undefined ? {} : { instructions }),
    components,
    functions,
    $defs: {
      anyComponent: {
        ...oneOfRefs("components", Object.keys(components)),
        discriminator: { propertyName: "component" },
      },
      anyFunction: oneOfRefs("functions", Object.keys(functions)),
    },
  };
}

/**
 * `oneOf` over the entries of a section. JSON Schema wants at least one
 * variant, so an empty section (a UI with no components) matches nothing.
 */
function oneOfRefs(section: string, names: string[]) {
  if (names.length === 0) return { not: {} };
  return {
    oneOf: names.map((name) => ({
      $ref: `#/${section}/${pointerSegment(name)}`,
    })),
  };
}

/** A name as a JSON Pointer segment in a URI fragment: `acme/Card` is `acme~1Card`. */
function pointerSegment(name: string) {
  return encodeURIComponent(name.replace(/~/g, "~0").replace(/\//g, "~1"));
}

/** Keywords whose value is data, not a schema. */
const LITERAL_KEYWORDS = new Set(["default", "const", "enum", "examples"]);

/**
 * A schema in the draft 2020-12 dialect that the catalog declares. The
 * converter writes draft-07, where a tuple is `items: [...]` with
 * `additionalItems`; 2020-12 spells that `prefixItems` and `items`.
 */
function toDraft2020(schema: GenerativeUIJSONSchema): GenerativeUIJSONSchema {
  return mapSchema(schema, (node) => {
    const { items, additionalItems, ...rest } = node;
    if (!Array.isArray(items)) return node;
    return {
      ...rest,
      prefixItems: items,
      ...(additionalItems === undefined ? {} : { items: additionalItems }),
    };
  });
}

/** One `components` entry: the props as the model sets them, with the A2UI common types. */
function componentDefinition(
  name: string,
  manifest: GenerativeUIComponentManifest,
): GenerativeUIJSONSchema {
  const { properties, required, description, $defs, definitions } =
    manifest.props;
  const props = Object.fromEntries(
    Object.entries(isRecord(properties) ? properties : {}).map(
      ([key, schema]) => [key, dynamicProp(schema)],
    ),
  );
  const events = Object.fromEntries(
    Object.entries(manifest.events ?? {}).map(([key, event]) => [
      key,
      {
        $ref: ACTION_REF,
        ...(event.description ? { description: event.description } : {}),
      },
    ]),
  );
  const slots = Object.fromEntries(
    Object.entries(manifest.slots ?? {}).map(([key, kind]) => [
      key,
      { $ref: kind === "single" ? A2UI_COMPONENT_ID_REF : A2UI_CHILD_LIST_REF },
    ]),
  );
  const fields = { ...props, ...events, ...slots };
  const orderedFields =
    manifest.parameterOrder === undefined
      ? fields
      : Object.fromEntries(
          [...new Set([...manifest.parameterOrder, ...Object.keys(fields)])]
            .filter((key) => hasOwnKey(fields, key))
            .map((key) => [key, fields[key]]),
        );
  const text = manifest.description ?? description;
  return {
    type: "object",
    ...(typeof text === "string" ? { description: text } : {}),
    properties: { component: { const: name }, ...orderedFields },
    required: [
      "component",
      ...(Array.isArray(required) ? required.filter(isString) : []),
    ],
    // The definitions of the props schema, when its converter made some:
    // their values are dynamic like the props, and the references to them
    // are rebased onto this entry.
    ...withDynamicChildren({
      ...(isRecord($defs) ? { $defs } : {}),
      ...(isRecord(definitions) ? { definitions } : {}),
    }),
  };
}

/**
 * The schema with its local references (`#/...`) pointing into the place
 * it is embedded at. A converter that writes `$defs` refers to them from
 * the root of its own document; inside the catalog, that root is `base`.
 */
function rebaseRefs(
  schema: GenerativeUIJSONSchema,
  base: string,
): GenerativeUIJSONSchema {
  return mapSchema(schema, (node) => {
    const ref = node.$ref;
    // "#" is the root of the embedded schema (a recursive one refers to it).
    if (ref === "#") return { ...node, $ref: base };
    if (typeof ref === "string" && ref.startsWith("#/")) {
      return { ...node, $ref: `${base}${ref.slice(1)}` };
    }
    return node;
  });
}

/** Keywords whose value is a map from a name to a schema. */
const SCHEMA_MAP_KEYWORDS = new Set([
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas",
]);

/**
 * Walks a JSON Schema and rebuilds each schema node with `transform`, the
 * children first. The names in `properties` and the definition maps are
 * names, not keywords: a prop called `default` is a schema, while the
 * `default` of a schema is data and stays as it is.
 */
function mapSchema(
  schema: GenerativeUIJSONSchema,
  transform: (node: Record<string, unknown>) => Record<string, unknown>,
): GenerativeUIJSONSchema {
  const visitValue = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visitValue);
    return isRecord(value) ? visitNode(value) : value;
  };
  const visitNode = (
    node: Record<string, unknown>,
  ): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (LITERAL_KEYWORDS.has(key)) result[key] = value;
      else if (SCHEMA_MAP_KEYWORDS.has(key) && isRecord(value)) {
        result[key] = Object.fromEntries(
          Object.entries(value).map(([name, entry]) => [
            name,
            isRecord(entry) ? visitNode(entry) : entry,
          ]),
        );
      } else result[key] = visitValue(value);
    }
    return transform(result);
  };
  return visitNode(schema) as GenerativeUIJSONSchema;
}

const isString = (value: unknown): value is string => typeof value === "string";

/**
 * A prop as the catalog states it. A component reference stays one. Any
 * other value takes its literal schema, a data binding or a function call,
 * and so does every value inside it: the properties of an object, the
 * values of a record and the items of a list, because the renderer
 * resolves dynamic values at any depth. The variants of a union are
 * transformed in place.
 */
function dynamicProp(schema: unknown): GenerativeUIJSONSchema {
  if (!isRecord(schema)) return { $ref: DYNAMIC_REFS.unknown };
  if (childRefKind(schema)) return schema;
  const { description, ...literal } = withDynamicChildren(schema);
  return {
    ...(typeof description === "string" ? { description } : {}),
    anyOf: [literal, { $ref: DATA_BINDING_REF }, { $ref: FUNCTION_CALL_REF }],
  };
}

/** The schema with its nested values made dynamic, itself unchanged. */
function withDynamicChildren(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...schema };
  if (isRecord(schema.properties)) {
    result.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, value]) => [
        key,
        dynamicProp(value),
      ]),
    );
  }
  if (isRecord(schema.items)) result.items = dynamicProp(schema.items);
  // A tuple, as the converter writes it; the catalog spells it prefixItems.
  if (Array.isArray(schema.items)) {
    result.items = schema.items.map((item) =>
      isRecord(item) ? dynamicProp(item) : item,
    );
  }
  if (isRecord(schema.additionalItems)) {
    result.additionalItems = dynamicProp(schema.additionalItems);
  }
  // The definitions a converter wrote: referenced from value positions.
  for (const key of ["$defs", "definitions"] as const) {
    const defs = schema[key];
    if (isRecord(defs)) {
      result[key] = Object.fromEntries(
        Object.entries(defs).map(([name, def]) => [
          name,
          isRecord(def) ? withDynamicChildren(def) : def,
        ]),
      );
    }
  }
  if (Array.isArray(schema.allOf)) {
    result.allOf = schema.allOf.map((part) =>
      isRecord(part) ? withDynamicChildren(part) : part,
    );
  }
  // The values of a record, by any key or by key pattern.
  if (isRecord(schema.additionalProperties)) {
    result.additionalProperties = dynamicProp(schema.additionalProperties);
  }
  if (isRecord(schema.patternProperties)) {
    result.patternProperties = Object.fromEntries(
      Object.entries(schema.patternProperties).map(([pattern, value]) => [
        pattern,
        dynamicProp(value),
      ]),
    );
  }
  for (const key of ["anyOf", "oneOf"] as const) {
    const variants = schema[key];
    if (Array.isArray(variants)) {
      result[key] = variants.map((variant) =>
        isRecord(variant) && !childRefKind(variant)
          ? withDynamicChildren(variant)
          : variant,
      );
    }
  }
  return result;
}

/**
 * The args of a declared function as the catalog states them: the object
 * stays an object, each arg takes a value, a binding or a function call.
 */
function dynamicArgs(schema: GenerativeUIJSONSchema): GenerativeUIJSONSchema {
  return withDynamicChildren(schema);
}

/** One `functions` entry, in the A2UI `FunctionDefinition` shape. */
function functionEntry(
  name: string,
  permissions: A2UIFunctionPermissions,
  parts: {
    description: string | undefined;
    returnType: string;
    args: GenerativeUIJSONSchema;
  },
): GenerativeUIJSONSchema {
  const callers = functionCallers(permissions);
  const allowedCallers: A2UIAllowedCallers =
    callers.renderer && callers.agent
      ? "rendererOrAgent"
      : callers.agent
        ? "agentOnly"
        : "rendererOnly";
  // The metaschema's activation rule has no `required`, so it also matches
  // an entry without the key: the value is always written out.
  // `args` is required only when an arg is.
  const argsRequired = hasRequiredArgs(parts.args);
  return {
    type: "object",
    ...(parts.description ? { description: parts.description } : {}),
    returnType: parts.returnType,
    allowedCallers,
    requiresUserActivation: permissions.requiresUserActivation === true,
    properties: { "@call": { const: name }, args: parts.args },
    required: argsRequired ? ["@call", "args"] : ["@call"],
  };
}

/**
 * True when an empty args object fails the schema: a key is required at
 * its top, in an `allOf` part, or in every variant of an `anyOf` / `oneOf`.
 */
function hasRequiredArgs(schema: unknown): boolean {
  if (!isRecord(schema)) return false;
  if (Array.isArray(schema.required) && schema.required.length > 0) return true;
  if (Array.isArray(schema.allOf) && schema.allOf.some(hasRequiredArgs)) {
    return true;
  }
  for (const key of ["anyOf", "oneOf"] as const) {
    const variants = schema[key];
    if (Array.isArray(variants) && variants.length > 0) {
      if (variants.every(hasRequiredArgs)) return true;
    }
  }
  return false;
}

/**
 * The JSON Schema of the args of a built-in function, from its short
 * TypeScript-like signature (`{ value: number; decimals?: number }`). Each
 * arg takes a literal, a binding or a function call, so a type maps to the
 * A2UI dynamic type; `[name: string]: T` becomes `additionalProperties`.
 *
 * @example
 * ```ts
 * argsSchemaFromSignature("{ value: string; min?: number }");
 * // { type: "object", properties: { value: { $ref: ".../DynamicString" }, min: { $ref: ".../DynamicNumber" } }, required: ["value"], additionalProperties: false }
 * ```
 */
export function argsSchemaFromSignature(
  signature: string,
): GenerativeUIJSONSchema {
  const body = signature.trim().replace(/^\{/, "").replace(/\}$/, "");
  const properties: Record<string, GenerativeUIJSONSchema> = {};
  const required: string[] = [];
  let additionalProperties: GenerativeUIJSONSchema | false = false;
  for (const part of body.split(";")) {
    const field = part.trim();
    if (field === "") continue;
    const index = field.match(/^\[\w+: string\]:\s*(.+)$/);
    if (index) {
      additionalProperties = typeSchema(index[1]);
      continue;
    }
    const named = field.match(/^(\w+)(\?)?:\s*(.+)$/);
    if (!named) continue;
    properties[named[1]] = typeSchema(named[3]);
    if (!named[2]) required.push(named[1]);
  }
  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties,
  };
}

function typeSchema(type: string): GenerativeUIJSONSchema {
  const trimmed = type.trim();
  const alternatives = trimmed.split("|").map((part) => part.trim());
  if (alternatives.length > 1) return { anyOf: alternatives.map(typeSchema) };
  if (trimmed in DYNAMIC_REFS) return { $ref: DYNAMIC_REFS[trimmed] };
  if (trimmed.endsWith("[]")) {
    // The whole list can be bound or computed, like any other arg.
    return {
      anyOf: [
        { type: "array", items: typeSchema(trimmed.slice(0, -2)) },
        { $ref: DATA_BINDING_REF },
        { $ref: FUNCTION_CALL_REF },
      ],
    };
  }
  return { $ref: DYNAMIC_REFS.unknown };
}
