"use client";

/**
 * Trajectories list. A new Intelligence screen, built only from the copied
 * Intelligence pieces: `WorkspacePageHeader`, the shell's `shell-page`
 * surface, and @cpki/ui's `DataTable` and `Badge`.
 */
import { useCallback } from "react";
import type { TrajectorySummary } from "../data/contract";
import { learningV1 } from "../data/client";
import { useLearningRequest } from "../learning/use-learning-request";
import { DataTable } from "../ui/data-display";
import { Badge, StatusMessage } from "../ui/feedback";
import { IntelligenceShell, INTELLIGENCE_BASE } from "../shell/intelligence-shell";
import { WorkspacePageHeader } from "../shell/workspace-page-header";
import { fmtDate, fmtDur, fmtTime, surfaceName } from "./trajectory-format";
import styles from "./intelligence-screens.module.css";

type Row = TrajectorySummary & Record<string, unknown>;

export function OutcomeBadges(props: { readonly outcome: TrajectorySummary["outcome"] }) {
  if (props.outcome === "agent_failed_user_completed") {
    return (
      <span className={styles.badges}>
        <Badge variant="danger">Agent failed</Badge>
        <Badge variant="success">User completed</Badge>
      </span>
    );
  }
  if (props.outcome === "agent_succeeded") return <Badge variant="success">Agent succeeded</Badge>;
  return <Badge variant="neutral">In progress</Badge>;
}

export function TrajectoriesScreen() {
  const load = useCallback((signal: AbortSignal) => learningV1.trajectories(signal), []);
  const state = useLearningRequest(load);
  const rows: Row[] =
    state.status === "ready" ? [...state.data].sort((a, b) => b.lastEventAt - a.lastEventAt).map((t) => ({ ...t })) : [];

  return (
    <IntelligenceShell section={{ label: "Trajectories", to: `${INTELLIGENCE_BASE}/trajectories` }}>
      <section className="shell-page" aria-labelledby="trajectories-title">
        <WorkspacePageHeader
          headingLevel={1}
          title="Trajectories"
          titleId="trajectories-title"
          description="Each trajectory joins the Threads a user had with your agent, in the app and in ChatGPT, to what they then did in the product themselves."
        />
        {state.status === "error" ? (
          <StatusMessage title="Trajectories could not be loaded" variant="danger">
            {state.message}
          </StatusMessage>
        ) : null}
        <div className="shell-data-table-card">
          <DataTable<Row>
            ariaLabel="Trajectories"
            rows={rows}
            rowKey={(row) => row.trajectoryId}
            // The trajectory view is a standalone page (Atai's prototype), so this is a full navigation.
            onRowClick={(row) => window.location.assign(`${INTELLIGENCE_BASE}/trajectories/${encodeURIComponent(row.trajectoryId)}`)}
            emptyMessage={state.status === "loading" ? "Loading trajectories…" : "No trajectories captured yet."}
            columns={[
              {
                id: "title",
                header: "Trajectory",
                cell: (row) => (
                  <span className={styles.titleCell}>
                    <strong>{row.title}</strong>
                    <span className={styles.mono}>{row.trajectoryId}</span>
                  </span>
                ),
              },
              { id: "outcome", header: "Outcome", cell: (row) => <OutcomeBadges outcome={row.outcome} /> },
              {
                id: "surfaces",
                header: "Surfaces",
                cell: (row) => (
                  <span className={styles.badges}>
                    {row.surfaces.map((s) => (
                      <Badge key={s} variant="neutral">
                        {surfaceName(s)}
                      </Badge>
                    ))}
                  </span>
                ),
              },
              { id: "user", header: "User", cell: (row) => row.user.name },
              { id: "events", header: "Events", align: "end", cell: (row) => row.eventCount },
              { id: "duration", header: "Duration", align: "end", cell: (row) => fmtDur(row.lastEventAt - row.firstEventAt) },
              {
                id: "last",
                header: "Last activity",
                cell: (row) => <span className={styles.mono}>{`${fmtDate(row.lastEventAt)}, ${fmtTime(row.lastEventAt).slice(0, 5)}`}</span>,
              },
            ]}
          />
        </div>
      </section>
    </IntelligenceShell>
  );
}
