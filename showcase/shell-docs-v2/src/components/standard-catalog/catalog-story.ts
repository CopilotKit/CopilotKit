import type { TypeNode } from "@fumadocs/story/type-tree";
import { standardUI } from "@copilotkit/react-core/v2/generative-ui";
import { SAMPLES, sampleOperations, type CatalogSample } from "./catalog-data";
import { catalogComponentSlug, catalogPartParent } from "./catalog-reference";

/**
 * A component's story variants, from the catalog's live samples: each node
 * of the component in a sample that covers it is a variant, previewed on its
 * own with the nodes under it. A part (`GridItem`) previews inside its parent
 * (its Grid). The controls are the component's own props from the catalog's
 * manifest, the schema the agent writes against; the sizing and scrolling
 * props most components share stay out of them unless the variant sets one.
 */
export interface CatalogVariant {
  variant: string;
  description: string;
  surfaceId: string;
  sample: CatalogSample;
  /** The node the controls edit. */
  nodeId: string;
  /** The node the preview starts from: the node, or a part's parent. */
  rootId: string;
  initial: Record<string, unknown>;
  controls: TypeNode;
}

type SampleNode = CatalogSample["components"][number];
type JsonSchema = {
  type?: string | string[];
  enum?: unknown[];
  anyOf?: JsonSchema[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
};

export function catalogVariants(name: string): CatalogVariant[] {
  const slug = catalogComponentSlug(name);
  const labels = new Set<string>();
  const nodes = SAMPLES.flatMap((sample) =>
    sample.covers.includes(name)
      ? sample.components
          .filter((node) => node.component === name)
          .map((node) => ({ sample, node }))
      : [],
  );
  return nodes.map(({ sample, node }, index) => {
    const { id, component, ...initial } = node;
    const label =
      textOf(node) ??
      subtree(sample, id).map(textOf).find(Boolean) ??
      lookOf(node) ??
      `${name} ${index + 1}`;
    let variant = label;
    for (let n = 2; labels.has(variant); n++) variant = `${label} (${n})`;
    labels.add(variant);
    return {
      variant,
      description: sample.title,
      surfaceId: `${slug}-${index + 1}`,
      sample,
      nodeId: id,
      rootId: previewRoot(sample, id, component),
      initial,
      controls: controlsFor(name, initial),
    };
  });
}

/**
 * Sizing, scrolling and spacing props that most components share. The
 * controls leave them out, and the props table folds them away.
 */
export const COMMON_PROPS = new Set([
  "weight",
  "flex",
  "width",
  "height",
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
  "minSize",
  "maxSize",
  "aspectRatio",
  "inline",
  "flush",
  "rowGap",
  "columnGap",
  "borderColor",
  "scrollable",
  "clip",
  "shadow",
  "role",
  "disableAutoSpacing",
]);

/** The node a variant edits, as the agent writes it, with `args` as its props. */
export function variantNode(
  variant: CatalogVariant,
  args: Record<string, unknown>,
) {
  const { nodeId, rootId, sample } = variant;
  const component = sample.components.find((node) => node.id === nodeId)!;
  return {
    id: nodeId === rootId ? "root" : nodeId,
    component: component.component,
    ...args,
  };
}

/** The A2UI operations that draw a variant with `args` as the node's props. */
export function variantOperations(
  variant: CatalogVariant,
  args: Record<string, unknown>,
) {
  const { sample, nodeId, rootId, surfaceId } = variant;
  const components = subtree(sample, rootId).map((node) => {
    const props =
      node.id === nodeId
        ? { ...args, id: node.id, component: node.component }
        : node;
    return node.id === rootId ? { ...props, id: "root" } : props;
  });
  return sampleOperations({ ...sample, components }, surfaceId, standardUI.id);
}

/* ---------- the tree of a sample ---------- */

/** The ids a node points at: its children, slots, tab panels, cell components. */
function references(node: SampleNode, ids: Set<string>): string[] {
  const out: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string") {
      if (ids.has(value)) out.push(value);
    } else if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (value && typeof value === "object") {
      Object.values(value).forEach(walk);
    }
  };
  // A component's type name is not a reference, even when an id matches it.
  const { id, component: _type, ...props } = node;
  walk(props);
  return out.filter((ref) => ref !== id);
}

function subtree(sample: CatalogSample, rootId: string): SampleNode[] {
  const ids = new Set(sample.components.map((node) => node.id));
  const byId = new Map(sample.components.map((node) => [node.id, node]));
  const seen = new Set<string>();
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(...references(byId.get(id)!, ids));
  }
  // Root first, then the sample's own order.
  return [
    byId.get(rootId)!,
    ...sample.components.filter((n) => n.id !== rootId && seen.has(n.id)),
  ];
}

function previewRoot(sample: CatalogSample, id: string, component: string) {
  const parent = catalogPartParent(component);
  if (!parent) return id;
  const ids = new Set(sample.components.map((node) => node.id));
  const parentOf = new Map<string, SampleNode>();
  for (const node of sample.components)
    for (const ref of references(node, ids)) parentOf.set(ref, node);
  for (let node = parentOf.get(id); node; node = parentOf.get(node.id))
    if (node.component === parent) return node.id;
  return sample.components[0].id;
}

// A variant's name: its own text, else the first text inside it (a Card's
// title), else the prop that sets its look.
const textOf = (node: SampleNode) =>
  firstString(node, ["label", "text", "title", "name"]);
const lookOf = (node: SampleNode) =>
  firstString(node, ["variant", "chartType"]);

function firstString(node: SampleNode, keys: string[]) {
  for (const key of keys) {
    const value = node[key];
    if (typeof value === "string" && value.trim()) {
      const text = value.trim().replace(/\s+/g, " ");
      return text.length > 40 ? `${text.slice(0, 39)}…` : text;
    }
  }
}

/* ---------- controls from the manifest ---------- */

/**
 * The component's own props as story controls, the ones the variant sets
 * first. A prop the variant binds to the data model (`{ "@path": "/on" }`)
 * can stay a binding or take a value; a function call shows as is.
 */
function controlsFor(name: string, initial: Record<string, unknown>): TypeNode {
  const schema = standardUI.manifestComponents[name]?.props as
    | JsonSchema
    | undefined;
  const properties = Object.entries(schema?.properties ?? {});
  const required = new Set(schema?.required ?? []);
  const set = (key: string) => (key in initial ? 0 : 1);
  return {
    type: "object",
    properties: properties
      .filter(([key]) => key in initial || !COMMON_PROPS.has(key))
      .sort(([a], [b]) => set(a) - set(b))
      .map(([key, prop]) => ({
        name: key,
        type: valueNode(prop, initial[key]),
        required: required.has(key),
      })),
  };
}

function valueNode(schema: JsonSchema, value: unknown): TypeNode {
  if (value && typeof value === "object" && "@call" in value)
    return { type: "unknown", displayName: "function call" };
  if (value && typeof value === "object" && "@path" in value)
    return {
      type: "union",
      types: [
        {
          type: "object",
          displayName: "binding",
          properties: [
            { name: "@path", type: { type: "string" }, required: true },
          ],
        },
        toNode(schema),
      ],
    };
  return toNode(schema);
}

function toNode(schema: JsonSchema | undefined): TypeNode {
  if (!schema) return { type: "unknown" };
  if (Array.isArray(schema.enum))
    return {
      type: "enum",
      members: schema.enum.map((value) => ({ label: String(value), value })),
    };
  if (schema.anyOf) return union(schema.anyOf.map(toNode));
  const types = [schema.type ?? []].flat();
  if (types.length > 1)
    return union(types.map((type) => toNode({ ...schema, type })));
  switch (types[0]) {
    case "string":
      return { type: "string" };
    case "number":
    case "integer":
      return { type: "number" };
    case "boolean":
      return { type: "boolean" };
    case "null":
      return { type: "null" };
    case "array": {
      const element = toNode(schema.items);
      // Free-form items can't be edited, or added as blanks.
      return element.type === "unknown"
        ? { type: "unknown", displayName: "array" }
        : { type: "array", elementType: element };
    }
    case "object":
      return schema.properties
        ? {
            type: "object",
            properties: Object.entries(schema.properties).map(
              ([key, prop]) => ({
                name: key,
                type: toNode(prop),
                required: (schema.required ?? []).includes(key),
              }),
            ),
          }
        : { type: "unknown", displayName: "object" };
  }
  return { type: "unknown" };
}

function union(types: TypeNode[]): TypeNode {
  return types.length === 1 ? types[0] : { type: "union", types };
}
