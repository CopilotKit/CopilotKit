"use client";

import { z } from "zod";
import { ExternalLink } from "lucide-react";
import {
  useAgent,
  useCopilotChatConfiguration,
} from "@copilotkit/react-core/v2";
import type { Issue, IssuePriority } from "@/components/pm-board/types";
import { PRIORITY_COLORS } from "@/components/pm-board/types";
import { requestFocusIssue } from "@/components/pm-board/board-events";
// Reuse the PersonProfile ticket-row design — same priority-dot + stacked
// id/title + status/priority/due chips + view button layout the dashboard's
// person profile uses for its open-tickets list. Keeps the two demo
// surfaces visually consistent.
import styles from "@/components/dashboard/person-profile.module.css";

/**
 * Render a list of issues inline in chat as a stack of ticket rows. The agent
 * passes either:
 *   - a list of issue ids → we look up the full record in agent.state.issues
 *   - inline issue objects → we render them directly
 *
 * The visual is intentionally the same as <PersonProfileView />'s ticket
 * rows so the "show me urgent" / "what's in flight" chips read like a
 * focused slice of that same profile pane.
 */
export const IssueTableProps = z.object({
  issueIds: z
    .array(z.string())
    .optional()
    .describe(
      "Issue ids to look up in agent state. Prefer this over passing full issue objects.",
    ),
  issues: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        description: z.string().optional(),
        status: z.enum(["Backlog", "Todo", "In Progress", "In Review", "Done"]),
        priority: z.enum(["Urgent", "High", "Med", "Low"]),
        assignee: z.string().optional(),
        labels: z.array(z.string()).optional(),
        dueDate: z.string().optional(),
      }),
    )
    .optional(),
  caption: z
    .string()
    .optional()
    .describe("Optional short caption shown above the rows."),
});

export type IssueTableArgs = z.infer<typeof IssueTableProps>;

export function IssueTable({ issueIds, issues, caption }: IssueTableArgs) {
  const config = useCopilotChatConfiguration();
  const { agent } = useAgent({ agentId: config?.agentId });
  const stateIssues = (agent.state?.issues as Issue[] | undefined) ?? [];

  let resolved: Issue[] = [];
  if (issues && issues.length > 0) {
    resolved = issues.map((i) => ({
      ...i,
      labels: i.labels ?? [],
      assignee: i.assignee ?? null,
      dueDate: i.dueDate ?? null,
      description: i.description ?? "",
    })) as Issue[];
  } else if (issueIds && issueIds.length > 0) {
    resolved = issueIds
      .map((id) => stateIssues.find((i) => i.id === id))
      .filter((i): i is Issue => Boolean(i));
  }

  if (resolved.length === 0) {
    return (
      <div
        style={{
          fontSize: 12,
          color: "#838389",
          fontStyle: "italic",
        }}
      >
        No issues to show.
      </div>
    );
  }

  return (
    <div className="gen-ui-enter flex flex-col gap-2 my-2">
      {caption && <div className={styles.sectionTitle}>{caption}</div>}
      <div className={styles.ticketGrid}>
        {resolved.map((issue, idx) => (
          <TicketRow key={issue.id} issue={issue} styleIndex={idx} />
        ))}
      </div>
    </div>
  );
}

function TicketRow({
  issue,
  styleIndex,
}: {
  issue: Issue;
  styleIndex: number;
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
        >
          <ExternalLink className="h-3 w-3" />
          View
        </button>
      </div>
    </div>
  );
}

function formatDueDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}
