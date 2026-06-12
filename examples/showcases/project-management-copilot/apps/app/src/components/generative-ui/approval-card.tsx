"use client";

import { useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import {
  useAgent,
  useCopilotChatConfiguration,
} from "@copilotkit/react-core/v2";
import type {
  Issue,
  IssuePriority,
  IssueStatus,
} from "@/components/pm-board/types";
import {
  ASSIGNEE_COLORS,
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  PRIORITY_COLORS,
  assigneeInitials,
} from "@/components/pm-board/types";

export interface ApprovalCardProps {
  status: "inProgress" | "executing" | "complete";
  respond?: (response: string) => void;
  issueId?: string;
  changes?: Record<string, unknown>;
}

const ASSIGNEES = ["Alex", "Sarah", "Jordan", "Priya"];

/**
 * Approval card rendered by useHumanInTheLoop for proposeIssueMutation.
 * Three branches:
 *
 *   Accept → respond with "accepted" + apply changes via agent.setState.
 *   Reject → respond with "rejected", no state change.
 *   Edit   → user tweaks status/priority/assignee inline, then accepts —
 *            applies the *edited* changes.
 */
export function ApprovalCard({
  status,
  respond,
  issueId,
  changes = {},
}: ApprovalCardProps) {
  const config = useCopilotChatConfiguration();
  const { agent } = useAgent({ agentId: config?.agentId });
  const issues = (agent.state?.issues as Issue[] | undefined) ?? [];
  const issue = issueId ? issues.find((i) => i.id === issueId) : undefined;

  const [editing, setEditing] = useState(false);
  const [localChanges, setLocalChanges] =
    useState<Record<string, unknown>>(changes);
  const [decision, setDecision] = useState<"accepted" | "rejected" | null>(
    null,
  );

  const applyChanges = (finalChanges: Record<string, unknown>) => {
    if (!issue) return;
    const updated = issues.map((i) =>
      i.id === issueId ? { ...i, ...finalChanges } : i,
    );
    agent.setState({ issues: updated });
  };

  const handleAccept = () => {
    applyChanges(localChanges);
    setDecision("accepted");
    respond?.(
      `User accepted the change to ${issueId}: ${JSON.stringify(localChanges)}. The change is now applied.`,
    );
  };

  const handleReject = () => {
    setDecision("rejected");
    respond?.(
      `User rejected the change to ${issueId}. Do not retry; ask what they'd prefer.`,
    );
  };

  // Streaming partial args — show a loading placeholder.
  if (!issueId || status === "inProgress") {
    return (
      <div
        style={{
          padding: 12,
          fontSize: 12,
          color: "#838389",
          background: "rgba(255,255,255,0.5)",
          border: "2px solid #ffffff",
          borderRadius: 8,
        }}
      >
        Preparing approval card{issueId ? ` for ${issueId}` : ""}…
      </div>
    );
  }

  if (!issue) {
    return (
      <div
        style={{
          padding: 12,
          fontSize: 12,
          color: "#838389",
          background: "rgba(255,255,255,0.5)",
          border: "2px solid #ffffff",
          borderRadius: 8,
        }}
      >
        Issue {issueId} not found in current state.
      </div>
    );
  }

  // Confirmed state
  if (decision === "accepted") {
    return (
      <Confirmed
        title={`Updated ${issueId}`}
        subtitle={summarizeChanges(localChanges)}
        accent="#189370"
        icon={<Check className="h-4 w-4 text-white" strokeWidth={3} />}
      />
    );
  }
  if (decision === "rejected") {
    return (
      <Confirmed
        title="Change rejected"
        subtitle={issue.title}
        accent="#838389"
        icon={<X className="h-4 w-4 text-white" strokeWidth={3} />}
      />
    );
  }

  const merged: Issue = { ...issue, ...(localChanges as Partial<Issue>) };

  return (
    <div
      className="max-w-md w-full"
      style={{
        background: "rgba(255, 255, 255, 0.65)",
        border: "2px solid #ffffff",
        borderRadius: 8,
        padding: 14,
        marginBottom: 8,
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        boxShadow: "0px 1px 3px 0px rgba(1, 5, 7, 0.08)",
      }}
    >
      {/* Header */}
      <div
        style={{
          fontSize: 10,
          fontWeight: 400,
          color: "#57575b",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          marginBottom: 6,
        }}
      >
        Proposed change · {issueId}
      </div>
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "#010507",
          lineHeight: 1.3,
          marginBottom: 8,
        }}
      >
        {issue.title}
      </div>

      {/* Field rows — show current vs. proposed (or editable input in edit mode) */}
      <div className="space-y-2">
        <FieldRow
          label="Status"
          current={issue.status}
          proposed={merged.status}
          editing={editing}
          render={(_, set) => (
            <select
              value={merged.status}
              onChange={(e) => set("status", e.target.value as IssueStatus)}
              style={selectStyle}
            >
              {ISSUE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
          onChange={(v) =>
            setLocalChanges((c) => ({ ...c, status: v as IssueStatus }))
          }
        />
        <FieldRow
          label="Priority"
          current={<PriorityChip priority={issue.priority as IssuePriority} />}
          proposed={
            <PriorityChip priority={merged.priority as IssuePriority} />
          }
          editing={editing}
          render={(_, set) => (
            <select
              value={merged.priority}
              onChange={(e) => set("priority", e.target.value as IssuePriority)}
              style={selectStyle}
            >
              {ISSUE_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          )}
          onChange={(v) =>
            setLocalChanges((c) => ({ ...c, priority: v as IssuePriority }))
          }
        />
        <FieldRow
          label="Assignee"
          current={<AssigneeChip assignee={issue.assignee ?? null} />}
          proposed={<AssigneeChip assignee={merged.assignee ?? null} />}
          editing={editing}
          render={(_, set) => (
            <select
              value={merged.assignee ?? ""}
              onChange={(e) => set("assignee", e.target.value || null)}
              style={selectStyle}
            >
              <option value="">Unassigned</option>
              {ASSIGNEES.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          )}
          onChange={(v) => setLocalChanges((c) => ({ ...c, assignee: v }))}
        />
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 mt-3">
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 cursor-pointer"
            style={{
              padding: "5px 10px",
              border: "1px solid #dbdbe5",
              borderRadius: 6,
              background: "transparent",
              fontSize: 12,
              fontWeight: 500,
              color: "#57575b",
            }}
            disabled={status !== "executing"}
          >
            <Pencil className="h-3 w-3" />
            Edit
          </button>
        )}
        <button
          onClick={handleReject}
          className="cursor-pointer"
          style={{
            padding: "5px 12px",
            border: "1px solid #dbdbe5",
            borderRadius: 6,
            background: "rgba(255,255,255,0.65)",
            fontSize: 12,
            fontWeight: 500,
            color: "#010507",
          }}
          disabled={status !== "executing"}
        >
          Reject
        </button>
        <button
          onClick={handleAccept}
          className="cursor-pointer"
          style={{
            padding: "5px 12px",
            border: "0",
            borderRadius: 6,
            background: "#010507",
            fontSize: 12,
            fontWeight: 600,
            color: "#ffffff",
          }}
          disabled={status !== "executing"}
        >
          {editing ? "Apply" : "Accept"}
        </button>
      </div>
    </div>
  );
}

function Confirmed({
  title,
  subtitle,
  accent,
  icon,
}: {
  title: string;
  subtitle: string;
  accent: string;
  icon: React.ReactNode;
}) {
  return (
    <div
      className="max-w-md w-full"
      style={{
        background: "rgba(255, 255, 255, 0.65)",
        border: "2px solid #ffffff",
        borderRadius: 8,
        padding: 12,
        marginBottom: 8,
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <div
        className="flex items-center justify-center rounded-full"
        style={{ width: 24, height: 24, background: accent }}
      >
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#010507" }}>
          {title}
        </div>
        <div style={{ fontSize: 11, color: "#57575b" }}>{subtitle}</div>
      </div>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  color: "#010507",
  background: "#ffffff",
  border: "1px solid #dbdbe5",
  borderRadius: 6,
  padding: "3px 8px",
  fontFamily: "var(--font-body)",
  cursor: "pointer",
};

function FieldRow({
  label,
  current,
  proposed,
  editing,
  render,
  onChange,
}: {
  label: string;
  current: React.ReactNode;
  proposed: React.ReactNode;
  editing: boolean;
  render: (
    val: React.ReactNode,
    set: (key: string, value: unknown) => void,
  ) => React.ReactNode;
  onChange: (val: unknown) => void;
}) {
  const same =
    typeof current === "string" &&
    typeof proposed === "string" &&
    current === proposed;
  return (
    <div
      className="flex items-center gap-2"
      style={{
        background: "rgba(255,255,255,0.65)",
        borderRadius: 6,
        padding: "5px 8px",
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 400,
          color: "#838389",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          minWidth: 60,
        }}
      >
        {label}
      </span>
      {editing ? (
        render(proposed, (_, v) => onChange(v))
      ) : (
        <div className="flex items-center gap-2 text-[12px]">
          {!same && (
            <>
              <span
                style={{ color: "#838389", textDecoration: "line-through" }}
              >
                {current}
              </span>
              <span style={{ color: "#838389" }}>→</span>
            </>
          )}
          <span style={{ color: "#010507", fontWeight: 500 }}>{proposed}</span>
        </div>
      )}
    </div>
  );
}

function PriorityChip({ priority }: { priority: IssuePriority }) {
  const c = PRIORITY_COLORS[priority];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-1.5 py-[1px]"
      style={{
        background: "rgba(255,255,255,0.65)",
        border: `1px solid ${c}40`,
        fontSize: 10,
        fontWeight: 500,
        color: c,
      }}
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: c }}
      />
      {priority}
    </span>
  );
}

function AssigneeChip({ assignee }: { assignee: string | null }) {
  if (!assignee) {
    return <span style={{ fontSize: 11, color: "#838389" }}>Unassigned</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="h-4 w-4 rounded-full flex items-center justify-center"
        style={{
          background: ASSIGNEE_COLORS[assignee] ?? "#dbdbe5",
          fontSize: 8,
          fontWeight: 700,
          color: "#010507",
        }}
      >
        {assigneeInitials(assignee)}
      </span>
      <span style={{ fontSize: 11, color: "#010507" }}>{assignee}</span>
    </span>
  );
}

function summarizeChanges(changes: Record<string, unknown>): string {
  return Object.entries(changes)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(" · ");
}
