"use client";

/**
 * Project overview, composed like Intelligence's `ProjectOverview`
 * (home/project-overview.tsx): page header, metric tiles, then the
 * activity grid with Automatic Learning and the newest trajectories.
 */
import { Activity, AlertCircle, ChevronRight, Layers, Route, UserCheck } from "lucide-react";
import { useCallback } from "react";
import { learningV1 } from "../data/client";
import { useLearningRequest } from "../learning/use-learning-request";
import { learningContainerRoute } from "../learning/learning-routes";
import { LEDGERLINE_CONTAINER_ID } from "../ids";
import { MetricTile } from "../overview/MetricTile";
import styles from "../overview/project-overview.module.css";
import { IntelligenceShell, INTELLIGENCE_BASE } from "../shell/intelligence-shell";
import { Link } from "../shell/router";
import { WorkspacePageHeader } from "../shell/workspace-page-header";
import { outcomeText } from "./trajectory-format";

export function OverviewScreen() {
  const loadTrajectories = useCallback((signal: AbortSignal) => learningV1.trajectories(signal), []);
  const loadInsights = useCallback((signal: AbortSignal) => learningV1.insights(signal), []);
  const loadSkills = useCallback((signal: AbortSignal) => learningV1.skills(signal), []);
  const trajectories = useLearningRequest(loadTrajectories);
  const insights = useLearningRequest(loadInsights);
  const skills = useLearningRequest(loadSkills);

  const rows = trajectories.status === "ready" ? [...trajectories.data].sort((a, b) => b.lastEventAt - a.lastEventAt) : [];
  const failed = rows.filter((t) => t.outcome === "agent_failed_user_completed");
  const value = (status: string, n: number): string =>
    status === "ready" || status === "empty" ? n.toLocaleString() : status === "error" ? "Unavailable" : "Loading…";
  const insightCount = insights.status === "ready" ? insights.data.length : 0;
  const skillRows = skills.status === "ready" ? skills.data : [];

  return (
    <IntelligenceShell>
      <section className={`shell-page ${styles.overview}`} aria-labelledby="project-overview-title">
        <WorkspacePageHeader
          headingLevel={1}
          title="Ledgerline"
          titleId="project-overview-title"
          description="Review your conversations, understand how your app is used, and find the next workflow."
        />
        <section className={styles.activitySection} aria-labelledby="overview-trajectories-metrics">
          <div className={styles.sectionHeader}>
            <h2 id="overview-trajectories-metrics">Trajectories</h2>
            <Link to={`${INTELLIGENCE_BASE}/trajectories`}>Open Trajectories</Link>
          </div>
          <p>What the agent did, and what people did in the app, joined into one record.</p>
          <div className={styles.metrics}>
            <MetricTile metric={{ label: "Trajectories", value: value(trajectories.status, rows.length), delta: "Captured in Ledgerline", icon: Activity, state: "neutral" }} />
            <MetricTile metric={{ label: "Agent failed", value: value(trajectories.status, failed.length), delta: "Finished by hand instead", icon: AlertCircle, state: failed.length ? "warn" : "neutral" }} />
            <MetricTile metric={{ label: "Skills published", value: value(skills.status, skillRows.filter((s) => s.status === "published").length), delta: `${skillRows.filter((s) => s.status === "candidate").length} awaiting review`, icon: UserCheck, state: "neutral" }} />
          </div>
        </section>
        <div className={styles.activityGrid}>
          <section className={styles.activitySection} aria-labelledby="overview-learning-title">
            <div className={styles.sectionHeader}>
              <h2 id="overview-learning-title">Automatic Learning</h2>
              <Link to={`${INTELLIGENCE_BASE}/learning`}>Open Automatic Learning</Link>
            </div>
            <p>Review collected conversations and analysis in your Learning Spaces.</p>
            <ul className={styles.activityList}>
              <li>
                <Link to={learningContainerRoute(INTELLIGENCE_BASE, LEDGERLINE_CONTAINER_ID)}>
                  <Layers size={18} className={styles.resourceIcon} aria-hidden="true" />
                  <strong>Ledgerline Expenses</strong>
                  <ChevronRight size={16} className={styles.resourceArrow} aria-hidden="true" />
                  <span>{`${rows.length} trajectories · ${failed.length} with a manual reference path`}</span>
                  <span>{insightCount ? `${insightCount} Insights from the latest analysis` : "No analysis yet"}</span>
                </Link>
              </li>
            </ul>
          </section>
          <section className={styles.activitySection} aria-labelledby="overview-recent-title">
            <div className={styles.sectionHeader}>
              <h2 id="overview-recent-title">Recent trajectories</h2>
              <Link to={`${INTELLIGENCE_BASE}/trajectories`}>View all trajectories</Link>
            </div>
            <p>Most recently updated trajectories in this project.</p>
            {trajectories.status === "error" ? <p role="alert">{trajectories.message}</p> : null}
            <ul className={styles.activityList}>
              {rows.slice(0, 4).map((t) => (
                <li key={t.trajectoryId}>
                  <a href={`${INTELLIGENCE_BASE}/trajectories/${encodeURIComponent(t.trajectoryId)}`}>
                    <Route size={18} className={styles.resourceIcon} aria-hidden="true" />
                    <strong>{t.title}</strong>
                    <ChevronRight size={16} className={styles.resourceArrow} aria-hidden="true" />
                    <span>{`${outcomeText(t.outcome)} · ${t.user.name}`}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </section>
    </IntelligenceShell>
  );
}
