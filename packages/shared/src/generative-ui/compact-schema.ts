import { childRefKind } from "./child-refs";
import { functionCallers } from "./basic-functions";
import { GENERATIVE_UI_AGENT_FUNCTION_CALLS } from "./types";
import type { GenerativeUIJSONSchema, GenerativeUIManifest } from "./types";

/** Objects nested deeper than this show as `object`. */
const MAX_OBJECT_DEPTH = 2;

/** A prop must appear verbatim in at least this many components to be hoisted. */
const COMMON_PROP_MIN_COMPONENTS = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A JSON Schema of a list of schemas (`anyOf`, `oneOf`), else an empty list. */
function schemaList(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/**
 * Puts a top-level union in parentheses, so that `[]` applies to all of
 * it. A union inside braces needs none.
 */
function asArrayItem(type: string) {
  let outside = type;
  for (let inner = outside.replace(/\{[^{}]*\}/g, ""); inner !== outside; ) {
    outside = inner;
    inner = outside.replace(/\{[^{}]*\}/g, "");
  }
  return outside.includes(" | ") ? `(${type})[]` : `${type}[]`;
}

/**
 * A JSON Schema as a short TypeScript-like type, for example
 * `{ label: string; size?: "sm" | "md" }`.
 */
function compactType(schema: GenerativeUIJSONSchema, depth: number): string {
  const ref = childRefKind(schema);
  if (ref === "single") return "componentId";
  if (ref === "multiple")
    return "componentId[] | { componentId: string; path: string }";
  if ("const" in schema) return JSON.stringify(schema.const);
  if (Array.isArray(schema.enum)) {
    return schema.enum.map((value) => JSON.stringify(value)).join(" | ");
  }
  const variants = [...schemaList(schema.anyOf), ...schemaList(schema.oneOf)];
  if (variants.length > 0) {
    return variants.map((variant) => compactType(variant, depth)).join(" | ");
  }
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const summaries = types.map((type) => {
    switch (type) {
      case "string":
      case "boolean":
      case "null":
        return type;
      case "number":
      case "integer":
        return "number";
      case "array":
        return isRecord(schema.items)
          ? asArrayItem(compactType(schema.items, depth))
          : "unknown[]";
      case "object":
        return compactObject(schema, depth);
      default:
        return "unknown";
    }
  });
  return summaries.join(" | ");
}

/** An object schema as `{ key: type; other?: type }`. */
function compactObject(schema: GenerativeUIJSONSchema, depth: number) {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const entries = Object.entries(properties);
  if (entries.length === 0) {
    return isRecord(schema.additionalProperties)
      ? `Record<string, ${compactType(schema.additionalProperties, depth + 1)}>`
      : "object";
  }
  if (depth >= MAX_OBJECT_DEPTH) return "object";
  const required = Array.isArray(schema.required) ? schema.required : [];
  const fields = entries.map(([key, value]) => {
    const type = isRecord(value) ? compactType(value, depth + 1) : "unknown";
    return `${key}${required.includes(key) ? "" : "?"}: ${type}`;
  });
  return `{ ${fields.join("; ")} }`;
}

/** A schema as its type, with its description after `//`. */
function describedType(schema: GenerativeUIJSONSchema, depth: number) {
  const type = compactType(schema, depth);
  return typeof schema.description === "string"
    ? `${type} // ${schema.description}`
    : type;
}

/** The props of a component: `{ "label": "string", "size?": "..." }`. */
function compactProps(schema: GenerativeUIJSONSchema) {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  const props: Record<string, string> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!isRecord(value)) continue;
    const name = required.includes(key) ? key : `${key}?`;
    props[name] = describedType(value, 1);
  }
  return props;
}

/**
 * The prop set worth listing once. Candidates are (key, type) pairs that at
 * least {@link COMMON_PROP_MIN_COMPONENTS} components carry verbatim. The
 * candidate subset of each component is a possible common set, scored by
 * the characters it saves (set size times the components that contain all
 * of it). `undefined` when no set is shared by enough components.
 */
function findCommonProps(propsList: Array<Record<string, string>>) {
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

/** One component of the compact schema. */
interface CompactComponent {
  description?: string;
  /** True when the component also takes every prop in `commonProps`. */
  includesCommonProps?: true;
  props: Record<string, string>;
  events?: Record<string, string>;
  slots?: Record<string, "single" | "multiple">;
}

/**
 * The component schema of the markdown transport, from the per-run
 * manifest. It is smaller than the manifest: each prop is one short type,
 * and the props that many components share verbatim (the layout props of
 * the containers) are listed once in `commonProps`; a component that takes
 * them is flagged `includesCommonProps`.
 * It has the catalog id, the targets with their descriptions and their
 * component lists, the functions with their parameters, the components
 * with their props, events and slots, and the surfaces of the thread. A surface lists the
 * values that the user set and the operations that the client dropped.
 *
 * @param manifest - The manifest from `buildGenerativeUIManifest`.
 * @returns A JSON-ready object.
 *
 * @example
 * ```ts
 * const value = JSON.stringify(
 *   buildCompactGenerativeUISchema(buildGenerativeUIManifest(runtime, threadId)),
 * );
 * ```
 */
export function buildCompactGenerativeUISchema(
  manifest: Pick<
    GenerativeUIManifest,
    "catalogId" | "components" | "functions" | "targets" | "surfaces"
  >,
) {
  const components: Record<string, CompactComponent> = {};
  for (const [name, component] of Object.entries(manifest.components)) {
    const events = Object.entries(component.events ?? {}).map(
      ([event, definition]) => [
        event,
        definition.description ?? compactType(definition.parameters, 0),
      ],
    );
    components[name] = {
      ...(component.description ? { description: component.description } : {}),
      props: compactProps(component.props),
      ...(events.length > 0 ? { events: Object.fromEntries(events) } : {}),
      ...(component.slots ? { slots: component.slots } : {}),
    };
  }
  const common = findCommonProps(
    Object.values(components).map((component) => component.props),
  );
  if (common) {
    const commonKeys = Object.keys(common);
    for (const component of Object.values(components)) {
      const includesCommon = commonKeys.every(
        (key) => component.props[key] === common[key],
      );
      if (!includesCommon) continue;
      component.includesCommonProps = true;
      component.props = Object.fromEntries(
        Object.entries(component.props).filter(([key]) => !(key in common)),
      );
    }
  }
  // A built-in function carries its short signature in the description of
  // its parameters (see `builtInFunctionManifests`); an app function gets
  // its JSON Schema made short. A function is for the UI unless it says
  // that the agent may call it too, or only the agent.
  const functions = Object.fromEntries(
    Object.entries(manifest.functions).map(([name, fn]) => {
      const signature = fn.parameters.description;
      const hasSignature =
        typeof signature === "string" &&
        signature.startsWith("{") &&
        Object.keys(fn.parameters).length === 2;
      const callers = functionCallers(fn);
      return [
        name,
        {
          ...(fn.description ? { description: fn.description } : {}),
          parameters: hasSignature ? signature : compactType(fn.parameters, 0),
          ...(callers.agent && GENERATIVE_UI_AGENT_FUNCTION_CALLS
            ? { callers: callers.renderer ? "UI or agent" : "agent only" }
            : {}),
        },
      ];
    }),
  );
  return {
    catalogId: manifest.catalogId,
    targets: manifest.targets,
    functions,
    ...(common ? { commonProps: common } : {}),
    components,
    surfaces: manifest.surfaces,
  };
}
