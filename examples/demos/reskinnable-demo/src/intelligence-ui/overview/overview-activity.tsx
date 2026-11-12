/*
 * The presentational pieces of Intelligence
 * apps/app-frontend/react-shell/src/home/project-overview-activity.tsx
 * (main @ b71006350): truncating text, section header, metric row, the
 * Learning Space and recent-rows tables, and the activity grid. Their data
 * loaders (analytics, threads, Learning) are left out; the Overview screen
 * feeds them from /api/learning/v1. The recent table lists trajectories, so
 * its columns read Trajectory / App user / Surface / Updated.
 */
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { DataTable } from "../ui/data-display";
import type { DataTableColumn } from "../ui/data-display";
import { FormattedDateTime, formatDateTime } from "../ui/datetime";
import { MetricTile } from "./MetricTile";
import { Link, useNavigate } from "../shell/router";
import styles from "./project-overview.module.css";

export function TruncatedText(props: {
  readonly children: string;
  readonly identifier?: boolean;
}): React.JSX.Element {
  return (
    <span
      className={styles.truncate}
      data-slot={props.identifier ? "identifier" : undefined}
      title={props.children}
    >
      {props.children}
    </span>
  );
}

export function OverviewSectionHeader(props: {
  readonly id: string;
  readonly title: string;
  readonly link?: { readonly label: string; readonly to: string };
}): React.JSX.Element {
  return (
    <div className={styles.sectionHeader}>
      <h2 id={props.id}>{props.title}</h2>
      {props.link ? (
        <Link className={styles.sectionLink} to={props.link.to}>
          {props.link.label}
          <ArrowRight aria-hidden="true" size={13} />
        </Link>
      ) : null}
    </div>
  );
}

export interface OverviewMetric {
  readonly label: string;
  readonly value: string;
  readonly valueLabel?: string;
  readonly delta: string;
  readonly icon: LucideIcon;
}

export function OverviewMetricRow(props: {
  readonly metrics: readonly OverviewMetric[];
}): React.JSX.Element {
  return (
    <div className={styles.metrics}>
      {props.metrics.map((metric, index) => (
        <MetricTile
          key={metric.label}
          order={index + 1}
          metric={{ ...metric, state: "neutral" }}
        />
      ))}
    </div>
  );
}

export interface OverviewRecentRow extends Record<string, unknown> {
  readonly id: string;
  readonly name: string;
  readonly endUserId: string;
  readonly surface: string;
  readonly updatedAt: string;
}

export function OverviewRecentTable(props: {
  readonly rows: readonly OverviewRecentRow[];
  readonly rowTo: (row: OverviewRecentRow) => string;
}): React.JSX.Element {
  const navigate = useNavigate();
  const columns: DataTableColumn<OverviewRecentRow>[] = [
    {
      id: "name",
      header: "Trajectory",
      cell: (row) => (
        <Link
          className={styles.rowLink}
          onClick={(event) => event.stopPropagation()}
          to={props.rowTo(row)}
        >
          <TruncatedText>{row.name}</TruncatedText>
        </Link>
      ),
    },
    {
      id: "user",
      header: "App user",
      cell: (row) => <TruncatedText identifier>{row.endUserId}</TruncatedText>,
    },
    {
      id: "agent",
      header: "Surface",
      cell: (row) => <TruncatedText>{row.surface}</TruncatedText>,
    },
    {
      id: "updated",
      header: "Updated",
      cell: (row) => (
        <span
          className={styles.truncate}
          title={formatDateTime(row.updatedAt, {
            invalidFallback: "Date unavailable",
          })}
        >
          <FormattedDateTime
            value={row.updatedAt}
            invalidFallback="Date unavailable"
          />
        </span>
      ),
    },
  ];
  return (
    <div className={styles.tableFrame} data-columns="threads">
      <DataTable
        ariaLabel="Recent trajectories"
        columns={columns}
        rows={props.rows}
        rowKey={(row) => row.id}
        onRowClick={(row) => navigate(props.rowTo(row))}
      />
    </div>
  );
}

export interface OverviewLearningRow extends Record<string, unknown> {
  readonly id: string;
  readonly name: string;
  readonly threadCount: number;
  readonly pendingThreadCount: number;
  readonly lastSucceededAt: string | null;
}

export function OverviewLearningTable(props: {
  readonly rows: readonly OverviewLearningRow[];
  readonly spaceTo: (space: OverviewLearningRow) => string;
}): React.JSX.Element {
  const navigate = useNavigate();
  const columns: DataTableColumn<OverviewLearningRow>[] = [
    {
      id: "name",
      header: "Learning Space",
      cell: (space) => (
        <Link
          className={styles.rowLink}
          onClick={(event) => event.stopPropagation()}
          to={props.spaceTo(space)}
        >
          <TruncatedText>{space.name}</TruncatedText>
        </Link>
      ),
    },
    { id: "threads", header: "Threads", cell: (space) => space.threadCount },
    {
      id: "new",
      header: "New Threads",
      cell: (space) => space.pendingThreadCount,
    },
    {
      id: "analysis",
      header: "Last successful analysis",
      cell: (space) =>
        space.lastSucceededAt ? (
          <span
            className={styles.truncate}
            title={formatDateTime(space.lastSucceededAt, {
              invalidFallback: "Date unavailable",
            })}
          >
            <FormattedDateTime
              value={space.lastSucceededAt}
              invalidFallback="Date unavailable"
            />
          </span>
        ) : (
          "Not analyzed yet"
        ),
    },
  ];
  return (
    <div className={styles.tableFrame} data-columns="learning">
      <DataTable
        ariaLabel="Learning Spaces"
        columns={columns}
        rows={props.rows}
        rowKey={(space) => space.id}
        onRowClick={(space) => navigate(props.spaceTo(space))}
      />
    </div>
  );
}

export function OverviewActivityGrid(props: {
  readonly children: ReactNode;
}): React.JSX.Element {
  return <div className={styles.activityGrid}>{props.children}</div>;
}
