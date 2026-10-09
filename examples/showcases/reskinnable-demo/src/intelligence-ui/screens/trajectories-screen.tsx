"use client";

/**
 * User Trajectories, laid out like Intelligence's `TrajectoryListView`
 * (libs/trajectories/src/components/trajectory-list.tsx, main @ b71006350):
 * page header with Capture setup, search over loaded rows with Refresh, the
 * comfortable DataTable and the loaded-count footer, with that view's styles.
 * Demo columns: the trajectory's title, its outcome (agent failed and the
 * person finished it) and the surfaces it joins (in-app agent, ChatGPT via MCP,
 * manual product activity).
 */
import { useCallback, useState } from "react";
import type { TrajectorySummary } from "../data/contract";
import { learningV1 } from "../data/client";
import { useLearningRequest } from "../learning/use-learning-request";
import { DataTable, type DataTableColumn } from "../ui/data-display";
import { FormattedDateTime } from "../ui/datetime";
import { Badge } from "../ui/feedback";
import { SearchField } from "../ui/forms";
import { Button } from "../ui/primitives";
import {
  IntelligenceShell,
  INTELLIGENCE_BASE,
} from "../shell/intelligence-shell";
import { Link } from "../shell/router";
import { WorkspacePageHeader } from "../shell/workspace-page-header";
import { surfaceName } from "./trajectory-format";
import shared from "./intelligence-screens.module.css";
import styles from "./trajectory-list.module.css";

export function OutcomeBadges(props: {
  readonly outcome: TrajectorySummary["outcome"];
}) {
  if (props.outcome === "agent_failed_user_completed") {
    return (
      <span className={shared.badges}>
        <Badge variant="danger">Agent failed</Badge>
        <Badge variant="success">User completed</Badge>
      </span>
    );
  }
  if (props.outcome === "agent_succeeded")
    return <Badge variant="success">Agent succeeded</Badge>;
  return <Badge variant="neutral">In progress</Badge>;
}

type Row = { readonly record: TrajectorySummary } & Record<string, unknown>;

export function TrajectoriesScreen() {
  const [revision, setRevision] = useState(0);
  const [q, setQ] = useState("");
  const load = useCallback(
    (signal: AbortSignal) => {
      void revision;
      return learningV1.trajectories(signal);
    },
    [revision],
  );
  const state = useLearningRequest(load);
  const rows =
    state.status === "ready"
      ? [...state.data].sort((a, b) => b.lastEventAt - a.lastEventAt)
      : [];
  const filtered = rows.filter((row) =>
    `${row.title} ${row.trajectoryId} ${row.user.id} ${row.user.name}`
      .toLocaleLowerCase()
      .includes(q.trim().toLocaleLowerCase()),
  );
  const listPath = `${INTELLIGENCE_BASE}/trajectories`;

  const columns: DataTableColumn<Row>[] = [
    {
      id: "trajectory",
      header: "Trajectory",
      cell: ({ record }) => (
        <span className={styles.identity}>
          <Link
            className={styles.recordLink}
            to={`${listPath}/${encodeURIComponent(record.trajectoryId)}`}
          >
            {record.title}
          </Link>
          <small data-slot="identifier">{record.trajectoryId}</small>
        </span>
      ),
    },
    {
      id: "user",
      header: "User",
      cell: ({ record }) => (
        <span className={styles.identity}>
          <span>{record.user.name || "Name not recorded"}</span>
          <small data-slot="identifier">{record.user.id}</small>
        </span>
      ),
    },
    {
      id: "outcome",
      header: "Outcome",
      cell: ({ record }) => <OutcomeBadges outcome={record.outcome} />,
    },
    {
      id: "surfaces",
      header: "Surfaces",
      cell: ({ record }) => (
        <span className={shared.badges}>
          {record.surfaces.map((s) => (
            <Badge key={s} variant="neutral">
              {surfaceName(s)}
            </Badge>
          ))}
        </span>
      ),
    },
    {
      id: "activity",
      header: "First / last activity",
      cell: ({ record }) => (
        <span className={styles.identity}>
          <FormattedDateTime
            value={new Date(record.firstEventAt).toISOString()}
            invalidFallback="Date unavailable"
          />
          <small>
            <FormattedDateTime
              value={new Date(record.lastEventAt).toISOString()}
              invalidFallback="Date unavailable"
            />
          </small>
        </span>
      ),
    },
  ];

  return (
    <IntelligenceShell section={{ label: "User Trajectories", to: listPath }}>
      <section className="shell-page" aria-labelledby="trajectories-title">
        <div className={styles.page}>
          <WorkspacePageHeader
            headingLevel={1}
            title="Trajectories"
            titleId="trajectories-title"
            description="Explore the product activity behind your users’ workflows: each Trajectory joins their Threads with your agent, in the app and in ChatGPT, to what they then did in the product."
            actions={
              <div className={styles.actions}>
                <Button variant="ghost">Capture setup</Button>
              </div>
            }
          />
          <div className={styles.toolbar}>
            <SearchField
              className={styles.search}
              aria-label="Search loaded Trajectories"
              placeholder="Search loaded Trajectories"
              value={q}
              onChange={(event) => setQ(event.target.value)}
            />
            <Button
              variant="ghost"
              disabled={state.status === "loading"}
              onClick={() => setRevision((r) => r + 1)}
            >
              Refresh
            </Button>
          </div>
          <p className={styles.note}>Search covers loaded Trajectories only.</p>
          {state.status === "error" ? (
            <div role="alert" className={styles.error}>
              <strong>Saved Trajectories unavailable</strong>
              <p>{state.message}</p>
              <Button
                variant="outline"
                onClick={() => setRevision((r) => r + 1)}
              >
                Retry
              </Button>
            </div>
          ) : null}
          {state.status === "loading" && rows.length === 0 ? (
            <p role="status" className={styles.empty}>
              Loading Trajectories…
            </p>
          ) : (
            <DataTable<Row>
              ariaLabel="Trajectories"
              density="comfortable"
              columns={columns}
              rows={filtered.map((record) => ({ record }))}
              rowKey={({ record }) => record.trajectoryId}
              emptyMessage="No matches in loaded Trajectories."
            />
          )}
          <div className={styles.footer}>
            <span role="status">
              {filtered.length} of {rows.length} loaded Trajectories
            </span>
          </div>
        </div>
      </section>
    </IntelligenceShell>
  );
}
