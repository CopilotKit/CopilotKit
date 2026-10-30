/**
 * A2UI macros.
 *
 * A macro is a high-level component the model writes in one call, such as
 * `FlightCard(...)`, that the server expands into standard components before
 * anything reaches the client. The client never sees the macro and needs no
 * code for it: it renders plain A2UI 1.0 primitives.
 *
 * This follows the design of the A2UI Python SDK's `MacroExpander`:
 *  - macro schemas join the catalog the model reads (the inference catalog);
 *  - outbound operations are expanded recursively (at most 16 levels deep);
 *  - the expansion's root keeps the macro's own id, so parents, templates and
 *    later updates still find it, and every other node is named
 *    `${id}__${type}_${n}` (ID stitching);
 *  - a macro may load its own data: the model writes `WeatherReport("Lisbon")`
 *    and the macro fetches the forecast.
 *
 * Arguments may be literals or A2UI dynamic values (`{"@path"}`,
 * `{"@call"}`), so a macro also works as the repeated component of a template.
 */
import type { z } from "zod";

export type Dynamic = { "@path": string } | { "@call": string; args?: Record<string, unknown> };
export type Value<T> = T | Dynamic;

/** One node of an expansion tree. `children` are nested nodes, or ids of components the model wrote. */
export type MacroNode = { component: string; children?: Array<MacroNode | string>; [prop: string]: unknown };

export type FlatNode = { id: string; component: string; [prop: string]: unknown };

export const isDynamic = (v: unknown): v is Dynamic => typeof v === "object" && v !== null && ("@path" in v || "@call" in v);

/** Builds an expansion tree: `h("Row", { gap: 2 }, h("Icon", { name: "plane" }), title)`. Falsy children are skipped. */
export function h(component: string, props: Record<string, unknown> = {}, ...children: Array<MacroNode | string | false | null | undefined>): MacroNode {
  const kids = children.filter((c): c is MacroNode | string => !!c);
  const clean = Object.fromEntries(Object.entries(props).filter(([, v]) => v !== undefined));
  return kids.length ? { component, ...clean, children: kids } : { component, ...clean };
}

export type MacroDefinition<Props extends z.ZodRawShape = z.ZodRawShape, Data = undefined> = {
  name: string;
  /** What the model reads: when to use it. */
  description: string;
  props: z.ZodObject<Props>;
  /** Events the macro forwards to a component inside it, declared like a component's events. */
  events?: Record<string, { description: string; parameters?: z.ZodTypeAny }>;
  /** Loads the data the macro shows. Server-side only. */
  load?: (props: Record<string, unknown>) => Promise<Data>;
  /** Pure: props (and loaded data) to a tree of standard components. */
  expand: (props: Record<string, unknown>, data: Data) => MacroNode;
};

export const defineMacro = <P extends z.ZodRawShape, D = undefined>(m: MacroDefinition<P, D>) => m as unknown as MacroDefinition;

export type Expansion = { id: string; macro: string; components: number };

const MAX_DEPTH = 16;

/** Flattens a tree into A2UI nodes. The root takes `id`; the rest are `${id}__${type}_${n}`. */
export function flatten(id: string, tree: MacroNode): FlatNode[] {
  const out: FlatNode[] = [];
  const counters = new Map<string, number>();
  const walk = (node: MacroNode, nodeId: string) => {
    const { children, ...props } = node;
    const flat: FlatNode = { id: nodeId, ...props, component: node.component };
    out.push(flat);
    if (!children) return;
    const ids: string[] = [];
    const nested: Array<[MacroNode, string]> = [];
    for (const c of children) {
      if (typeof c === "string") ids.push(c);
      else {
        const type = c.component.toLowerCase();
        const n = (counters.get(type) ?? 0) + 1;
        counters.set(type, n);
        const childId = `${id}__${type}_${n}`;
        ids.push(childId);
        nested.push([c, childId]);
      }
    }
    flat.children = ids;
    for (const [c, childId] of nested) walk(c, childId);
  };
  walk(tree, id);
  return out;
}

export class MacroExpander {
  private readonly byName: Map<string, MacroDefinition>;
  constructor(readonly macros: MacroDefinition[]) {
    this.byName = new Map(macros.map((m) => [m.name, m]));
  }

  isMacro(component: unknown): component is string {
    return typeof component === "string" && this.byName.has(component);
  }

  get names() {
    return [...this.byName.keys()];
  }

  /** Expands every macro in a flat component list. Data macros load in parallel. */
  async expand(components: FlatNode[], depth = 0): Promise<Expanded> {
    if (depth > MAX_DEPTH) throw new Error(`Macro expansion went deeper than ${MAX_DEPTH} levels`);
    const trees = await Promise.all(
      components.map(async (c) => {
        if (!this.isMacro(c.component)) return null;
        const m = this.byName.get(c.component)!;
        const args = argsOf(c);
        return flatten(c.id, m.expand(args, m.load ? await m.load(args) : undefined));
      }),
    );
    const step = splice(components, trees);
    if (!step.expanded.length) return step;
    // An expansion may itself use a macro.
    const rest = await this.expand(step.components, depth + 1);
    return { components: rest.components, expanded: [...step.expanded, ...rest.expanded] };
  }

  /** The same for macros with no `load`, with no await: usable while rendering. */
  expandSync(components: FlatNode[], depth = 0): Expanded {
    if (depth > MAX_DEPTH) throw new Error(`Macro expansion went deeper than ${MAX_DEPTH} levels`);
    const trees = components.map((c) => {
      if (!this.isMacro(c.component)) return null;
      const m = this.byName.get(c.component)!;
      if (m.load) throw new Error(`${m.name} loads data, so it must be expanded on the server`);
      return flatten(c.id, m.expand(argsOf(c), undefined));
    });
    const step = splice(components, trees);
    if (!step.expanded.length) return step;
    const rest = this.expandSync(step.components, depth + 1);
    return { components: rest.components, expanded: [...step.expanded, ...rest.expanded] };
  }
}

export type Expanded = { components: FlatNode[]; expanded: Expansion[] };

/** Puts each macro's flat expansion where the macro was. */
function splice(components: FlatNode[], trees: Array<FlatNode[] | null>): Expanded {
  const expanded: Expansion[] = [];
  const next = components.flatMap((c, i) => {
    const out = trees[i];
    if (!out) return [c];
    expanded.push({ id: c.id, macro: c.component, components: out.length });
    return out;
  });
  return { components: expanded.length ? next : components, expanded };
}

function argsOf(c: FlatNode) {
  const { id: _id, component: _component, ...args } = c;
  void _id;
  void _component;
  return args;
}

/* ───────────── helpers for macro authors ───────────── */

/** A literal stays a literal; a bound value becomes an expression the renderer evaluates. */
export function derive(value: unknown, literal: (v: never) => unknown, expression: string, name = "v"): unknown {
  if (value === undefined) return undefined;
  if (isDynamic(value)) return { "@call": "calc", args: { expression, [name]: value } };
  return literal(value as never);
}

/** `true` when the prop was given (a literal that is not empty, or any dynamic value). */
export const given = (v: unknown) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length);
