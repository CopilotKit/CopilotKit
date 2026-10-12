/**
 * Trajectory export, server side. SERVER-ONLY. Reads today's captured
 * trajectories from the learning store (read-only) plus the seeded history,
 * applies a slice (./model.ts), and renders it as plain data: one JSONL record
 * per trajectory with every Thread's AG-UI events, the product events and the
 * network requests; a CSV summary; or the Parquet schema those land in.
 *
 * Deliveries to a bucket, warehouse or webhook are recorded, not sent: the
 * demo has nowhere to write to, so a delivery returns the object paths it
 * would have written.
 */
import * as store from "@/skins/ledgerline/learning/store";
import { withAguiEvents } from "../agui/synthesize";
import { SEED_DETAILS } from "../seed/history";
import type { TrajectoryDetail, TrajectorySummary } from "../data/contract";
import { GROUPS, SPACES, USERS, matches, queryText } from "./model";
import type {
  DestinationKind,
  ExportFilter,
  ExportFormat,
  ExportScope,
} from "./model";

export const SCHEMA = "copilotkit.trajectory.v1";

function allDetails(): TrajectoryDetail[] {
  const live = store
    .listTrajectories()
    .map(
      (t) => store.trajectoryDetail(t.trajectoryId) as TrajectoryDetail | null,
    )
    .filter((d): d is TrajectoryDetail => d !== null);
  const ids = new Set(live.map((d) => d.trajectory.trajectoryId));
  return [
    ...live,
    ...SEED_DETAILS.filter((d) => !ids.has(d.trajectory.trajectoryId)),
  ].sort((a, b) => b.trajectory.lastEventAt - a.trajectory.lastEventAt);
}

export function slice(scope: ExportScope, filters: readonly ExportFilter[]) {
  return allDetails().filter((d) => matches(d.trajectory, scope, filters));
}

const isNetwork = (name: string) => name === "network";

/** One trajectory as a self-contained JSONL record. */
export function record(
  detail: TrajectoryDetail,
  space: string,
  exportedAt: number,
) {
  const withAgui = withAguiEvents(detail);
  const product = detail.events.filter((e) => !isNetwork(e.event.name));
  const network = detail.events.filter((e) => isNetwork(e.event.name));
  return {
    schema: SCHEMA,
    exportedAt: new Date(exportedAt).toISOString(),
    space,
    trajectory: detail.trajectory,
    threads: withAgui.threads.map((t) => ({
      threadId: t.threadId,
      surface: t.surface,
      transport: t.surface === "chatgpt" ? "mcp" : "ag-ui",
      outcome: t.outcome,
      messages: t.messages,
      aguiEvents: t.aguiEvents.map((e) => e.event),
    })),
    productEvents: product.map((e) => ({
      eventId: e.eventId,
      position: e.position,
      ...e.event,
    })),
    networkRequests: network.map((e) => ({
      eventId: e.eventId,
      position: e.position,
      timestamp: e.event.timestamp,
      ...e.event.value,
    })),
    missingContext: detail.missingContext,
  };
}

export type ExportRecord = ReturnType<typeof record>;

const CSV_COLUMNS = [
  "trajectory_id",
  "title",
  "user_id",
  "user_name",
  "outcome",
  "surfaces",
  "thread_count",
  "agui_event_count",
  "product_event_count",
  "network_request_count",
  "first_event_at",
  "last_event_at",
] as const;

const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

export function csv(records: readonly ExportRecord[]): string {
  const rows = records.map((r) =>
    [
      r.trajectory.trajectoryId,
      r.trajectory.title,
      r.trajectory.user.id,
      r.trajectory.user.name,
      r.trajectory.outcome,
      r.trajectory.surfaces.join("|"),
      r.threads.length,
      r.threads.reduce((n, t) => n + t.aguiEvents.length, 0),
      r.productEvents.length,
      r.networkRequests.length,
      new Date(r.trajectory.firstEventAt).toISOString(),
      new Date(r.trajectory.lastEventAt).toISOString(),
    ]
      .map(csvCell)
      .join(","),
  );
  return [CSV_COLUMNS.join(","), ...rows].join("\n");
}

/** The Parquet layout a delivery writes: one row per event, partitioned by day. */
export const PARQUET_SCHEMA: readonly {
  name: string;
  type: string;
  note: string;
}[] = [
  {
    name: "trajectory_id",
    type: "STRING",
    note: "Joins every row of one trajectory",
  },
  { name: "space", type: "STRING", note: "Learning Space" },
  {
    name: "user_id",
    type: "STRING",
    note: "Your user id, as the app reported it",
  },
  { name: "thread_id", type: "STRING", note: "Null for product events" },
  { name: "surface", type: "STRING", note: "in_app, chatgpt or manual" },
  { name: "source", type: "STRING", note: "agui, product or network" },
  { name: "seq", type: "INT64", note: "Order within the trajectory" },
  {
    name: "event_type",
    type: "STRING",
    note: "TOOL_CALL_START, click, network...",
  },
  { name: "event_ts", type: "TIMESTAMP(ms, UTC)", note: "When it happened" },
  { name: "payload", type: "JSON", note: "The full event, unchanged" },
  { name: "event_date", type: "DATE", note: "Partition key" },
];

export function stats(records: readonly ExportRecord[]) {
  const agui = records.reduce(
    (n, r) => n + r.threads.reduce((m, t) => m + t.aguiEvents.length, 0),
    0,
  );
  const product = records.reduce((n, r) => n + r.productEvents.length, 0);
  const network = records.reduce((n, r) => n + r.networkRequests.length, 0);
  const threads = records.reduce((n, r) => n + r.threads.length, 0);
  const jsonlBytes = records.reduce(
    (n, r) => n + JSON.stringify(r).length + 1,
    0,
  );
  return {
    trajectories: records.length,
    threads,
    aguiEvents: agui,
    productEvents: product,
    networkRequests: network,
    eventRows: agui + product + network,
    users: [...new Set(records.map((r) => r.trajectory.user.id))],
    surfaces: [...new Set(records.flatMap((r) => r.trajectory.surfaces))],
    bytes: {
      jsonl: jsonlBytes,
      csv: csv(records).length,
      // Columnar and compressed: roughly a fifth of the raw JSON.
      parquet: Math.round(jsonlBytes * 0.19),
    },
  };
}

export function preview(
  scope: ExportScope,
  filters: readonly ExportFilter[],
  format: ExportFormat,
) {
  const now = Date.now();
  const details = slice(scope, filters);
  const records = details.map((d) => record(d, scope.space, now));
  return {
    query: queryText(scope, filters),
    scope,
    format,
    ...stats(records),
    rows: details.map((d) => d.trajectory) as TrajectorySummary[],
    sample: records[0] ?? null,
    csvSample: csv(records.slice(0, 6)),
    parquetSchema: PARQUET_SCHEMA,
  };
}

export function body(
  scope: ExportScope,
  filters: readonly ExportFilter[],
  format: "jsonl" | "csv",
): string {
  const now = Date.now();
  const records = slice(scope, filters).map((d) => record(d, scope.space, now));
  return format === "csv"
    ? `${csv(records)}\n`
    : `${records.map((r) => JSON.stringify(r)).join("\n")}\n`;
}

// ── Deliveries ───────────────────────────────────────────────────────────

export interface ExportJob {
  id: string;
  at: number;
  query: string;
  scopeLabel: string;
  format: ExportFormat;
  destination: DestinationKind;
  uri: string;
  trajectories: number;
  rows: number;
  bytes: number;
  objects: string[];
  status: "delivered";
  seeded?: boolean;
}

const KEY = Symbol.for("ledgerline.intelligence.exports.v1");
type Pinned = typeof globalThis & { [KEY]?: { jobs: ExportJob[]; n: number } };
function jobs() {
  const g = globalThis as Pinned;
  g[KEY] ??= { jobs: [], n: 4101 };
  return g[KEY]!;
}

const DAY = 86_400_000;
function seededJobs(): ExportJob[] {
  const now = Date.now();
  return [
    {
      id: "exp_4098",
      at: now - 3 * DAY - 5 * 3_600_000,
      query:
        "SELECT * FROM trajectories\nWHERE space = 'ledgerline-expenses'\n  AND outcome = 'agent_failed_user_completed'",
      scopeLabel: "Ledgerline Expenses · all agents",
      format: "parquet",
      destination: "snowflake",
      uri: "HALCYON_ANALYTICS.AGENT.TRAJECTORY_EVENTS",
      trajectories: 4,
      rows: 186,
      bytes: 41_820,
      objects: ["HALCYON_ANALYTICS.AGENT.TRAJECTORY_EVENTS (186 rows merged)"],
      status: "delivered",
      seeded: true,
    },
    {
      id: "exp_4091",
      at: now - 9 * DAY - 2 * 3_600_000,
      query: "SELECT * FROM trajectories\nWHERE space = 'ledgerline-expenses'",
      scopeLabel: "Ledgerline Expenses · all agents",
      format: "jsonl",
      destination: "s3",
      uri: "s3://halcyon-ml-data/ledgerline/trajectories/",
      trajectories: 5,
      rows: 5,
      bytes: 96_412,
      objects: [
        "s3://halcyon-ml-data/ledgerline/trajectories/dt=2026-09-25/part-0000.jsonl",
      ],
      status: "delivered",
      seeded: true,
    },
  ];
}

/** Forget this session's exports (the demo's Reset); the seeded two stay. */
export function clearJobs(): void {
  jobs().jobs = [];
}

export function history(): ExportJob[] {
  return [...jobs().jobs, ...seededJobs()].sort((a, b) => b.at - a.at);
}

export function scopeLabel(scope: ExportScope): string {
  const space = SPACES.find((s) => s.id === scope.space)?.name ?? scope.space;
  if (scope.kind === "user")
    return `${space} · ${USERS.find((u) => u.id === scope.userId)?.name ?? scope.userId}`;
  if (scope.kind === "group")
    return `${space} · ${GROUPS.find((g) => g.id === scope.groupId)?.name ?? scope.groupId}`;
  return `${space} · all agents`;
}

const EXT: Record<ExportFormat, string> = {
  jsonl: "jsonl",
  parquet: "parquet",
  csv: "csv",
};

export function deliver(input: {
  scope: ExportScope;
  filters: readonly ExportFilter[];
  format: ExportFormat;
  destination: DestinationKind;
  uri: string;
}): ExportJob {
  const p = preview(input.scope, input.filters, input.format);
  const state = jobs();
  const day = new Date().toISOString().slice(0, 10);
  const base = input.uri.replace(/\/+$/, "");
  const parts = Math.max(1, Math.ceil(p.trajectories / 50));
  const rows = input.format === "parquet" ? p.eventRows : p.trajectories;
  const objects =
    input.destination === "snowflake" || input.destination === "databricks"
      ? [`${input.uri} (${rows} rows merged)`]
      : input.destination === "webhook"
        ? [`POST ${input.uri} · ${p.trajectories} records · 200 OK`]
        : Array.from(
            { length: parts },
            (_, i) =>
              `${base}/dt=${day}/part-${String(i).padStart(4, "0")}.${EXT[input.format]}`,
          );
  const job: ExportJob = {
    id: `exp_${state.n++}`,
    at: Date.now(),
    query: p.query,
    scopeLabel: scopeLabel(input.scope),
    format: input.format,
    destination: input.destination,
    uri: input.uri,
    trajectories: p.trajectories,
    rows,
    bytes: p.bytes[input.format],
    objects,
    status: "delivered",
  };
  state.jobs.unshift(job);
  return job;
}
