"use client";

/**
 * Data export: every trajectory as plain data. Pick a slice of a Learning Space
 * (one user, a group, or every agent that reports into it), narrow it with
 * filter rows, see the raw record, then download it or deliver it to a bucket,
 * warehouse or webhook. Backed by `/api/learning/v1/exports`.
 */
import { useCallback, useMemo, useState } from "react";
import type { TrajectorySummary } from "../data/contract";
import { downloadFile } from "../data/client";
import {
  FIELDS,
  GROUPS,
  SPACES,
  USERS,
  fieldDef,
  sliceParams,
} from "../export/model";
import type {
  DestinationKind,
  ExportFilter,
  ExportFormat,
  ExportScope,
  FilterField,
  FilterOp,
  ScopeKind,
} from "../export/model";
import { useLearningRequest } from "../learning/use-learning-request";
import { Badge, StatusMessage } from "../ui/feedback";
import { Input, Select, Switch } from "../ui/forms";
import { Button } from "../ui/primitives";
import { CopyButton } from "../ui/data-display/copy-button";
import {
  IntelligenceShell,
  INTELLIGENCE_BASE,
} from "../shell/intelligence-shell";
import { WorkspacePageHeader } from "../shell/workspace-page-header";
import { OutcomeBadges } from "./trajectories-screen";
import { fmtDate, fmtTime, surfaceName } from "./trajectory-format";
import s from "./export-screen.module.css";

const API = "/api/learning/v1/exports";

interface ExportRecordView {
  readonly schema: string;
  readonly trajectory: TrajectorySummary;
  readonly threads: readonly {
    readonly threadId: string;
    readonly surface: string;
    readonly transport: string;
    readonly aguiEvents: readonly Record<string, unknown>[];
    readonly [k: string]: unknown;
  }[];
  readonly productEvents: readonly Record<string, unknown>[];
  readonly networkRequests: readonly Record<string, unknown>[];
  readonly [k: string]: unknown;
}
interface Preview {
  readonly query: string;
  readonly trajectories: number;
  readonly threads: number;
  readonly aguiEvents: number;
  readonly productEvents: number;
  readonly networkRequests: number;
  readonly eventRows: number;
  readonly users: readonly string[];
  readonly surfaces: readonly string[];
  readonly bytes: Record<ExportFormat, number>;
  readonly rows: readonly TrajectorySummary[];
  readonly sample: ExportRecordView | null;
  readonly csvSample: string;
  readonly parquetSchema: readonly {
    name: string;
    type: string;
    note: string;
  }[];
}
interface ExportJob {
  readonly id: string;
  readonly at: number;
  readonly scopeLabel: string;
  readonly format: ExportFormat;
  readonly destination: DestinationKind;
  readonly uri: string;
  readonly trajectories: number;
  readonly rows: number;
  readonly bytes: number;
  readonly objects: readonly string[];
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { cache: "no-store", signal });
  const body = (await res.json()) as T & { message?: string };
  if (!res.ok) throw new Error(body.message ?? `${res.status}`);
  return body;
}

const FORMATS: readonly {
  id: ExportFormat;
  name: string;
  ext: string;
  blurb: string;
}[] = [
  {
    id: "jsonl",
    name: "Raw trajectories",
    ext: "JSONL",
    blurb:
      "One trajectory per line, complete: every AG-UI event, product event and network request.",
  },
  {
    id: "parquet",
    name: "Event table",
    ext: "Parquet",
    blurb:
      "One row per event, partitioned by day. Ready for Snowflake, BigQuery or Databricks.",
  },
  {
    id: "csv",
    name: "Summary",
    ext: "CSV",
    blurb: "One row per trajectory: user, outcome, surfaces and event counts.",
  },
];

const DESTINATIONS: readonly {
  id: DestinationKind;
  name: string;
  logo?: string;
  icon?: string;
  uri: string;
  uriLabel: string;
}[] = [
  { id: "download", name: "Download", icon: "download", uri: "", uriLabel: "" },
  {
    id: "s3",
    name: "Amazon S3",
    logo: "/intelligence-ui/logos/amazons3.svg",
    uri: "s3://halcyon-ml-data/ledgerline/trajectories/",
    uriLabel: "Bucket prefix",
  },
  {
    id: "gcs",
    name: "Cloud Storage",
    logo: "/intelligence-ui/logos/googlecloudstorage.svg",
    uri: "gs://halcyon-ml-data/ledgerline/trajectories/",
    uriLabel: "Bucket prefix",
  },
  {
    id: "snowflake",
    name: "Snowflake",
    logo: "/intelligence-ui/logos/snowflake.svg",
    uri: "HALCYON_ANALYTICS.AGENT.TRAJECTORY_EVENTS",
    uriLabel: "Table",
  },
  {
    id: "databricks",
    name: "Databricks",
    logo: "/intelligence-ui/logos/databricks.svg",
    uri: "main.agent_data.trajectory_events",
    uriLabel: "Unity Catalog table",
  },
  {
    id: "webhook",
    name: "Webhook",
    icon: "webhook",
    uri: "https://data.halcyonlabs.com/hooks/trajectories",
    uriLabel: "Endpoint",
  },
];

const PRESETS: readonly { label: string; filters: ExportFilter[] }[] = [
  {
    label: "Agent failed, person finished",
    filters: [
      { field: "outcome", op: "=", value: "agent_failed_user_completed" },
    ],
  },
  {
    label: "ChatGPT via MCP",
    filters: [{ field: "surface", op: "=", value: "chatgpt" }],
  },
  {
    label: "Last 7 days",
    filters: [
      {
        field: "lastEventAt",
        op: ">=",
        value: new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10),
      },
    ],
  },
];

const SCOPES: readonly {
  id: ScopeKind;
  name: string;
  icon: string;
  blurb: string;
}[] = [
  {
    id: "space",
    name: "Entire space",
    icon: "hub",
    blurb: "Every user, every agent",
  },
  { id: "group", name: "A group", icon: "groups", blurb: "Users you group" },
  { id: "user", name: "One user", icon: "person", blurb: "A single user id" },
];

const kb = (n: number) =>
  n >= 1_048_576
    ? `${(n / 1_048_576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(n / 1024))} KB`;
const num = (n: number) => n.toLocaleString("en-US");

/** The sample record, with each Thread's AG-UI stream cut to its first events. */
function sampleText(rec: ExportRecordView, keep: number): string {
  const cut = {
    ...rec,
    threads: rec.threads.map((t) => ({
      ...t,
      aguiEvents: t.aguiEvents.slice(0, keep),
    })),
    productEvents: rec.productEvents.slice(0, keep),
  };
  return JSON.stringify(cut, null, 2);
}

function Icon(props: { readonly name: string; readonly className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`material-symbols-rounded ${props.className ?? s.icon}`}
    >
      {props.name}
    </span>
  );
}

export function ExportScreen() {
  const [scope, setScope] = useState<ExportScope>({
    space: SPACES[0]!.id,
    kind: "space",
    groupId: GROUPS[0]!.id,
    userId: USERS[0]!.id,
  });
  const [filters, setFilters] = useState<ExportFilter[]>([]);
  const [format, setFormat] = useState<ExportFormat>("jsonl");
  const [dest, setDest] = useState<DestinationKind>("download");
  const [uri, setUri] = useState("");
  const [sync, setSync] = useState(false);
  const [phase, setPhase] = useState<"idle" | "working">("idle");
  // A result belongs to the slice and destination it was made for (`key`).
  const [result, setDone] = useState<
    | {
        key: string;
        kind: "download";
        file: string;
        count: number;
        bytes: number;
      }
    | { key: string; kind: "job"; job: ExportJob }
    | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [historyTick, setHistoryTick] = useState(0);

  const params = useMemo(
    () => sliceParams(scope, filters, format).toString(),
    [scope, filters, format],
  );
  const loadPreview = useCallback(
    (signal: AbortSignal) => getJson<Preview>(`${API}?${params}`, signal),
    [params],
  );
  const preview = useLearningRequest(loadPreview);
  const loadHistory = useCallback(
    (signal: AbortSignal) =>
      getJson<ExportJob[]>(`${API}/history?t=${historyTick}`, signal),
    [historyTick],
  );
  const history = useLearningRequest(loadHistory);

  // Keep the last good preview on screen while the next one loads.
  const [shown, setShown] = useState<Preview | null>(null);
  if (preview.status === "ready" && preview.data !== shown)
    setShown(preview.data);

  const destination = DESTINATIONS.find((d) => d.id === dest)!;
  const key = `${params}|${dest}`;
  const done = result?.key === key ? result : null;

  const parquetDownload = dest === "download" && format === "parquet";
  const count = shown?.trajectories ?? 0;

  const setFilter = (i: number, patch: Partial<ExportFilter>) =>
    setFilters((fs) =>
      fs.map((f, j) => {
        if (j !== i) return f;
        const next = { ...f, ...patch };
        if (patch.field) {
          const def = fieldDef(patch.field);
          next.op = def.ops[0]!;
          next.value = def.values?.[0]?.id ?? "";
        }
        return next;
      }),
    );
  const addFilter = (f?: ExportFilter) =>
    setFilters((fs) => [
      ...fs,
      f ?? { field: "outcome", op: "=", value: "agent_failed_user_completed" },
    ]);

  const runExport = async () => {
    setError(null);
    setDone(null);
    setPhase("working");
    try {
      if (dest === "download") {
        const res = await fetch(`${API}/download?${params}`, {
          cache: "no-store",
        });
        const text = await res.text();
        const ext = format === "csv" ? "csv" : "jsonl";
        const file = `${scope.space}-trajectories-${new Date().toISOString().slice(0, 10)}.${ext}`;
        downloadFile(
          file,
          text,
          ext === "csv" ? "text/csv" : "application/x-ndjson",
        );
        setDone({ key, kind: "download", file, count, bytes: text.length });
      } else {
        const p = Object.fromEntries(new URLSearchParams(params));
        const [res] = await Promise.all([
          fetch(API, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ...p, destination: dest, uri }),
          }),
          new Promise((r) => setTimeout(r, 1400)),
        ]);
        const body = (await res.json()) as ExportJob & { message?: string };
        if (!res.ok) throw new Error(body.message ?? "Export failed");
        setDone({ key, kind: "job", job: body });
        setHistoryTick((n) => n + 1);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPhase("idle");
    }
  };

  const exportLabel =
    phase === "working"
      ? dest === "download"
        ? "Preparing file…"
        : `Writing to ${destination.name}…`
      : `Export ${num(count)} ${count === 1 ? "trajectory" : "trajectories"}`;

  const sample = shown?.sample ?? null;
  const space = SPACES.find((sp) => sp.id === scope.space) ?? SPACES[0]!;

  return (
    <IntelligenceShell
      section={{ label: "Data export", to: `${INTELLIGENCE_BASE}/export` }}
    >
      <section className="shell-page" aria-labelledby="export-title">
        <WorkspacePageHeader
          headingLevel={1}
          title="Export trajectories"
          titleId="export-title"
          description="Your trajectories are your data. Take any slice as plain files: the AG-UI events of every agent run, what people did in the product, and the network requests underneath. Use it in your warehouse, your notebooks or your own training pipeline."
        />

        <div className={s.layout}>
          <div className={s.main}>
            {/* ── Slice ─────────────────────────────────────────── */}
            <section className={s.card} aria-labelledby="slice-title">
              <header className={s.cardHead}>
                <h2 id="slice-title">Slice</h2>
                <span className={s.muted}>
                  Start from a Learning Space, then narrow it.
                </span>
              </header>

              <div className={s.spaceRow}>
                <label className={s.fieldLabel} htmlFor="export-space">
                  Learning Space
                </label>
                <Select
                  id="export-space"
                  value={scope.space}
                  onChange={(e) =>
                    setScope({ ...scope, space: e.target.value })
                  }
                >
                  {SPACES.map((sp) => (
                    <option key={sp.id} value={sp.id}>
                      {sp.name}
                    </option>
                  ))}
                </Select>
                <span className={s.agents}>
                  <span className={s.muted}>Agents reporting in</span>
                  {space.agents.map((a) => (
                    <Badge key={a} variant="neutral">
                      {a}
                    </Badge>
                  ))}
                </span>
              </div>

              <div className={s.scopes} role="radiogroup" aria-label="Scope">
                {SCOPES.map((sc) => {
                  const on = scope.kind === sc.id;
                  return (
                    <div
                      key={sc.id}
                      className={s.scope}
                      data-on={on ? "true" : undefined}
                    >
                      <button
                        type="button"
                        role="radio"
                        aria-checked={on}
                        className={s.scopeHit}
                        onClick={() => setScope({ ...scope, kind: sc.id })}
                      >
                        <Icon name={sc.icon} />
                        <span>
                          <b>{sc.name}</b>
                          <small>{sc.blurb}</small>
                        </span>
                      </button>
                      {sc.id === "group" ? (
                        <Select
                          aria-label="Group"
                          disabled={!on}
                          value={scope.groupId}
                          onChange={(e) =>
                            setScope({ ...scope, groupId: e.target.value })
                          }
                        >
                          {GROUPS.map((g) => (
                            <option key={g.id} value={g.id}>
                              {`${g.name} · ${g.members.length} ${g.members.length === 1 ? "user" : "users"}`}
                            </option>
                          ))}
                        </Select>
                      ) : null}
                      {sc.id === "user" ? (
                        <Select
                          aria-label="User"
                          disabled={!on}
                          value={scope.userId}
                          onChange={(e) =>
                            setScope({ ...scope, userId: e.target.value })
                          }
                        >
                          {USERS.map((u) => (
                            <option key={u.id} value={u.id}>
                              {`${u.name} · ${u.id}`}
                            </option>
                          ))}
                        </Select>
                      ) : null}
                      {sc.id === "space" ? (
                        <span className={s.scopeNote}>
                          In-app agent and ChatGPT via MCP
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <div className={s.filtersHead}>
                <h3>Filters</h3>
                <span className={s.presets}>
                  {PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      className={s.chip}
                      onClick={() => setFilters((fs) => [...fs, ...p.filters])}
                    >
                      <Icon name="add" className={s.chipIcon} />
                      {p.label}
                    </button>
                  ))}
                </span>
              </div>
              {filters.length === 0 ? (
                <p className={s.empty}>
                  No filters. The whole scope is in the slice.
                </p>
              ) : null}
              <div className={s.filters}>
                {filters.map((f, i) => {
                  const def = fieldDef(f.field);
                  return (
                    <div key={i} className={s.filterRow}>
                      <span className={s.where}>
                        {i === 0 ? "where" : "and"}
                      </span>
                      <Select
                        aria-label="Field"
                        value={f.field}
                        onChange={(e) =>
                          setFilter(i, { field: e.target.value as FilterField })
                        }
                      >
                        {FIELDS.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.label}
                          </option>
                        ))}
                      </Select>
                      <Select
                        aria-label="Operator"
                        value={f.op}
                        onChange={(e) =>
                          setFilter(i, { op: e.target.value as FilterOp })
                        }
                      >
                        {def.ops.map((op) => (
                          <option key={op} value={op}>
                            {op}
                          </option>
                        ))}
                      </Select>
                      {def.values ? (
                        <Select
                          aria-label="Value"
                          value={f.value}
                          onChange={(e) =>
                            setFilter(i, { value: e.target.value })
                          }
                        >
                          {def.values.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.label}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <Input
                          aria-label="Value"
                          type={
                            def.input === "date"
                              ? "date"
                              : def.input === "number"
                                ? "number"
                                : "text"
                          }
                          placeholder={def.input === "text" ? "close out" : ""}
                          value={f.value}
                          onChange={(e) =>
                            setFilter(i, { value: e.target.value })
                          }
                        />
                      )}
                      <button
                        type="button"
                        className={s.remove}
                        aria-label="Remove filter"
                        onClick={() =>
                          setFilters((fs) => fs.filter((_, j) => j !== i))
                        }
                      >
                        <Icon name="close" className={s.removeIcon} />
                      </button>
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                className={s.addFilter}
                onClick={() => addFilter()}
              >
                <Icon name="add" className={s.chipIcon} />
                Add filter
              </button>

              <div className={s.query}>
                <div className={s.queryHead}>
                  <span>Your slice, as a query</span>
                  <CopyButton label="Copy" value={shown?.query ?? ""} />
                </div>
                <pre>{shown?.query ?? "…"}</pre>
              </div>
            </section>

            {/* ── Matching trajectories ─────────────────────────── */}
            <section className={s.card} aria-labelledby="match-title">
              <header className={s.cardHead}>
                <h2 id="match-title">
                  Matching trajectories{" "}
                  <span className={s.count}>{num(count)}</span>
                </h2>
                <span className={s.muted}>
                  {shown
                    ? `${num(shown.threads)} ${shown.threads === 1 ? "thread" : "threads"} · ${num(shown.users.length)} ${shown.users.length === 1 ? "user" : "users"} · ${shown.surfaces.map(surfaceName).join(", ")}`
                    : "Loading…"}
                </span>
              </header>
              {preview.status === "error" ? (
                <StatusMessage
                  title="The slice could not be loaded"
                  variant="danger"
                >
                  {preview.message}
                </StatusMessage>
              ) : null}
              <div className={s.tableWrap}>
                <table className={s.table}>
                  <thead>
                    <tr>
                      <th>Trajectory</th>
                      <th>User</th>
                      <th>Surfaces</th>
                      <th>Outcome</th>
                      <th className={s.num}>Events</th>
                      <th>Last activity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(shown?.rows ?? []).map((t) => (
                      <tr key={t.trajectoryId}>
                        <td>
                          <a
                            className={s.trLink}
                            href={`${INTELLIGENCE_BASE}/trajectories/${encodeURIComponent(t.trajectoryId)}`}
                          >
                            {t.title}
                          </a>
                          <span className={s.mono}>{t.trajectoryId}</span>
                        </td>
                        <td>
                          {t.user.name}
                          <span className={s.mono}>{t.user.id}</span>
                        </td>
                        <td>
                          <span className={s.badges}>
                            {t.surfaces.map((x) => (
                              <Badge key={x} variant="neutral">
                                {surfaceName(x)}
                              </Badge>
                            ))}
                          </span>
                        </td>
                        <td>
                          <OutcomeBadges outcome={t.outcome} />
                        </td>
                        <td className={s.num}>{t.eventCount}</td>
                        <td className={s.mono}>
                          {`${fmtDate(t.lastEventAt)}, ${fmtTime(t.lastEventAt).slice(0, 5)}`}
                        </td>
                      </tr>
                    ))}
                    {shown && shown.rows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className={s.empty}>
                          Nothing matches this slice. Loosen a filter.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>

            {/* ── Raw record ────────────────────────────────────── */}
            <section className={s.card} aria-labelledby="raw-title">
              <header className={s.cardHead}>
                <h2 id="raw-title">
                  {format === "jsonl"
                    ? "One record, as it lands"
                    : format === "csv"
                      ? "The first rows"
                      : "Table schema"}
                </h2>
                <span className={s.muted}>
                  {format === "jsonl" && sample
                    ? `${sample.trajectory.trajectoryId} · first 6 events of each stream shown; the file carries all of them`
                    : format === "csv"
                      ? "One row per trajectory"
                      : `One row per event · ${num(shown?.eventRows ?? 0)} rows in this slice`}
                </span>
              </header>
              {format === "jsonl" && sample ? (
                <>
                  <div className={s.recordStats}>
                    {sample.threads.map((t) => (
                      <span key={t.threadId}>
                        <b>{t.aguiEvents.length}</b>
                        {` AG-UI events · ${t.surface === "chatgpt" ? "ChatGPT via MCP" : "in-app agent"}`}
                      </span>
                    ))}
                    <span>
                      <b>{sample.productEvents.length}</b> product events
                    </span>
                    <span>
                      <b>{sample.networkRequests.length}</b> network requests
                    </span>
                  </div>
                  <div className={s.code}>
                    <div className={s.codeHead}>
                      <span>{`${scope.space}-trajectories.jsonl · line 1`}</span>
                      <CopyButton
                        label="Copy line"
                        value={JSON.stringify(sample)}
                      />
                    </div>
                    <pre>{sampleText(sample, 6)}</pre>
                  </div>
                </>
              ) : null}
              {format === "csv" && shown ? (
                <div className={s.code}>
                  <div className={s.codeHead}>
                    <span>{`${scope.space}-trajectories.csv`}</span>
                    <CopyButton label="Copy" value={shown.csvSample} />
                  </div>
                  <pre>{shown.csvSample}</pre>
                </div>
              ) : null}
              {format === "parquet" && shown ? (
                <div className={s.tableWrap}>
                  <table className={s.table}>
                    <thead>
                      <tr>
                        <th>Column</th>
                        <th>Type</th>
                        <th>Holds</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.parquetSchema.map((c) => (
                        <tr key={c.name}>
                          <td className={s.mono}>{c.name}</td>
                          <td className={s.mono}>{c.type}</td>
                          <td>{c.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {format === "jsonl" && !sample && shown ? (
                <p className={s.empty}>No trajectory in this slice to show.</p>
              ) : null}
            </section>
          </div>

          {/* ── Export panel ──────────────────────────────────────── */}
          <aside className={s.side} aria-label="Export">
            <section className={s.card}>
              <div className={s.total}>
                <b>{num(count)}</b>
                <span>
                  {count === 1 ? "trajectory" : "trajectories"} in this slice
                </span>
              </div>
              <dl className={s.stats}>
                <div>
                  <dt>AG-UI events</dt>
                  <dd>{num(shown?.aguiEvents ?? 0)}</dd>
                </div>
                <div>
                  <dt>Product events</dt>
                  <dd>{num(shown?.productEvents ?? 0)}</dd>
                </div>
                <div>
                  <dt>Network requests</dt>
                  <dd>{num(shown?.networkRequests ?? 0)}</dd>
                </div>
                <div>
                  <dt>Users</dt>
                  <dd>{num(shown?.users.length ?? 0)}</dd>
                </div>
              </dl>

              <h3 className={s.sideH}>Format</h3>
              <div className={s.formats} role="radiogroup" aria-label="Format">
                {FORMATS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    role="radio"
                    aria-checked={format === f.id}
                    className={s.format}
                    onClick={() => setFormat(f.id)}
                  >
                    <span className={s.radio} aria-hidden="true" />
                    <span>
                      <b>
                        {f.name} <span className={s.ext}>{f.ext}</span>
                      </b>
                      <small>{f.blurb}</small>
                    </span>
                  </button>
                ))}
              </div>

              <h3 className={s.sideH}>Destination</h3>
              <div
                className={s.dests}
                role="radiogroup"
                aria-label="Destination"
              >
                {DESTINATIONS.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    role="radio"
                    aria-checked={dest === d.id}
                    className={s.dest}
                    onClick={() => {
                      setDest(d.id);
                      setUri(d.uri);
                    }}
                  >
                    {d.logo ? (
                      // eslint-disable-next-line @next/next/no-img-element -- local brand mark
                      <img src={d.logo} alt="" className={s.destLogo} />
                    ) : (
                      <Icon name={d.icon ?? "cloud"} className={s.destIcon} />
                    )}
                    <span>{d.name}</span>
                  </button>
                ))}
              </div>
              {dest !== "download" ? (
                <div className={s.uri}>
                  <label className={s.fieldLabel} htmlFor="export-uri">
                    {destination.uriLabel}
                  </label>
                  <Input
                    id="export-uri"
                    className={s.mono}
                    value={uri}
                    onChange={(e) => setUri(e.target.value)}
                  />
                  <Switch
                    label="Keep it in sync"
                    description="Append new trajectories every night at 02:00 UTC."
                    checked={sync}
                    onChange={(e) => setSync(e.target.checked)}
                  />
                </div>
              ) : null}

              <div className={s.sizeRow}>
                <span>Estimated size</span>
                <b>{kb(shown?.bytes[format] ?? 0)}</b>
              </div>
              {parquetDownload ? (
                <p className={s.hint}>
                  Parquet is written to a bucket or a warehouse. Pick a
                  destination, or download JSONL or CSV.
                </p>
              ) : null}
              <Button
                variant="primary"
                className={s.go}
                disabled={
                  count === 0 ||
                  phase === "working" ||
                  parquetDownload ||
                  (dest !== "download" && !uri.trim())
                }
                onClick={() => void runExport()}
              >
                {exportLabel}
              </Button>

              {error ? (
                <StatusMessage
                  title="The export did not finish"
                  variant="danger"
                >
                  {error}
                </StatusMessage>
              ) : null}
              {done?.kind === "download" ? (
                <div className={s.done} role="status">
                  <Icon name="check_circle" className={s.doneIcon} />
                  <span>
                    <b>{`Saved ${done.file}`}</b>
                    <small>{`${num(done.count)} ${done.count === 1 ? "trajectory" : "trajectories"} · ${kb(done.bytes)}`}</small>
                  </span>
                </div>
              ) : null}
              {done?.kind === "job" ? (
                <div className={s.done} role="status">
                  <Icon name="check_circle" className={s.doneIcon} />
                  <span>
                    <b>{`Delivered to ${destination.name}`}</b>
                    <small>{`${num(done.job.trajectories)} ${done.job.trajectories === 1 ? "trajectory" : "trajectories"} · ${num(done.job.rows)} rows · ${kb(done.job.bytes)}${sync ? " · syncs nightly" : ""}`}</small>
                    {done.job.objects.map((o) => (
                      <code key={o}>{o}</code>
                    ))}
                  </span>
                </div>
              ) : null}
            </section>
          </aside>
        </div>

        {/* ── Recent exports ───────────────────────────────────────── */}
        <section className={s.card} aria-labelledby="recent-title">
          <header className={s.cardHead}>
            <h2 id="recent-title">Recent exports</h2>
            <span className={s.muted}>
              Every export is logged with the query that made it.
            </span>
          </header>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Export</th>
                  <th>Slice</th>
                  <th>Destination</th>
                  <th className={s.num}>Trajectories</th>
                  <th className={s.num}>Size</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {(history.status === "ready" ? history.data : []).map((j) => {
                  const d = DESTINATIONS.find((x) => x.id === j.destination);
                  return (
                    <tr key={j.id}>
                      <td className={s.mono}>{j.id}</td>
                      <td>{j.scopeLabel}</td>
                      <td>
                        <span className={s.destCell}>
                          {d?.logo ? (
                            // eslint-disable-next-line @next/next/no-img-element -- local brand mark
                            <img src={d.logo} alt="" className={s.destLogoSm} />
                          ) : (
                            <Icon
                              name={d?.icon ?? "cloud"}
                              className={s.destIconSm}
                            />
                          )}
                          <span>
                            {`${d?.name ?? j.destination} · ${j.format.toUpperCase()}`}
                            <span className={s.mono}>{j.uri}</span>
                          </span>
                        </span>
                      </td>
                      <td className={s.num}>{j.trajectories}</td>
                      <td className={s.num}>{kb(j.bytes)}</td>
                      <td className={s.mono}>
                        {`${fmtDate(j.at)}, ${fmtTime(j.at).slice(0, 5)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </IntelligenceShell>
  );
}
