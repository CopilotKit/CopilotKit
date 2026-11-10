/**
 * DOM elements of the A2UI components on screen, by component id.
 * Copied from a2ui-playground `src/lib/node-rects.ts` (+ two helpers from `src/lib/run-store.ts`).
 *
 * Gen UI 2.0 does not hand a component its own id, so the app's components
 * carry only their type (`.a2-node[data-a2-type]`, see catalog.ts). The engine
 * renders the tree depth-first from "root", children in order, so the k-th
 * element of a type in the DOM is the k-th component of that type in a
 * depth-first walk. A template (`{ componentId, path }`) renders its
 * component once per item of the list at `path`; only the first instance is
 * kept. Standard components draw no wrapper, so they have no entry.
 */
type A2UIOp = Record<string, unknown>;
type Comp = { id: string; component: string } & Record<string, unknown>;

/**
 * The components of a surface after its operations: A2UI 1.0
 * `updateComponents` upserts by id, so a Blueprint frame and the component
 * that replaces it are one entry, in the order ids first appeared.
 */
export function latestComponents(ops: A2UIOp[]): Comp[] {
  const byId = new Map<string, Comp>();
  const add = (list: unknown) => {
    if (Array.isArray(list))
      for (const c of list as Comp[])
        if (c && typeof c.id === "string") byId.set(c.id, c);
  };
  for (const op of ops) {
    if (op.createSurface || op.deleteSurface) byId.clear();
    add((op.createSurface as { components?: unknown } | undefined)?.components);
    add(
      (op.updateComponents as { components?: unknown } | undefined)?.components,
    );
  }
  return [...byId.values()];
}

/** The data model of a surface after its operations (`createSurface.dataModel`, then each `updateDataModel`). */
export function latestData(ops: A2UIOp[]): Record<string, unknown> {
  let data: Record<string, unknown> = {};
  for (const op of ops) {
    const create = op.createSurface as
      | { dataModel?: Record<string, unknown> }
      | undefined;
    if (create) data = { ...(create.dataModel ?? {}) };
    const update = op.updateDataModel as
      | { value?: unknown; path?: string }
      | undefined;
    if (!update) continue;
    const segments = (update.path ?? "/").split("/").filter(Boolean);
    if (!segments.length) {
      data =
        update.value && typeof update.value === "object"
          ? { ...(update.value as Record<string, unknown>) }
          : {};
      continue;
    }
    let cur: Record<string, unknown> = data;
    for (const seg of segments.slice(0, -1))
      cur = (cur[seg] =
        cur[seg] && typeof cur[seg] === "object"
          ? { ...(cur[seg] as Record<string, unknown>) }
          : {}) as Record<string, unknown>;
    cur[segments[segments.length - 1]] = update.value;
  }
  return data;
}

function refs(
  c: Comp,
  data: Record<string, unknown>,
): Array<{ id: string; times: number }> {
  const out: Array<{ id: string; times: number }> = [];
  const one = (v: unknown) =>
    typeof v === "string" && out.push({ id: v, times: 1 });
  one(c.child);
  if (Array.isArray(c.children)) c.children.forEach(one);
  else if (c.children && typeof c.children === "object") {
    const t = c.children as { componentId?: unknown; path?: unknown };
    if (typeof t.componentId === "string" && typeof t.path === "string") {
      const list = t.path
        .split("/")
        .filter(Boolean)
        .reduce<unknown>(
          (cur, k) => (cur as Record<string, unknown> | undefined)?.[k],
          data,
        );
      out.push({
        id: t.componentId,
        times: Array.isArray(list) ? list.length : 0,
      });
    }
  }
  for (const k of ["tabs", "items"])
    if (Array.isArray(c[k]))
      for (const it of c[k] as Array<{ child?: unknown }>) one(it?.child);
  return out;
}

/** Measure with `el.firstElementChild.getBoundingClientRect()`: `.a2-node` itself is `display: contents`. */
export function nodeElements(
  host: Element,
  ops: A2UIOp[],
): Map<string, HTMLElement> {
  const components = latestComponents(ops);
  const byId = new Map(components.map((c) => [c.id, c]));
  const data = latestData(ops);
  // Depth-first order of rendered instances: [id, first instance?].
  const order: Array<[string, boolean]> = [];
  const walk = (id: string, first: boolean, seen: Set<string>) => {
    const c = byId.get(id);
    if (!c || seen.has(id)) return;
    order.push([id, first]);
    const next = new Set(seen).add(id);
    for (const r of refs(c, data))
      for (let i = 0; i < r.times; i++) walk(r.id, first && i === 0, next);
  };
  walk("root", true, new Set());
  const queues = new Map<string, HTMLElement[]>();
  for (const el of Array.from(
    host.querySelectorAll<HTMLElement>(".a2-node[data-a2-type]"),
  )) {
    const t = el.dataset.a2Type!;
    queues.set(t, [...(queues.get(t) ?? []), el]);
  }
  const out = new Map<string, HTMLElement>();
  for (const [id, first] of order) {
    const el = queues.get(byId.get(id)!.component)?.shift();
    if (el && first && !out.has(id)) out.set(id, el);
  }
  return out;
}
