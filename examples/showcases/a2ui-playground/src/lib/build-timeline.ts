/**
 * What the recorded stream had on screen at time T, as a pure function of real data.
 *
 * Input: the surface snapshots that really arrived (time + ops) and the current time T.
 * Output: the ops to render, and one part per component id with when it was first seen
 * (its slot) and when its props really arrived (filled). Nothing is paced or invented:
 * the generation animation over the surface is the transitions.dev runtime
 * (src/components/app/use-ui-generation.ts), not this file.
 */
import { latestComponents, type A2UIOp } from "./run-store";

/** Structure stays real as soon as it arrives so the layout is exact; everything else is a leaf. */
export const STRUCTURE = new Set([
  "Column",
  "Row",
  "Grid",
  "Card",
  "Section",
  "List",
  "Tabs",
  "Accordion",
  "Carousel",
]);

export type Snapshot = { t: number; ops: A2UIOp[] };
export type PartState = "pending" | "streaming" | "filled";
export type Part = {
  id: string;
  type: string;
  state: PartState;
  seenAt: number;
  realAt: number | null;
  leaf: boolean;
};
export type Presented = {
  ops: A2UIOp[] | null;
  parts: Part[];
  done: boolean; // the last snapshot is in
  endAt: number; // time of the last snapshot (for players)
  firstAt: number | null; // time of the first snapshot
  events: Array<{
    t: number;
    kind: "frame" | "fill";
    id: string;
    type: string;
  }>;
};

type Comp = { id: string; component: string } & Record<string, unknown>;

/** The surface's components after its operations (A2UI 1.0 upserts by id). */
const componentsOf: (ops: A2UIOp[]) => Comp[] = latestComponents;

const typeOf = (c: Comp) =>
  c.component === "Blueprint" ? String(c.of ?? "") : c.component;

/**
 * @param snaps   snapshots in arrival order (t in ms on any common clock)
 * @param T       current time on the same clock
 */
export function present(snaps: Snapshot[], T: number): Presented {
  const empty: Presented = {
    ops: null,
    parts: [],
    done: false,
    endAt: 0,
    firstAt: null,
    events: [],
  };
  if (!snaps.length) return empty;
  const all = snaps.slice().sort((a, b) => a.t - b.t);
  const lastT = all[all.length - 1].t;

  // When each id first appeared, and when it first arrived as a real component.
  const seenAt = new Map<string, number>();
  const realAt = new Map<string, number>();
  const realType = new Map<string, string>();
  for (const s of all) {
    for (const c of componentsOf(s.ops)) {
      if (!seenAt.has(c.id)) seenAt.set(c.id, s.t);
      if (c.component !== "Blueprint" && !realAt.has(c.id)) {
        realAt.set(c.id, s.t);
        realType.set(c.id, c.component);
      }
    }
  }
  const ids = Array.from(seenAt.keys());
  const events: Presented["events"] = [];
  for (const id of ids) {
    const type = realType.get(id) ?? "";
    events.push({ t: seenAt.get(id)!, kind: "frame", id, type });
    const f = realAt.get(id);
    if (f != null && f !== seenAt.get(id))
      events.push({ t: f, kind: "fill", id, type });
  }
  events.sort((a, b) => a.t - b.t);
  const base = { endAt: lastT, firstAt: all[0].t, events };

  // State at T: exactly the latest snapshot that had arrived.
  const visible = all.filter((s) => s.t <= T);
  if (!visible.length) return { ...empty, ...base };
  const ops = visible[visible.length - 1].ops;
  const parts: Part[] = componentsOf(ops).map((c) => {
    const id = c.id;
    const isReal = c.component !== "Blueprint";
    const state: PartState = isReal
      ? "filled"
      : c.state === "pending"
        ? "pending"
        : "streaming";
    return {
      id,
      type: typeOf(c),
      state,
      seenAt: seenAt.get(id)!,
      realAt: realAt.get(id) ?? null,
      leaf: !STRUCTURE.has(typeOf(c)),
    };
  });
  return { ops, parts, done: T >= lastT, ...base };
}
