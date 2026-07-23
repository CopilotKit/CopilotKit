"use client";

import { useMemo } from "react";
import {
  ExternalLink,
  Sparkles,
  Target,
  Activity,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import type { Issue, IssuePriority } from "@/components/pm-board/types";
import {
  ASSIGNEE_COLORS,
  PRIORITY_COLORS,
  assigneeInitials,
} from "@/components/pm-board/types";
import { requestFocusIssue } from "@/components/pm-board/board-events";
import styles from "./person-profile.module.css";

// Re-export the stylesheet so the dashboard's buildingProfile view can
// reuse the same .root / .statsRow classes and keep layout identical
// across the paint-in → personProfile flip.
export { styles as personProfileStyles };

/**
 * Person profile view — the hardcoded "Show me everything Sarah is working
 * on" demo response. Renders a profile-style page (avatar header, quick
 * stats, AI insight, ticket list) with a staggered fade/slide entrance
 * animation. Each child gets a CSS variable --stagger-i so the same
 * animation can offset its delay per row.
 *
 * Intentionally NOT agent-driven beyond reading agent.state.issues — the
 * focus copy and AI insight are hardcoded by the suggestion interceptor in
 * App.tsx so the demo plays the same every time.
 */
export function PersonProfileView({
  person,
  issues,
  insight,
}: {
  person: string;
  issues: Issue[];
  insight?: string;
}) {
  const personIssues = useMemo(
    () => issues.filter((i) => i.assignee === person),
    [issues, person],
  );

  const stats = useMemo(() => {
    const total = personIssues.length;
    const inProgress = personIssues.filter(
      (i) => i.status === "In Progress",
    ).length;
    const urgent = personIssues.filter(
      (i) => i.priority === "Urgent" || i.priority === "High",
    ).length;
    const completed = personIssues.filter((i) => i.status === "Done").length;
    return { total, inProgress, urgent, completed };
  }, [personIssues]);

  const accent = ASSIGNEE_COLORS[person] ?? "#bec2ff";

  // Roles are hardcoded per assignee to give the profile a believable
  // "person" feel without wiring real HR data.
  const role = ROLES[person] ?? "Product Engineer";

  const upcoming = useMemo(() => {
    return [...personIssues].sort(rankIssue).slice(0, 8);
  }, [personIssues]);

  return (
    <div className={styles.root}>
      <ProfileHeader
        person={person}
        role={role}
        accent={accent}
        focusCount={stats.total}
        styleIndex={0}
      />

      <div className={styles.statsRow}>
        <StatCard
          label="Total"
          value={stats.total}
          Icon={Target}
          tone="#010507"
          styleIndex={1}
        />
        <StatCard
          label="In progress"
          value={stats.inProgress}
          Icon={Activity}
          tone="#189370"
          styleIndex={2}
        />
        <StatCard
          label="Urgent / High"
          value={stats.urgent}
          Icon={AlertTriangle}
          tone="#fa5f67"
          styleIndex={3}
        />
        <StatCard
          label="Shipped"
          value={stats.completed}
          Icon={CheckCircle2}
          tone="#57575b"
          styleIndex={4}
        />
      </div>

      <InsightCard
        accent={accent}
        text={
          insight ??
          `${person} is balancing ${stats.inProgress} active ticket${
            stats.inProgress === 1 ? "" : "s"
          } with ${stats.urgent} marked urgent or high. Watch the GDPR data export and Q3 roadmap kickoff — those are the load-bearing items this week.`
        }
        styleIndex={5}
      />

      <SectionTitle styleIndex={6}>Open work</SectionTitle>

      <div className={styles.ticketGrid}>
        {upcoming.map((issue, idx) => (
          <TicketRow
            key={issue.id}
            issue={issue}
            styleIndex={7 + idx}
            accent={accent}
          />
        ))}
        {upcoming.length === 0 && (
          <div className={styles.empty}>No open tickets for {person}.</div>
        )}
      </div>
    </div>
  );
}

// -------------------------------------------------------- subcomponents
//
// Exported so the dashboard's `buildingProfile` paint-in view can reuse
// the same JSX/CSS. Keeping a single source of truth means the paint-in
// → personProfile transition lands the same children at the same
// positions with the same styling — no visible layout shift.

export function ProfileHeader({
  person,
  role,
  accent,
  focusCount,
  styleIndex,
}: {
  person: string;
  role: string;
  accent: string;
  focusCount: number;
  styleIndex: number;
}) {
  return (
    <div
      className={styles.headerCard}
      style={{ "--stagger-i": styleIndex } as React.CSSProperties}
    >
      <div className={styles.avatarLarge} style={{ background: accent }}>
        {assigneeInitials(person)}
      </div>
      <div className={styles.headerMeta}>
        <div className={styles.eyebrow}>Workload profile</div>
        <h2 className={styles.headerName}>{person}</h2>
        <div className={styles.headerRole}>{role}</div>
      </div>
      <div className={styles.headerBadge}>
        <Sparkles style={{ width: 12, height: 12, color: accent }} />
        {focusCount} ticket{focusCount === 1 ? "" : "s"} in scope
      </div>
    </div>
  );
}

export function StatCard({
  label,
  value,
  Icon,
  tone,
  styleIndex,
}: {
  label: string;
  value: number;
  Icon: typeof Target;
  tone: string;
  styleIndex: number;
}) {
  return (
    <div
      className={styles.statCard}
      style={{ "--stagger-i": styleIndex } as React.CSSProperties}
    >
      <div className={styles.statLabel}>
        <Icon style={{ width: 12, height: 12, color: tone }} />
        {label}
      </div>
      <div className={styles.statValue}>{value}</div>
    </div>
  );
}

export function InsightCard({
  accent,
  text,
  styleIndex,
}: {
  accent: string;
  text: string;
  styleIndex: number;
}) {
  return (
    <div
      className={styles.insightCard}
      style={
        {
          "--stagger-i": styleIndex,
          borderLeft: `3px solid ${accent}`,
        } as React.CSSProperties
      }
    >
      <div className={styles.insightLabel}>
        <Sparkles style={{ width: 12, height: 12, color: accent }} />
        AI insight
      </div>
      <div className={styles.insightBody}>{text}</div>
    </div>
  );
}

export function SectionTitle({
  children,
  styleIndex,
}: {
  children: React.ReactNode;
  styleIndex: number;
}) {
  return (
    <div
      className={styles.sectionTitle}
      style={{ "--stagger-i": styleIndex } as React.CSSProperties}
    >
      {children}
    </div>
  );
}

function TicketRow({
  issue,
  styleIndex,
  accent,
}: {
  issue: Issue;
  styleIndex: number;
  accent: string;
}) {
  const priorityColor = PRIORITY_COLORS[issue.priority as IssuePriority];
  return (
    <div
      className={styles.ticketRow}
      style={{ "--stagger-i": styleIndex } as React.CSSProperties}
    >
      <div className={styles.ticketLeft}>
        <span
          className={styles.priorityDot}
          style={{ background: priorityColor }}
        />
        <div className={styles.ticketInfo}>
          <div className={styles.ticketId}>{issue.id}</div>
          <div className={styles.ticketTitle}>{issue.title}</div>
        </div>
      </div>
      <div className={styles.ticketMeta}>
        <span className={styles.statusChip}>{issue.status}</span>
        <span
          className={styles.priorityChip}
          style={{ color: priorityColor, borderColor: `${priorityColor}40` }}
        >
          {issue.priority}
        </span>
        {issue.dueDate && (
          <span className={styles.dueChip}>{formatDueDate(issue.dueDate)}</span>
        )}
        <button
          className={styles.viewButton}
          onClick={() => requestFocusIssue(issue.id)}
          style={{ borderColor: `${accent}55` }}
        >
          <ExternalLink className="h-3 w-3" />
          View
        </button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------- helpers

const PRIORITY_RANK: Record<IssuePriority, number> = {
  Urgent: 0,
  High: 1,
  Med: 2,
  Low: 3,
};

const STATUS_RANK: Record<string, number> = {
  "In Progress": 0,
  "In Review": 1,
  Todo: 2,
  Backlog: 3,
  Done: 4,
};

function rankIssue(a: Issue, b: Issue): number {
  const sa = STATUS_RANK[a.status] ?? 99;
  const sb = STATUS_RANK[b.status] ?? 99;
  if (sa !== sb) return sa - sb;
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
}

export const ROLES: Record<string, string> = {
  Sarah: "Senior Product Manager",
  Alex: "Staff Software Engineer",
  Jordan: "Infrastructure Engineer",
  Priya: "Product Designer",
};

function formatDueDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}
