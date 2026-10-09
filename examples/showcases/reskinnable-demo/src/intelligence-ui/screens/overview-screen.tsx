"use client";

/**
 * Project Overview, composed like Intelligence's `ProjectOverview`
 * (home/project-overview.tsx, main @ b71006350): the page header with the
 * period, the unboxed metric row, then the activity grid with Automatic
 * Learning's spaces and the most recent trajectories. Product Analytics' event
 * chart is left out (this demo records trajectories, not runtime metrics).
 */
import { Activity, AlertCircle, CalendarDays, UserCheck } from "lucide-react";
import { useCallback } from "react";
import { learningV1 } from "../data/client";
import { useLearningRequest } from "../learning/use-learning-request";
import { learningContainerRoute } from "../learning/learning-routes";
import {
  ledgerlineLearningApi,
  LEDGERLINE_PROJECT_ID,
} from "../ledgerline-learning-api";
import { isLegacyUnsupportedContainerStats } from "../learning/learning-api";
import {
  OverviewActivityGrid,
  OverviewLearningTable,
  OverviewMetricRow,
  OverviewRecentTable,
  OverviewSectionHeader,
} from "../overview/overview-activity";
import styles from "../overview/project-overview.module.css";
import {
  IntelligenceShell,
  INTELLIGENCE_BASE,
} from "../shell/intelligence-shell";
import { WorkspacePageHeader } from "../shell/workspace-page-header";
import { surfaceName } from "./trajectory-format";

const RECENT_ROWS = 5;

export function OverviewScreen() {
  const loadTrajectories = useCallback(
    (signal: AbortSignal) => learningV1.trajectories(signal),
    [],
  );
  const loadSkills = useCallback(
    (signal: AbortSignal) => learningV1.skills(signal),
    [],
  );
  const loadSpaces = useCallback(
    (signal: AbortSignal) =>
      ledgerlineLearningApi.listContainers(LEDGERLINE_PROJECT_ID, { signal }),
    [],
  );
  const loadStats = useCallback(
    (signal: AbortSignal) =>
      ledgerlineLearningApi.listContainerStats(LEDGERLINE_PROJECT_ID, {
        signal,
      }),
    [],
  );
  const trajectories = useLearningRequest(loadTrajectories);
  const skills = useLearningRequest(loadSkills);
  const spaces = useLearningRequest(loadSpaces);
  const stats = useLearningRequest(loadStats);

  const rows =
    trajectories.status === "ready"
      ? [...trajectories.data].sort((a, b) => b.lastEventAt - a.lastEventAt)
      : [];
  const failed = rows.filter(
    (t) => t.outcome === "agent_failed_user_completed",
  );
  const skillRows = skills.status === "ready" ? skills.data : [];
  const value = (status: string, n: number): string =>
    status === "ready" || status === "empty"
      ? n.toLocaleString()
      : status === "error"
        ? "Unavailable"
        : "Loading…";
  const statRows =
    stats.status === "ready" && !isLegacyUnsupportedContainerStats(stats.data)
      ? stats.data
      : [];

  return (
    <IntelligenceShell section={{ label: "Overview" }}>
      <section
        className={`shell-page ${styles.overview}`}
        aria-labelledby="project-overview-title"
      >
        <WorkspacePageHeader
          headingLevel={1}
          title="Overview"
          titleId="project-overview-title"
          description="Ledgerline"
          actions={
            <span className={styles.period}>
              <CalendarDays aria-hidden="true" size={15} />
              Last 7 days
            </span>
          }
        />
        <OverviewMetricRow
          metrics={[
            {
              label: "Trajectories",
              value: value(trajectories.status, rows.length),
              delta: "Captured in Ledgerline and ChatGPT",
              icon: Activity,
            },
            {
              label: "Agent failed",
              value: value(trajectories.status, failed.length),
              delta: "Finished by hand instead",
              icon: AlertCircle,
            },
            {
              label: "Skills published",
              value: value(
                skills.status,
                skillRows.filter((s) => s.status === "published").length,
              ),
              delta: `${skillRows.filter((s) => s.status === "candidate").length} awaiting review`,
              icon: UserCheck,
            },
          ]}
        />
        <OverviewActivityGrid>
          <section
            className={styles.activitySection}
            aria-labelledby="overview-learning-title"
          >
            <OverviewSectionHeader
              id="overview-learning-title"
              title="Automatic Learning"
              link={{
                label: "Open Automatic Learning",
                to: `${INTELLIGENCE_BASE}/learning`,
              }}
            />
            {spaces.status === "error" ? (
              <p className={styles.sectionNote} role="alert">
                Unable to load Learning Spaces. Open Automatic Learning to try
                again.
              </p>
            ) : spaces.status !== "ready" ? (
              <p className={styles.sectionNote} role="status">
                Loading Learning Spaces…
              </p>
            ) : (
              <OverviewLearningTable
                rows={spaces.data.containers.map((space) => {
                  const stat = statRows.find((s) => s.containerId === space.id);
                  return {
                    id: space.id,
                    name: space.name,
                    threadCount: stat?.threadCount ?? 0,
                    pendingThreadCount: stat?.pendingThreadCount ?? 0,
                    lastSucceededAt: stat?.lastSucceededAt ?? null,
                  };
                })}
                spaceTo={(space) =>
                  learningContainerRoute(INTELLIGENCE_BASE, space.id)
                }
              />
            )}
          </section>
          <section
            className={styles.activitySection}
            aria-labelledby="overview-recent-title"
          >
            <OverviewSectionHeader
              id="overview-recent-title"
              title="Recent trajectories"
              link={{
                label: "View all trajectories",
                to: `${INTELLIGENCE_BASE}/trajectories`,
              }}
            />
            {trajectories.status === "error" ? (
              <p className={styles.sectionNote} role="alert">
                {trajectories.message}
              </p>
            ) : trajectories.status !== "ready" ? (
              <p className={styles.sectionNote} role="status">
                Loading trajectories…
              </p>
            ) : (
              <OverviewRecentTable
                rows={rows.slice(0, RECENT_ROWS).map((t) => ({
                  id: t.trajectoryId,
                  name: t.title,
                  endUserId: t.user.name,
                  surface: t.surfaces.map(surfaceName).join(", "),
                  updatedAt: new Date(t.lastEventAt).toISOString(),
                }))}
                rowTo={(row) =>
                  `${INTELLIGENCE_BASE}/trajectories/${encodeURIComponent(row.id)}`
                }
              />
            )}
          </section>
        </OverviewActivityGrid>
      </section>
    </IntelligenceShell>
  );
}
