/**
 * Trajectory export: the scope and filter model shared by the Export screen
 * and `/api/learning/v1/exports`. Pure, so the server and the browser agree on
 * exactly which trajectories a slice holds.
 *
 * A slice is a Learning Space, narrowed to one user, a group of users, or the
 * whole space (every agent that reports into it: the in-app agent and ChatGPT
 * over MCP), then filtered by any number of `field op value` rows.
 */
import type { TrajectorySummary } from "../data/contract";

export interface ExportUser {
  readonly id: string;
  readonly name: string;
  readonly role: string;
}
export interface ExportGroup {
  readonly id: string;
  readonly name: string;
  readonly members: readonly string[];
}
export interface ExportSpace {
  readonly id: string;
  readonly name: string;
  readonly agents: readonly string[];
}

export const USERS: readonly ExportUser[] = [
  { id: "u_maya", name: "Maya Chen", role: "Finance Operations Lead" },
  { id: "u_jordan", name: "Jordan Patel", role: "Controller" },
];
export const GROUPS: readonly ExportGroup[] = [
  {
    id: "grp_finops",
    name: "Finance Operations",
    members: ["u_maya", "u_jordan"],
  },
  { id: "grp_card_admins", name: "Card program admins", members: ["u_maya"] },
  { id: "grp_controllers", name: "Controllers", members: ["u_jordan"] },
];
export const SPACES: readonly ExportSpace[] = [
  {
    id: "ledgerline-expenses",
    name: "Ledgerline Expenses",
    agents: ["Ledgerline agent (in-app)", "ChatGPT via MCP"],
  },
];

export type ScopeKind = "space" | "group" | "user";
export interface ExportScope {
  readonly space: string;
  readonly kind: ScopeKind;
  readonly groupId?: string;
  readonly userId?: string;
}

export type FilterField =
  | "user.id"
  | "outcome"
  | "surface"
  | "title"
  | "lastEventAt"
  | "eventCount";
export type FilterOp = "=" | "!=" | "contains" | ">=" | "<=";
export interface ExportFilter {
  readonly field: FilterField;
  readonly op: FilterOp;
  readonly value: string;
}

export const FIELDS: readonly {
  readonly id: FilterField;
  readonly label: string;
  readonly ops: readonly FilterOp[];
  readonly values?: readonly { readonly id: string; readonly label: string }[];
  readonly input?: "date" | "number" | "text";
}[] = [
  {
    id: "user.id",
    label: "user.id",
    ops: ["=", "!="],
    values: USERS.map((u) => ({ id: u.id, label: `${u.id} · ${u.name}` })),
  },
  {
    id: "outcome",
    label: "outcome",
    ops: ["=", "!="],
    values: [
      {
        id: "agent_failed_user_completed",
        label: "agent_failed_user_completed",
      },
      { id: "agent_succeeded", label: "agent_succeeded" },
      { id: "in_progress", label: "in_progress" },
    ],
  },
  {
    id: "surface",
    label: "surface",
    ops: ["=", "!="],
    values: [
      { id: "in_app", label: "in_app" },
      { id: "chatgpt", label: "chatgpt" },
      { id: "manual", label: "manual" },
    ],
  },
  { id: "title", label: "title", ops: ["contains"], input: "text" },
  {
    id: "lastEventAt",
    label: "last_event_at",
    ops: [">=", "<="],
    input: "date",
  },
  {
    id: "eventCount",
    label: "event_count",
    ops: [">=", "<="],
    input: "number",
  },
];

export const fieldDef = (id: FilterField) =>
  FIELDS.find((f) => f.id === id) ?? FIELDS[0]!;

/** The members a scope covers, or null for the whole space. */
export function scopeMembers(scope: ExportScope): readonly string[] | null {
  if (scope.kind === "user") return scope.userId ? [scope.userId] : [];
  if (scope.kind === "group")
    return GROUPS.find((g) => g.id === scope.groupId)?.members ?? [];
  return null;
}

const dayStart = (iso: string) => new Date(`${iso}T00:00:00`).getTime();
const dayEnd = (iso: string) => new Date(`${iso}T23:59:59.999`).getTime();

function matchesFilter(t: TrajectorySummary, f: ExportFilter): boolean {
  const v = f.value.trim();
  if (!v) return true;
  switch (f.field) {
    case "user.id":
      return f.op === "=" ? t.user.id === v : t.user.id !== v;
    case "outcome":
      return f.op === "=" ? t.outcome === v : t.outcome !== v;
    case "surface": {
      const has = (t.surfaces as readonly string[]).includes(v);
      return f.op === "=" ? has : !has;
    }
    case "title":
      return t.title.toLowerCase().includes(v.toLowerCase());
    case "lastEventAt": {
      if (Number.isNaN(dayStart(v))) return true;
      return f.op === ">="
        ? t.lastEventAt >= dayStart(v)
        : t.lastEventAt <= dayEnd(v);
    }
    case "eventCount": {
      const n = Number(v);
      if (!Number.isFinite(n)) return true;
      return f.op === ">=" ? t.eventCount >= n : t.eventCount <= n;
    }
  }
}

export function matches(
  t: TrajectorySummary,
  scope: ExportScope,
  filters: readonly ExportFilter[],
): boolean {
  const members = scopeMembers(scope);
  if (members && !members.includes(t.user.id)) return false;
  return filters.every((f) => matchesFilter(t, f));
}

const quote = (v: string) => (/^-?\d+(\.\d+)?$/.test(v) ? v : `'${v}'`);

/** The slice as a readable query, the way a data team would write it. */
export function queryText(
  scope: ExportScope,
  filters: readonly ExportFilter[],
): string {
  const clauses = [`space = '${scope.space}'`];
  if (scope.kind === "user" && scope.userId)
    clauses.push(`user.id = '${scope.userId}'`);
  if (scope.kind === "group" && scope.groupId)
    clauses.push(`user.group = '${scope.groupId}'`);
  for (const f of filters) {
    if (!f.value.trim()) continue;
    const label = fieldDef(f.field).label;
    clauses.push(
      f.op === "contains"
        ? `${label} ILIKE '%${f.value.trim()}%'`
        : `${label} ${f.op} ${quote(f.value.trim())}`,
    );
  }
  return `SELECT * FROM trajectories\nWHERE ${clauses.join("\n  AND ")}`;
}

export type ExportFormat = "jsonl" | "parquet" | "csv";
export type DestinationKind =
  | "download"
  | "s3"
  | "gcs"
  | "snowflake"
  | "databricks"
  | "webhook"
  | "api"
  | "mcp";

/** The wire form of a slice, as query params. */
export function sliceParams(
  scope: ExportScope,
  filters: readonly ExportFilter[],
  format: ExportFormat,
): URLSearchParams {
  const p = new URLSearchParams({
    space: scope.space,
    scope: scope.kind,
    format,
  });
  if (scope.groupId) p.set("group", scope.groupId);
  if (scope.userId) p.set("user", scope.userId);
  const live = filters.filter((f) => f.value.trim());
  if (live.length) p.set("q", JSON.stringify(live));
  return p;
}

export function parseSlice(p: URLSearchParams): {
  scope: ExportScope;
  filters: ExportFilter[];
  format: ExportFormat;
} {
  const kind = p.get("scope");
  const format = p.get("format");
  let filters: ExportFilter[] = [];
  try {
    const raw: unknown = JSON.parse(p.get("q") ?? "[]");
    if (Array.isArray(raw))
      filters = raw.filter(
        (f): f is ExportFilter =>
          !!f &&
          typeof f === "object" &&
          FIELDS.some((d) => d.id === (f as ExportFilter).field) &&
          typeof (f as ExportFilter).value === "string",
      );
  } catch {
    filters = [];
  }
  return {
    scope: {
      space: p.get("space") ?? SPACES[0]!.id,
      kind: kind === "group" || kind === "user" ? kind : "space",
      groupId: p.get("group") ?? undefined,
      userId: p.get("user") ?? undefined,
    },
    filters,
    format: format === "parquet" || format === "csv" ? format : "jsonl",
  };
}
