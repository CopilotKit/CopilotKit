"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Issue, IssuePriority, IssueStatus } from "./types";
import {
  ASSIGNEE_COLORS,
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  PRIORITY_COLORS,
  assigneeInitials,
} from "./types";
import { onFocusIssue } from "./board-events";

interface IssueCardProps {
  issue: Issue;
  onUpdate: (changes: Partial<Issue>) => void;
  onDelete: () => void;
}

export function IssueCard({ issue, onUpdate, onDelete }: IssueCardProps) {
  const [editing, setEditing] = useState<"title" | "description" | null>(null);
  const [editValue, setEditValue] = useState("");
  const [showMenu, setShowMenu] = useState<"priority" | "status" | null>(null);
  const [flash, setFlash] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Listen for "focus this issue" requests from inline chat cards.
  useEffect(() => {
    const unsub = onFocusIssue((id) => {
      if (id !== issue.id) return;
      rootRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      setFlash(true);
      window.setTimeout(() => setFlash(false), 1400);
    });
    return unsub;
  }, [issue.id]);

  const startEdit = (field: "title" | "description") => {
    setEditing(field);
    setEditValue(field === "title" ? issue.title : (issue.description ?? ""));
  };

  const saveEdit = () => {
    if (!editing) return;
    if (editValue.trim()) {
      onUpdate({ [editing]: editValue.trim() } as Partial<Issue>);
    }
    setEditing(null);
    setEditValue("");
  };

  const cancelEdit = () => {
    setEditing(null);
    setEditValue("");
  };

  const setPriority = (p: IssuePriority) => {
    onUpdate({ priority: p });
    setShowMenu(null);
  };

  const setStatus = (s: IssueStatus) => {
    onUpdate({ status: s });
    setShowMenu(null);
  };

  const assigneeColor =
    (issue.assignee && ASSIGNEE_COLORS[issue.assignee]) ?? "#dbdbe5";

  return (
    <div
      ref={rootRef}
      data-issue-id={issue.id}
      className={cn(
        "group relative rounded-lg p-3 transition-all duration-150",
        "bg-white/60 border border-white hover:bg-white/80",
        "shadow-[0_1px_3px_0_rgba(1,5,7,0.05)]",
        flash && "ring-2 ring-[#bec2ff] ring-offset-2 ring-offset-[#dedee9]",
      )}
      style={{ backdropFilter: "blur(6px)" }}
    >
      <button
        onClick={onDelete}
        className="absolute top-1.5 right-1.5 h-5 w-5 rounded-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/5 cursor-pointer"
        aria-label="Delete issue"
      >
        <X className="h-3 w-3 text-[#57575b]" />
      </button>

      {/* ID + Priority pill */}
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className="font-mono text-[10px] tracking-wide text-[#838389] uppercase select-none"
          style={{ fontFamily: "Spline Sans Mono, ui-monospace, monospace" }}
        >
          {issue.id}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowMenu(showMenu === "priority" ? null : "priority");
          }}
          className="inline-flex items-center gap-1 rounded-full px-1.5 py-[1px] text-[10px] font-medium cursor-pointer hover:opacity-80"
          style={{
            background: "rgba(255,255,255,0.65)",
            color: PRIORITY_COLORS[issue.priority],
            border: `1px solid ${PRIORITY_COLORS[issue.priority]}40`,
          }}
        >
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: PRIORITY_COLORS[issue.priority] }}
          />
          {issue.priority}
        </button>
        {showMenu === "priority" && (
          <div
            className="absolute z-30 mt-1 top-7 left-12 rounded bg-white border border-[#dbdbe5] p-1 flex flex-col gap-0.5 min-w-[110px]"
            style={{ boxShadow: "0px 6px 6px -2px rgba(1, 5, 7, 0.08)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {ISSUE_PRIORITIES.map((p) => (
              <button
                key={p}
                onClick={() => setPriority(p)}
                className={cn(
                  "text-left text-[12px] px-2 py-1 rounded hover:bg-[#f0f0f4] flex items-center gap-2",
                  p === issue.priority && "bg-[#f0f0f4]",
                )}
              >
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ background: PRIORITY_COLORS[p] }}
                />
                {p}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Title */}
      {editing === "title" ? (
        <input
          autoFocus
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={saveEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveEdit();
            if (e.key === "Escape") cancelEdit();
          }}
          className="w-full text-[13px] font-semibold bg-transparent text-[#010507] focus:outline-none border-b border-[#bec2ff] pb-0.5"
        />
      ) : (
        <div
          onClick={() => startEdit("title")}
          className="text-[13px] font-semibold leading-snug cursor-text text-[#010507] break-words"
        >
          {issue.title}
        </div>
      )}

      {/* Description (truncated, optional) */}
      {editing === "description" ? (
        <textarea
          autoFocus
          rows={3}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={saveEdit}
          onKeyDown={(e) => {
            if (e.key === "Escape") cancelEdit();
          }}
          className="mt-1 w-full text-[11px] leading-relaxed bg-transparent text-[#57575b] focus:outline-none border-b border-[#bec2ff] resize-none"
        />
      ) : issue.description ? (
        <p
          onClick={() => startEdit("description")}
          className="mt-1 text-[11px] leading-relaxed text-[#57575b] cursor-text line-clamp-2"
        >
          {issue.description}
        </p>
      ) : null}

      {/* Footer: labels + assignee + due date */}
      <div className="flex items-center justify-between gap-2 mt-2">
        <div className="flex flex-wrap gap-1 min-w-0">
          {(issue.labels ?? []).slice(0, 3).map((label) => (
            <span
              key={label}
              className="rounded-full px-1.5 py-[1px] text-[10px] font-medium text-[#010507]"
              style={{ background: "rgba(255,255,255,0.65)" }}
            >
              {label}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-1.5 flex-none">
          {issue.dueDate && (
            <span className="text-[10px] text-[#838389] tabular-nums">
              {formatDueDate(issue.dueDate)}
            </span>
          )}
          <div
            title={issue.assignee ?? "Unassigned"}
            className="h-5 w-5 rounded-full flex items-center justify-center text-[9px] font-bold text-[#010507]"
            style={{ background: assigneeColor }}
          >
            {assigneeInitials(issue.assignee)}
          </div>
        </div>
      </div>

      {showMenu === "status" && (
        <div
          className="absolute z-30 right-2 top-8 rounded bg-white border border-[#dbdbe5] p-1 flex flex-col gap-0.5 min-w-[140px]"
          style={{ boxShadow: "0px 6px 6px -2px rgba(1, 5, 7, 0.08)" }}
          onClick={(e) => e.stopPropagation()}
        >
          {ISSUE_STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={cn(
                "text-left text-[12px] px-2 py-1 rounded hover:bg-[#f0f0f4]",
                s === issue.status && "bg-[#f0f0f4]",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      )}
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
