"use client";

import { z } from "zod";
import { ExternalLink } from "lucide-react";
import type { IssuePriority, IssueStatus } from "@/components/pm-board/types";
import {
  ASSIGNEE_COLORS,
  PRIORITY_COLORS,
  assigneeInitials,
} from "@/components/pm-board/types";
import { requestFocusIssue } from "@/components/pm-board/board-events";

/**
 * Schema for the agent-side render. The agent passes the issue payload via
 * the tool-call args; the frontend re-renders this card inline in chat.
 */
export const IssueCardProps = z.object({
  id: z.string().describe("The issue id, e.g. ISS-101"),
  title: z.string().describe("Short title (~5-10 words)"),
  description: z.string().optional(),
  status: z
    .enum(["Backlog", "Todo", "In Progress", "In Review", "Done"])
    .describe("Current kanban status"),
  priority: z.enum(["Urgent", "High", "Med", "Low"]),
  // No .nullable() — Google ADK's Schema validator rejects array-form
  // types like ["string", "null"] (Pydantic enum failure). Frontend treats
  // missing assignee / dueDate as null already, so .optional() is enough.
  assignee: z.string().optional(),
  labels: z.array(z.string()).optional(),
  dueDate: z.string().optional(),
});

export type IssueCardArgs = z.infer<typeof IssueCardProps>;

export function IssueCardChip({
  id,
  title,
  description,
  status,
  priority,
  assignee,
  labels = [],
  dueDate,
}: IssueCardArgs) {
  const priorityColor = PRIORITY_COLORS[priority as IssuePriority];
  const assigneeColor = (assignee && ASSIGNEE_COLORS[assignee]) ?? "#dbdbe5";

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
      <div className="flex items-center gap-2 mb-1.5">
        <span
          style={{
            fontFamily: "Spline Sans Mono, ui-monospace, monospace",
            fontSize: 10,
            fontWeight: 500,
            color: "#838389",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {id}
        </span>
        <span
          className="inline-flex items-center gap-1 rounded-full px-1.5 py-[1px]"
          style={{
            background: "rgba(255,255,255,0.65)",
            border: `1px solid ${priorityColor}40`,
            fontSize: 10,
            fontWeight: 500,
            color: priorityColor,
          }}
        >
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: priorityColor }}
          />
          {priority}
        </span>
        <span
          className="rounded-full px-1.5 py-[1px] text-[10px] font-medium"
          style={{ background: "rgba(255,255,255,0.65)", color: "#010507" }}
        >
          {status as IssueStatus}
        </span>
      </div>

      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "#010507",
          lineHeight: 1.3,
        }}
      >
        {title}
      </div>

      {description ? (
        <p
          style={{
            marginTop: 4,
            fontSize: 11,
            lineHeight: 1.5,
            color: "#57575b",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {description}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-2 mt-2">
        <div className="flex flex-wrap gap-1 min-w-0">
          {labels.slice(0, 3).map((label) => (
            <span
              key={label}
              className="rounded-full px-1.5 py-[1px]"
              style={{
                background: "rgba(255,255,255,0.65)",
                fontSize: 10,
                fontWeight: 500,
                color: "#010507",
              }}
            >
              {label}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-1.5 flex-none">
          {dueDate && (
            <span
              className="tabular-nums"
              style={{ fontSize: 10, color: "#838389" }}
            >
              {formatDueDate(dueDate)}
            </span>
          )}
          <div
            title={assignee ?? "Unassigned"}
            className="h-5 w-5 rounded-full flex items-center justify-center"
            style={{
              background: assigneeColor,
              fontSize: 9,
              fontWeight: 700,
              color: "#010507",
            }}
          >
            {assigneeInitials(assignee)}
          </div>
        </div>
      </div>

      <button
        onClick={() => requestFocusIssue(id)}
        className="mt-3 inline-flex items-center gap-1 cursor-pointer"
        style={{
          background: "#ffffff",
          border: "1px solid #dbdbe5",
          borderRadius: 6,
          padding: "4px 10px",
          fontSize: 12,
          fontWeight: 500,
          color: "#010507",
        }}
      >
        <ExternalLink className="h-3 w-3" />
        View on board
      </button>
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
