"use client";

import { useEffect, useMemo, useRef } from "react";
import { IssueColumn } from "./issue-column";
import type { Issue, IssueStatus } from "./types";
import { ISSUE_STATUSES } from "./types";

interface IssueBoardProps {
  issues: Issue[];
  onUpdate: (issues: Issue[]) => void;
  isAgentRunning: boolean;
}

export function IssueBoard({
  issues,
  onUpdate,
  isAgentRunning,
}: IssueBoardProps) {
  const byStatus = useMemo(() => {
    const grouped: Record<IssueStatus, Issue[]> = {
      Backlog: [],
      Todo: [],
      "In Progress": [],
      "In Review": [],
      Done: [],
    };
    for (const issue of issues) {
      const s = (
        ISSUE_STATUSES.includes(issue.status as IssueStatus)
          ? issue.status
          : "Backlog"
      ) as IssueStatus;
      grouped[s].push(issue);
    }
    return grouped;
  }, [issues]);

  // Track which issue ids have already mounted so the entrance animation only
  // fires the first time we see an id, not when a card moves between columns
  // (column-to-column moves unmount + remount because the parent DOM node
  // changes — without this gate the move would re-trigger the cascade).
  //
  // Reset on an empty → populated transition so /clear followed by a re-seed
  // animates cleanly again, otherwise the previously-seen set would suppress
  // the cascade on every subsequent populate.
  const seenIdsRef = useRef<Set<string>>(new Set());
  const prevLengthRef = useRef(issues.length);
  if (prevLengthRef.current === 0 && issues.length > 0) {
    seenIdsRef.current = new Set();
  }
  prevLengthRef.current = issues.length;

  // Build the global stagger index in column order (Backlog → Todo → In
  // Progress → In Review → Done) for issues that haven't been seen yet. Seen
  // issues get index -1 (no animation).
  const staggerIndexById = useMemo(() => {
    const map = new Map<string, number>();
    let n = 0;
    for (const status of ISSUE_STATUSES) {
      for (const issue of byStatus[status]) {
        if (seenIdsRef.current.has(issue.id)) {
          map.set(issue.id, -1);
        } else {
          map.set(issue.id, n);
          n += 1;
        }
      }
    }
    return map;
    // byStatus already encodes the full issues array, so this is the right dep.
  }, [byStatus]);

  // After paint, mark every currently-rendered id as seen so subsequent
  // re-renders don't re-animate them. Using useEffect (not useLayoutEffect) so
  // the browser actually paints the initial keyframe state first.
  useEffect(() => {
    for (const issue of issues) seenIdsRef.current.add(issue.id);
  }, [issues]);

  const updateIssue = (id: string, changes: Partial<Issue>) => {
    onUpdate(issues.map((i) => (i.id === id ? { ...i, ...changes } : i)));
  };

  const deleteIssue = (id: string) => {
    onUpdate(issues.filter((i) => i.id !== id));
  };

  const addIssue = (status: IssueStatus) => {
    const newIssue: Issue = {
      id: `ISS-${Math.floor(Math.random() * 9000 + 1000)}`,
      title: "New issue",
      description: "",
      status,
      priority: "Med",
      assignee: null,
      labels: [],
    };
    onUpdate([...issues, newIssue]);
  };

  const dropIssue = (id: string, status: IssueStatus) => {
    onUpdate(issues.map((i) => (i.id === id ? { ...i, status } : i)));
  };

  return (
    <div
      className="h-full overflow-x-auto overflow-y-hidden p-6"
      style={{ position: "relative", zIndex: 1 }}
    >
      <div className="flex gap-3 h-full min-w-max">
        {ISSUE_STATUSES.map((status) => (
          <IssueColumn
            key={status}
            status={status}
            issues={byStatus[status]}
            onUpdateIssue={updateIssue}
            onDeleteIssue={deleteIssue}
            onAddIssue={addIssue}
            onDropIssue={dropIssue}
            isAgentRunning={isAgentRunning}
            staggerIndexById={staggerIndexById}
          />
        ))}
      </div>
    </div>
  );
}
