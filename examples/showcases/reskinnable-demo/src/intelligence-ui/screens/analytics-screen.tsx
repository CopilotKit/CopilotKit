"use client";

/**
 * Product Analytics for Ledgerline, composed from the workspace pieces (page
 * header, MetricTile, DataTable, the Overview's card and table frames): runtime
 * activity, tool usage by the Ledgerline agent's real tool names, reliability,
 * and the month-end close. Activity, tools and refusals are a seeded week
 * (../ledgerline/analytics-data.ts); the trajectories the agent failed are read
 * from Intelligence, and the close is read live from
 * /api/ledgerline/v1/reconciliation/status, the same source as the Card close
 * board, so it moves with the demo.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Gauge,
  Lock,
  MessagesSquare,
  Receipt,
  ShieldCheck,
  Timer,
  UsersRound,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CloseStatusView } from "@/skins/ledgerline/genui/views";
import { learningV1 } from "../data/client";
import type { TrajectorySummary } from "../data/contract";
import { MetricTile } from "../overview/MetricTile";
import type { MetricTileTrend } from "../overview/MetricTile";
import { DataTable } from "../ui/data-display";
import type { DataTableColumn } from "../ui/data-display";
import { Badge } from "../ui/feedback";
import {
  IntelligenceShell,
  INTELLIGENCE_BASE,
} from "../shell/intelligence-shell";
import { Link } from "../shell/router";
import { WorkspacePageHeader } from "../shell/workspace-page-header";
import {
  ACTIVITY,
  ACTIVITY_TOTALS,
  ANALYTICS_RANGE,
  CLOSE_BASELINE,
  RELIABILITY,
  TOOL_CALLS_TOTAL,
  TOOL_USAGE,
} from "../ledgerline/analytics-data";
import type { ToolUsage } from "../ledgerline/analytics-data";
import styles from "./analytics-screen.module.css";

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const pct = (n: number, digits = 1) => `${(n * 100).toFixed(digits)}%`;
const usd = (n: number) => `$${fmt(n)}`;
const ms = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${fmt(n)} ms`;
const compact = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);

interface Tile {
  readonly label: string;
  readonly value: string;
  readonly delta: string;
  readonly icon: LucideIcon;
  readonly trend?: MetricTileTrend;
}

function Metrics(props: { readonly tiles: readonly Tile[] }) {
  return (
    <div className={styles.metrics}>
      {props.tiles.map((t, i) => (
        <MetricTile
          key={t.label}
          order={i + 1}
          metric={{ ...t, state: "neutral" }}
        />
      ))}
    </div>
  );
}

function SectionHeader(props: {
  readonly id: string;
  readonly title: string;
  readonly note?: string;
  readonly link?: { readonly label: string; readonly to: string };
}) {
  return (
    <div className={styles.sectionHeader}>
      <div>
        <h2 id={props.id}>{props.title}</h2>
        {props.note ? <p>{props.note}</p> : null}
      </div>
      {props.link ? (
        <Link className={styles.sectionLink} to={props.link.to}>
          {props.link.label}
          <ArrowRight aria-hidden="true" size={13} />
        </Link>
      ) : null}
    </div>
  );
}

/** The rendered width of a chart's box, so the SVG draws in real pixels (text never scales). */
function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(240, Math.round(entry.contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

/** A "nice" axis maximum and its ticks. */
function niceScale(max: number, ticks = 4): number[] {
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  return Array.from({ length: ticks + 1 }, (_, i) => i * step);
}

// ---------------------------------------------------------------------------
// Event volume: stacked columns per day, In-app agent below ChatGPT via MCP.
// ---------------------------------------------------------------------------

function EventVolumeChart() {
  const [hover, setHover] = useState<number | null>(null);
  const { ref, width: W } = useWidth(640);
  const H = 228;
  const pad = { l: 40, r: 8, t: 12, b: 26 };
  const max = Math.max(...ACTIVITY.map((d) => d.inApp + d.chatgpt));
  const ticks = niceScale(max);
  const top = ticks[ticks.length - 1]!;
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const slot = plotW / ACTIVITY.length;
  const bw = Math.min(40, slot * 0.5);
  const y = (v: number) => pad.t + plotH - (v / top) * plotH;
  const active = hover === null ? null : ACTIVITY[hover]!;
  return (
    <div className={styles.chartWrap} ref={ref}>
      <svg
        className={styles.chart}
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Runtime events by day, by surface"
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              className={t === 0 ? styles.baseline : styles.gridLine}
              x1={pad.l}
              x2={W - pad.r}
              y1={y(t)}
              y2={y(t)}
            />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end">
              {compact(t)}
            </text>
          </g>
        ))}
        {ACTIVITY.map((d, i) => {
          const cx = pad.l + slot * i + slot / 2;
          const x = cx - bw / 2;
          const yIn = y(d.inApp);
          const yAll = y(d.inApp + d.chatgpt);
          const base = y(0);
          return (
            <g key={d.day}>
              <rect
                className={styles.hoverBand}
                data-active={hover === i}
                x={pad.l + slot * i + 2}
                y={pad.t}
                width={slot - 4}
                height={plotH}
                rx={4}
                onMouseEnter={() => setHover(i)}
              />
              <rect
                className={styles.barInApp}
                x={x}
                y={yIn}
                width={bw}
                height={base - yIn}
                pointerEvents="none"
              />
              {/* 2px surface gap between the stacked segments; data end rounded. */}
              <path
                className={styles.barChatgpt}
                pointerEvents="none"
                d={`M${x},${yIn - 2} V${yAll + 4} Q${x},${yAll} ${x + 4},${yAll} H${x + bw - 4} Q${x + bw},${yAll} ${x + bw},${yAll + 4} V${yIn - 2} Z`}
              />
              <text x={cx} y={H - 8} textAnchor="middle">
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      {active && hover !== null ? (
        <div
          className={styles.tooltip}
          style={{
            left: `${Math.min(W - 90, Math.max(90, pad.l + slot * hover + slot / 2))}px`,
            top: `${y(active.inApp + active.chatgpt)}px`,
          }}
        >
          <b>{active.label}</b>
          <div className={styles.tooltipRow}>
            <span>
              <i className={`${styles.swatch} ${styles.s1}`} />
              In-app agent
            </span>
            {fmt(active.inApp)}
          </div>
          <div className={styles.tooltipRow}>
            <span>
              <i className={`${styles.swatch} ${styles.s2}`} />
              ChatGPT via MCP
            </span>
            {fmt(active.chatgpt)}
          </div>
          <div className={styles.tooltipRow}>
            <span>Total</span>
            <strong>{fmt(active.inApp + active.chatgpt)}</strong>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Active users: one series, a line with a soft area and end label.
// ---------------------------------------------------------------------------

function ActiveUsersChart() {
  const [hover, setHover] = useState<number | null>(null);
  const { ref, width: W } = useWidth(420);
  const H = 228;
  const pad = { l: 40, r: 22, t: 22, b: 26 };
  const ticks = niceScale(Math.max(...ACTIVITY.map((d) => d.activeUsers)));
  const top = ticks[ticks.length - 1]!;
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const x = (i: number) => pad.l + (plotW * i) / (ACTIVITY.length - 1);
  const y = (v: number) => pad.t + plotH - (v / top) * plotH;
  const pts = ACTIVITY.map((d, i) => `${x(i)},${y(d.activeUsers)}`);
  const peak = ACTIVITY.reduce(
    (best, d, i) => (d.activeUsers > ACTIVITY[best]!.activeUsers ? i : best),
    0,
  );
  const shown = hover ?? peak;
  const d = ACTIVITY[shown]!;
  return (
    <div className={styles.chartWrap} ref={ref}>
      <svg
        className={styles.chart}
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Active users by day"
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              className={t === 0 ? styles.baseline : styles.gridLine}
              x1={pad.l}
              x2={W - pad.r}
              y1={y(t)}
              y2={y(t)}
            />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end">
              {compact(t)}
            </text>
          </g>
        ))}
        <path
          className={styles.area}
          d={`M${x(0)},${y(0)} L${pts.join(" L")} L${x(ACTIVITY.length - 1)},${y(0)} Z`}
        />
        <polyline className={styles.line} points={pts.join(" ")} />
        {hover !== null ? (
          <line
            className={styles.gridLine}
            x1={x(hover)}
            x2={x(hover)}
            y1={pad.t}
            y2={y(0)}
          />
        ) : null}
        <circle
          className={styles.dot}
          cx={x(shown)}
          cy={y(d.activeUsers)}
          r={5}
        />
        <text
          className={`${styles.valueLabel} ${styles.valueLabelStrong}`}
          x={x(shown)}
          y={y(d.activeUsers) - 10}
          textAnchor={
            shown === ACTIVITY.length - 1
              ? "end"
              : shown === 0
                ? "start"
                : "middle"
          }
        >
          {fmt(d.activeUsers)}
        </text>
        {ACTIVITY.map((day, i) => (
          <g key={day.day}>
            <text x={x(i)} y={H - 8} textAnchor="middle">
              {W < 380 ? day.label.replace(/^[A-Za-z]+ /, "") : day.label}
            </text>
            <rect
              x={x(i) - plotW / (ACTIVITY.length - 1) / 2}
              y={pad.t}
              width={plotW / (ACTIVITY.length - 1)}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          </g>
        ))}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tool usage
// ---------------------------------------------------------------------------

type ToolRow = ToolUsage & Record<string, unknown>;

function ToolUsageTable() {
  const maxCalls = Math.max(...TOOL_USAGE.map((t) => t.calls));
  const columns: DataTableColumn<ToolRow>[] = [
    {
      id: "tool",
      header: "Tool",
      cell: (t) => (
        <span className={styles.toolName}>
          <code title={t.name}>{t.name}</code>
          <small>{t.source}</small>
        </span>
      ),
    },
    {
      id: "share",
      header: "Share of calls",
      cell: (t) => (
        <span className={styles.barCell} title={`${fmt(t.calls)} calls`}>
          <span className={styles.track}>
            <span
              className={`${styles.fill} ${t.source === "In-app agent" ? "" : styles.fillMint}`}
              style={{
                display: "block",
                width: `${(t.calls / maxCalls) * 100}%`,
              }}
            />
          </span>
          <span className={styles.mutedNum}>
            {pct(t.calls / TOOL_CALLS_TOTAL)}
          </span>
        </span>
      ),
    },
    {
      id: "calls",
      header: "Calls",
      align: "end",
      cell: (t) => <span className={styles.num}>{fmt(t.calls)}</span>,
    },
    {
      id: "p50",
      header: "p50",
      align: "end",
      cell: (t) => <span className={styles.mutedNum}>{ms(t.p50Ms)}</span>,
    },
    {
      id: "errors",
      header: "Error rate",
      align: "end",
      cell: (t) => (
        <span
          className={t.errorRate >= 0.03 ? styles.errHigh : styles.mutedNum}
        >
          {pct(t.errorRate)}
        </span>
      ),
    },
  ];
  return (
    <div className={styles.tableFrame} data-columns="tools">
      <DataTable
        ariaLabel="Tool usage"
        columns={columns}
        rows={TOOL_USAGE as ToolRow[]}
        rowKey={(t) => `${t.name}:${t.source}`}
        scrollRegionLabel="Tool usage table"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Month-end close, live from the same endpoint as the Card close board.
// ---------------------------------------------------------------------------

const CARDS = ["4417", "8820", "3391"] as const;

const EXCEPTION_KIND: Record<
  CloseStatusView["exceptions"][number]["kind"],
  { label: string; how: string }
> = {
  split: {
    label: "Split across departments",
    how: "Allocation split by attendees",
  },
  reclass: {
    label: "Coded to the wrong account",
    how: "Reclass entry to the right GL account",
  },
  personal: {
    label: "Personal charge",
    how: "Marked personal and repaid by payroll",
  },
  missing_receipt: {
    label: "No receipt on file",
    how: "Missing-receipt affidavit, signed",
  },
};

function useCloses(): CloseStatusView[] | null | "error" {
  const [views, setViews] = useState<CloseStatusView[] | null | "error">(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      Promise.all(
        CARDS.map((c) =>
          fetch(`/api/ledgerline/v1/reconciliation/status?card=${c}`, {
            cache: "no-store",
          }).then((r) =>
            r.ok
              ? (r.json() as Promise<CloseStatusView>)
              : Promise.reject(r.status),
          ),
        ),
      )
        .then((v) => alive && setViews(v))
        .catch((error: unknown) => {
          console.error("[intelligence] could not read the card close", error);
          if (alive)
            setViews((prev) => (prev && prev !== "error" ? prev : "error"));
        });
    void load();
    const t = window.setInterval(() => void load(), 5000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);
  return views;
}

type CardRow = CloseStatusView & Record<string, unknown>;

function CloseSection() {
  const views = useCloses();
  const rows = useMemo(
    () => (views && views !== "error" ? (views as CardRow[]) : []),
    [views],
  );
  if (views === "error")
    return (
      <p className={styles.note} role="alert">
        The card close could not be read. Open it on the Card close board.
      </p>
    );
  if (!views)
    return (
      <p className={styles.note} role="status">
        Loading the month-end close…
      </p>
    );
  const exceptions = rows.flatMap((v) => v.exceptions);
  const cleared = exceptions.filter((x) => x.status === "cleared").length;
  const charges = rows.reduce((n, v) => n + v.total, 0);
  const matched = rows.reduce((n, v) => n + v.autoMatched.count, 0);
  const matchedUsd = rows.reduce((n, v) => n + v.autoMatched.amount, 0);
  const closed = rows.filter((v) => v.closed).length;
  const period = rows[0]?.card.periodLabel ?? "September";
  const byKind = (
    Object.keys(EXCEPTION_KIND) as (keyof typeof EXCEPTION_KIND)[]
  )
    .map((kind) => ({
      kind,
      all: exceptions.filter((x) => x.kind === kind).length,
      cleared: exceptions.filter(
        (x) => x.kind === kind && x.status === "cleared",
      ).length,
    }))
    .filter((k) => k.all > 0);
  const columns: DataTableColumn<CardRow>[] = [
    {
      id: "card",
      header: "Card",
      cell: (v) => (
        <span className={styles.toolName}>
          <b>{v.card.holder}</b>
          <small>Visa ending {v.card.last4}</small>
        </span>
      ),
    },
    {
      id: "matched",
      header: "Auto-matched",
      align: "end",
      cell: (v) => (
        <span className={styles.num}>
          {v.autoMatched.count} of {v.total}
        </span>
      ),
    },
    {
      id: "exceptions",
      header: "Exceptions cleared",
      cell: (v) => {
        const done = v.exceptions.filter((x) => x.status === "cleared").length;
        return (
          <span className={styles.barCell}>
            <span className={styles.track}>
              <span
                className={`${styles.fill} ${styles.fillMint}`}
                style={{
                  display: "block",
                  width: `${(done / Math.max(1, v.exceptions.length)) * 100}%`,
                }}
              />
            </span>
            <span className={styles.mutedNum}>
              {done} of {v.exceptions.length}
            </span>
          </span>
        );
      },
    },
    {
      id: "status",
      header: "Status",
      align: "end",
      cell: (v) =>
        v.closed ? (
          <Badge variant="success">Closed</Badge>
        ) : v.exceptions.every((x) => x.status === "cleared") ? (
          <Badge variant="accent">Ready to close</Badge>
        ) : (
          <Badge variant="warning">Needs a person</Badge>
        ),
    },
  ];
  return (
    <>
      <Metrics
        tiles={[
          {
            label: `${period} cards closed`,
            value: `${closed} of ${rows.length}`,
            delta: "Closed only by the cardholder's Confirm",
            icon: Lock,
          },
          {
            label: "Exceptions cleared",
            value: `${cleared} of ${exceptions.length}`,
            delta: "Splits, reclasses, personal charges, affidavits",
            icon: ShieldCheck,
          },
          {
            label: "Receipts auto-matched",
            value: `${matched} of ${charges}`,
            delta: `${usd(matchedUsd)} matched with no one involved`,
            icon: Receipt,
          },
          {
            label: "Median time to close",
            value: CLOSE_BASELINE.medianDaysToClose,
            delta: "Card statement to closed period",
            icon: Timer,
            trend: {
              direction: "down",
              tone: "positive",
              value: CLOSE_BASELINE.medianTrend,
            },
          },
        ]}
      />
      <div className={styles.grid2}>
        <div className={styles.card}>
          <div className={styles.cardHead}>
            <div>
              <h3>{period} card close</h3>
              <p>Charges, receipts and exceptions per card, live</p>
            </div>
          </div>
          <div className={styles.tableFrame} data-columns="cards">
            <DataTable
              ariaLabel="Card close by card"
              columns={columns}
              rows={rows}
              rowKey={(v) => v.card.id}
              scrollRegionLabel="Card close table"
            />
          </div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardHead}>
            <div>
              <h3>Exceptions by kind</h3>
              <p>What a person, or the learned skill, clears before a close</p>
            </div>
          </div>
          <ul className={styles.list}>
            {byKind.map((k) => (
              <li className={styles.listRow} key={k.kind}>
                <div className={styles.listHead}>
                  <span>{EXCEPTION_KIND[k.kind].label}</span>
                  <span className={styles.num}>
                    {k.cleared} of {k.all}
                  </span>
                </div>
                <span className={styles.track}>
                  <span
                    className={styles.fill}
                    style={{
                      display: "block",
                      width: `${(k.cleared / Math.max(1, k.all)) * 100}%`,
                    }}
                  />
                </span>
                <span className={styles.listNote}>
                  {EXCEPTION_KIND[k.kind].how}
                </span>
              </li>
            ))}
          </ul>
          <p className={styles.note}>
            Read from the Card close board, updated every 5 seconds.
          </p>
        </div>
      </div>
    </>
  );
}

/** Trajectories the agent failed and a person completed, newest first. */
function useFailed(): TrajectorySummary[] | null {
  const [rows, setRows] = useState<TrajectorySummary[] | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    learningV1
      .trajectories(ac.signal)
      .then((all) =>
        setRows(all.filter((t) => t.outcome === "agent_failed_user_completed")),
      )
      .catch((error: unknown) => {
        if (ac.signal.aborted) return;
        console.error("[intelligence] could not read trajectories", error);
        setRows([]);
      });
    return () => ac.abort();
  }, []);
  return rows;
}

// ---------------------------------------------------------------------------

export function AnalyticsScreen() {
  const maxRefusal = Math.max(...RELIABILITY.refusals.map((r) => r.count));
  const failed = useFailed();
  return (
    <IntelligenceShell section={{ label: "Product Analytics" }}>
      <section
        className={`shell-page ${styles.page}`}
        aria-labelledby="analytics-title"
      >
        <WorkspacePageHeader
          headingLevel={1}
          title="Product Analytics"
          titleId="analytics-title"
          description="Ledgerline · the expense agent, in the app and in ChatGPT"
          actions={
            <span className={styles.period}>
              <CalendarDays aria-hidden="true" size={15} />
              {ANALYTICS_RANGE}
            </span>
          }
        />

        <section className={styles.section} aria-labelledby="an-activity">
          <SectionHeader
            id="an-activity"
            title="Activity"
            note={`${ACTIVITY[0]!.label} to ${ACTIVITY[ACTIVITY.length - 1]!.label}, against the week before`}
          />
          <Metrics
            tiles={[
              {
                label: "Runtime events",
                value: fmt(ACTIVITY_TOTALS.runtimeEvents),
                delta: "AG-UI events, both surfaces",
                icon: Activity,
                trend: {
                  direction: "up",
                  tone: "positive",
                  value: ACTIVITY_TOTALS.trend.runtimeEvents,
                },
              },
              {
                label: "Active users",
                value: fmt(ACTIVITY_TOTALS.activeUsers),
                delta: "Cardholders, approvers and finance teams",
                icon: UsersRound,
                trend: {
                  direction: "up",
                  tone: "positive",
                  value: ACTIVITY_TOTALS.trend.activeUsers,
                },
              },
              {
                label: "Agent runs",
                value: fmt(ACTIVITY_TOTALS.agentRuns),
                delta: "In-app agent runs and ChatGPT tool calls",
                icon: Gauge,
                trend: {
                  direction: "up",
                  tone: "positive",
                  value: ACTIVITY_TOTALS.trend.agentRuns,
                },
              },
              {
                label: "Threads",
                value: fmt(ACTIVITY_TOTALS.threads),
                delta: "Conversations stored as AG-UI streams",
                icon: MessagesSquare,
                trend: {
                  direction: "up",
                  tone: "positive",
                  value: ACTIVITY_TOTALS.trend.threads,
                },
              },
            ]}
          />
          <div className={styles.grid2}>
            <div className={styles.card}>
              <div className={styles.cardHead}>
                <div>
                  <h3>Event volume</h3>
                  <p>Runtime events per day, by surface</p>
                </div>
                <div className={styles.legend}>
                  <span>
                    <i className={`${styles.swatch} ${styles.s1}`} />
                    In-app agent
                  </span>
                  <span>
                    <i className={`${styles.swatch} ${styles.s2}`} />
                    ChatGPT via MCP
                  </span>
                </div>
              </div>
              <EventVolumeChart />
            </div>
            <div className={styles.card}>
              <div className={styles.cardHead}>
                <div>
                  <h3>Active users</h3>
                  <p>Distinct Ledgerline users per day</p>
                </div>
              </div>
              <ActiveUsersChart />
            </div>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="an-tools">
          <SectionHeader
            id="an-tools"
            title="Tool usage"
            note={`${fmt(TOOL_CALLS_TOTAL)} tool calls this week across ${TOOL_USAGE.length} tools, in the app and in ChatGPT over MCP`}
          />
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <div>
                <h3>Share of tool calls</h3>
                <p>Bars are relative to the most-called tool</p>
              </div>
              <div className={styles.legend}>
                <span>
                  <i className={`${styles.swatch} ${styles.s1}`} />
                  In-app agent
                </span>
                <span>
                  <i className={`${styles.swatch} ${styles.s2}`} />
                  Ledgerline MCP app in ChatGPT
                </span>
              </div>
            </div>
            <ToolUsageTable />
          </div>
        </section>

        <section className={styles.section} aria-labelledby="an-reliability">
          <SectionHeader
            id="an-reliability"
            title="Reliability"
            link={{
              label: "Open User Trajectories",
              to: `${INTELLIGENCE_BASE}/trajectories`,
            }}
          />
          <Metrics
            tiles={[
              {
                label: "Run success rate",
                value: pct(RELIABILITY.runSuccessRate),
                delta: "Runs that finished what the user asked",
                icon: CheckCircle2,
                trend: { direction: "up", tone: "positive", value: "+2.3 pts" },
              },
              {
                label: "Tool error rate",
                value: pct(RELIABILITY.toolErrorRate),
                delta: "Calls the Ledgerline API refused",
                icon: Wrench,
                trend: {
                  direction: "down",
                  tone: "positive",
                  value: "-0.8 pts",
                },
              },
              {
                label: "p95 run latency",
                value: ms(RELIABILITY.p95RunLatencyMs),
                delta: "First token to last tool result",
                icon: Timer,
                trend: { direction: "flat", tone: "neutral", value: "0.2 s" },
              },
              {
                label: "Agent failed, user completed",
                value: failed ? String(failed.length) : "…",
                delta: "Finished by hand, evidence for learning",
                icon: AlertTriangle,
              },
            ]}
          />
          <div className={styles.gridEven}>
            <div className={styles.card}>
              <div className={styles.cardHead}>
                <div>
                  <h3>Refusals by code</h3>
                  <p>
                    Ledgerline API refusals the agent relayed instead of
                    claiming success
                  </p>
                </div>
              </div>
              <ul className={styles.list}>
                {RELIABILITY.refusals.map((r) => (
                  <li className={styles.listRow} key={r.code}>
                    <div className={styles.listHead}>
                      <code>{r.code}</code>
                      <span className={styles.num}>{r.count}</span>
                    </div>
                    <span className={styles.track}>
                      <span
                        className={`${styles.fill} ${styles.fillMuted}`}
                        style={{
                          display: "block",
                          width: `${(r.count / maxRefusal) * 100}%`,
                        }}
                      />
                    </span>
                    <span className={styles.listNote}>{r.meaning}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className={styles.card}>
              <div className={styles.cardHead}>
                <div>
                  <h3>Agent failed, user completed</h3>
                  <p>Each one feeds Automatic Learning</p>
                </div>
                {failed ? (
                  <Badge variant="danger">{failed.length} in two weeks</Badge>
                ) : null}
              </div>
              <ul className={styles.failed}>
                {(failed ?? []).map((t) => (
                  <li key={t.trajectoryId}>
                    <Link
                      to={`${INTELLIGENCE_BASE}/trajectories/${t.trajectoryId}`}
                    >
                      {t.title}
                    </Link>
                    <small>
                      {t.user.name} ·{" "}
                      {new Date(t.lastEventAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}{" "}
                      ·{" "}
                      {t.surfaces.includes("chatgpt")
                        ? "ChatGPT via MCP"
                        : "In-app agent"}
                      , then by hand
                    </small>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="an-close">
          <SectionHeader
            id="an-close"
            title="Month-end close"
            note="Live from the Card close board, the same figures the cardholders see"
            link={{
              label: "Open Card close",
              to: "/ledgerline/reconciliation",
            }}
          />
          <CloseSection />
        </section>
      </section>
    </IntelligenceShell>
  );
}
