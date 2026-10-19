import type { GenerativeUIJSONSchema } from "./types";

/**
 * How A2UI 1.0 marks a prop that holds a component reference: the JSON
 * Schema of the prop is a `$ref` to one of these two common types.
 * Validators and renderers find the children of a component by these refs,
 * at any depth of the props schema.
 */
export const A2UI_COMPONENT_ID_REF = "common_types.json#/$defs/ComponentId";
export const A2UI_CHILD_LIST_REF = "common_types.json#/$defs/ChildList";

/**
 * The start of the `description` that marks a schema as a component
 * reference before it is turned into JSON Schema. `child()` and
 * `childList()` set it; a schema from another library can set a description
 * that starts with the same mark to get the same effect. What follows the
 * mark (after a space) stays as the description of the reference.
 */
export const A2UI_COMPONENT_ID_MARK = "@a2ui/ComponentId";
export const A2UI_CHILD_LIST_MARK = "@a2ui/ChildList";

export type ChildRefKind = "single" | "multiple";

/** One component reference in a props schema. */
export interface ChildRef {
  /**
   * The keys from the props root to the reference. `"*"` stands for the
   * items of an array. `["tabs", "*", "child"]` is the `child` of each
   * entry of `tabs`.
   */
  path: readonly string[];
  kind: ChildRefKind;
}

/** The ref kind of a JSON Schema node, or `undefined` for a plain value. */
export function childRefKind(
  schema: GenerativeUIJSONSchema,
): ChildRefKind | undefined {
  const ref = schema.$ref;
  if (ref === A2UI_COMPONENT_ID_REF) return "single";
  if (ref === A2UI_CHILD_LIST_REF) return "multiple";
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Turns the reference marks of a JSON Schema into A2UI `$ref`s, in place of
 * the marked node. The mark is the `description` set by `child()` and
 * `childList()`; after this, the node is `{ "$ref": "common_types.json#/..." }`.
 */
export function applyChildRefMarks(
  schema: GenerativeUIJSONSchema,
): GenerativeUIJSONSchema {
  const marked = (description: unknown, mark: string, ref: string) => {
    if (typeof description !== "string" || !description.startsWith(mark)) {
      return undefined;
    }
    const rest = description.slice(mark.length).trim();
    return rest === "" ? { $ref: ref } : { $ref: ref, description: rest };
  };
  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(visit);
    if (!isRecord(node)) return node;
    const reference =
      marked(node.description, A2UI_COMPONENT_ID_MARK, A2UI_COMPONENT_ID_REF) ??
      marked(node.description, A2UI_CHILD_LIST_MARK, A2UI_CHILD_LIST_REF);
    if (reference) return reference;
    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => [key, visit(value)]),
    );
  };
  return visit(schema) as GenerativeUIJSONSchema;
}

/**
 * Every component reference in a props schema, with its path. Walks
 * `properties`, array `items`, and the variants of `anyOf` / `oneOf` /
 * `allOf`. A reference inside a union is reported once per path.
 */
export function collectChildRefs(schema: GenerativeUIJSONSchema): ChildRef[] {
  const refs: ChildRef[] = [];
  const seen = new Set<string>();
  const visit = (node: unknown, path: string[]) => {
    if (!isRecord(node)) return;
    const kind = childRefKind(node);
    if (kind) {
      const key = path.join("\u0000");
      if (!seen.has(key)) {
        seen.add(key);
        refs.push({ path, kind });
      }
      return;
    }
    for (const list of [node.anyOf, node.oneOf, node.allOf]) {
      if (Array.isArray(list)) list.forEach((variant) => visit(variant, path));
    }
    if (isRecord(node.properties)) {
      for (const [key, value] of Object.entries(node.properties)) {
        visit(value, [...path, key]);
      }
    }
    if (isRecord(node.items)) visit(node.items, [...path, "*"]);
  };
  visit(schema, []);
  return refs;
}

/**
 * Walks `value` along a ref path and replaces what sits at the end with
 * `replace(found)`. Objects and arrays on the way are copied; everything
 * else keeps its identity. Missing keys are left alone.
 */
export function mapAtChildRef(
  value: unknown,
  path: readonly string[],
  replace: (found: unknown) => unknown,
): unknown {
  if (path.length === 0) return replace(value);
  const [head, ...rest] = path;
  if (head === "*") {
    if (!Array.isArray(value)) return value;
    return value.map((item) => mapAtChildRef(item, rest, replace));
  }
  if (!isRecord(value) || !Object.prototype.hasOwnProperty.call(value, head)) {
    return value;
  }
  return { ...value, [head]: mapAtChildRef(value[head], rest, replace) };
}
