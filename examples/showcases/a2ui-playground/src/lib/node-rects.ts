/**
 * DOM elements of the A2UI components on screen, by component id.
 *
 * Gen UI 2.0 does not hand a component its own id, so the playground's
 * components carry only their type (`.a2-node[data-a2-type]`, and
 * `.a2-std[data-a2-type]` for the standard ones; see catalog.ts). The engine
 * renders the tree depth-first from "root", children in order, so the k-th
 * element of a type in the DOM is the k-th component of that type in a
 * depth-first walk. A template (`{ componentId, path }`) renders its
 * component once per item of the list at `path`; only the first instance is
 * kept, like the old per-definition measurement.
 */
import { latestComponents, latestData, type A2UIOp } from "./run-store";

type Comp = { id: string; component: string } & Record<string, unknown>;

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
  // Tooltip renders its trigger and its hidden content in place; Modal only its trigger (the content opens in a portal).
  if (c.component === "Tooltip" || c.component === "Modal") one(c.trigger);
  if (c.component === "Tooltip") one(c.content);
  for (const k of ["tabs", "items"])
    if (Array.isArray(c[k]))
      for (const it of c[k] as Array<{ child?: unknown }>) one(it?.child);
  return out;
}

export function nodeElements(
  host: Element,
  ops: A2UIOp[],
): Map<string, HTMLElement> {
  const components = latestComponents(ops) as Comp[];
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
    host.querySelectorAll<HTMLElement>(
      ".a2-node[data-a2-type], .a2-std[data-a2-type]",
    ),
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

/**
 * The box a component takes on screen. Its marker element is `display: contents` and has no box of its
 * own, so this is the union of the boxes of what it renders (looking through nested markers). Null when
 * nothing it renders has a size.
 */
export function nodeRect(el: Element): DOMRect | null {
  let l = Infinity;
  let t = Infinity;
  let r = -Infinity;
  let b = -Infinity;
  const take = (n: Element) => {
    for (const c of Array.from(n.children)) {
      if (getComputedStyle(c).display === "contents") {
        take(c);
        continue;
      }
      const box = c.getBoundingClientRect();
      if (!box.width && !box.height) continue;
      l = Math.min(l, box.left);
      t = Math.min(t, box.top);
      r = Math.max(r, box.right);
      b = Math.max(b, box.bottom);
    }
  };
  take(el);
  return l === Infinity ? null : new DOMRect(l, t, r - l, b - t);
}
