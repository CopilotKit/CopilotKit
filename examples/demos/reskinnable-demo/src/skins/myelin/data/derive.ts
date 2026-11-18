import type {
  Group,
  ItemKind,
  Journey,
  JourneyItem,
  Learner,
  LearnerStatus,
  MyelinState,
} from "./types";

/** Pure derivations shared by pages, the graph, chat cards and readables. */

export const KIND_LABEL: Record<ItemKind, string> = {
  microlesson: "Micro-lesson",
  video: "Video",
  quiz: "Quiz",
  checklist: "Checklist",
  observation: "On-shift observation",
  certification: "Certification",
};

/**
 * Column for each item = the length of the longest prerequisite chain behind
 * it. That turns the dependency graph into left-to-right stages without any
 * stored coordinates, so the agent never has to "place" anything — adding a
 * prerequisite moves the item right on its own.
 */
export function layoutJourney(items: JourneyItem[]): {
  columns: JourneyItem[][];
  depth: Map<string, number>;
} {
  const byId = new Map(items.map((i) => [i.id, i]));
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const visit = (id: string): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0; // defensive: the store refuses cycles
    visiting.add(id);
    const item = byId.get(id);
    const d = item
      ? Math.max(-1, ...item.dependsOn.filter((p) => byId.has(p)).map(visit)) +
        1
      : 0;
    visiting.delete(id);
    depth.set(id, d);
    return d;
  };
  items.forEach((i) => visit(i.id));
  const columns: JourneyItem[][] = [];
  for (const it of items) {
    const d = depth.get(it.id) ?? 0;
    (columns[d] ??= []).push(it);
  }
  return { columns: columns.map((c) => c ?? []), depth };
}

export function totalMinutes(j: Journey): number {
  return j.items.reduce((sum, i) => sum + i.minutes, 0);
}

/** Calendar days from enrolment to the last unlock, following the longest delay chain. */
export function calendarDays(j: Journey): number {
  const byId = new Map(j.items.map((i) => [i.id, i]));
  const memo = new Map<string, number>();
  const at = (id: string, guard = 0): number => {
    if (memo.has(id)) return memo.get(id)!;
    const item = byId.get(id);
    if (!item || guard > 50) return 0;
    const v =
      item.delayDays +
      Math.max(0, ...item.dependsOn.map((p) => at(p, guard + 1)));
    memo.set(id, v);
    return v;
  };
  return Math.max(0, ...j.items.map((i) => at(i.id)));
}

export function groupNames(groups: Group[], ids: string[]): string[] {
  return ids.map((id) => groups.find((g) => g.id === id)?.name ?? id);
}

export function audienceSize(groups: Group[], j: Journey): number {
  return j.audienceGroupIds.reduce(
    (s, id) => s + (groups.find((g) => g.id === id)?.learnerCount ?? 0),
    0,
  );
}

export function relativeTime(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function actorLabel(state: MyelinState, actor: string): string {
  if (actor === "agent") return "Myelin agent";
  return state.admins.find((a) => a.id === actor)?.name ?? actor;
}

export const LEARNER_STATUSES: readonly LearnerStatus[] = [
  "overdue",
  "in-progress",
  "not-started",
  "complete",
];

export const STATUS_LABEL: Record<LearnerStatus, string> = {
  overdue: "Overdue",
  "in-progress": "In progress",
  "not-started": "Not started",
  complete: "Complete",
};

export const LEARNER_SORTS = ["daysOverdue", "percent", "name"] as const;
export type LearnerSort = (typeof LEARNER_SORTS)[number];

export const SORT_LABEL: Record<LearnerSort, string> = {
  daysOverdue: "Most overdue first",
  percent: "Least progress first",
  name: "Name A–Z",
};

export interface LearnerFilters {
  journeyId: string;
  status: LearnerStatus | "all";
  groupId: string | "all";
  sortBy: LearnerSort;
}

export interface LearnerRow {
  learner: Learner;
  status: LearnerStatus;
  percent: number;
  daysOverdue: number;
}

export function learnerRows(
  state: MyelinState,
  f: LearnerFilters,
): LearnerRow[] {
  const rows: LearnerRow[] = [];
  for (const l of state.learners) {
    const p = l.progress[f.journeyId];
    if (!p) continue;
    if (f.status !== "all" && p.status !== f.status) continue;
    if (f.groupId !== "all" && !l.groupIds.includes(f.groupId)) continue;
    rows.push({
      learner: l,
      status: p.status,
      percent: p.percent,
      daysOverdue: p.daysOverdue,
    });
  }
  rows.sort((a, b) =>
    f.sortBy === "daysOverdue"
      ? b.daysOverdue - a.daysOverdue || a.percent - b.percent
      : f.sortBy === "percent"
        ? a.percent - b.percent
        : a.learner.name.localeCompare(b.learner.name),
  );
  return rows;
}
