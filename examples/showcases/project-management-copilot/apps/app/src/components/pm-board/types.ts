/**
 * Shared issue types — keep in sync with apps/agent/src/issues.py.
 */

export type IssueStatus =
  | "Backlog"
  | "Todo"
  | "In Progress"
  | "In Review"
  | "Done";

export type IssuePriority = "Urgent" | "High" | "Med" | "Low";

export interface Issue {
  id: string;
  title: string;
  description?: string;
  status: IssueStatus;
  priority: IssuePriority;
  assignee?: string | null;
  labels?: string[];
  dueDate?: string | null;
}

export const ISSUE_STATUSES: IssueStatus[] = [
  "Backlog",
  "Todo",
  "In Progress",
  "In Review",
  "Done",
];

export const ISSUE_PRIORITIES: IssuePriority[] = [
  "Urgent",
  "High",
  "Med",
  "Low",
];

export const PRIORITY_COLORS: Record<IssuePriority, string> = {
  Urgent: "#fa5f67",
  High: "#ffac4d",
  Med: "#bec2ff",
  Low: "#838389",
};

export const ASSIGNEE_COLORS: Record<string, string> = {
  Alex: "#85ecce",
  Sarah: "#ffac4d",
  Jordan: "#bec2ff",
  Priya: "#fff388",
};

export function assigneeInitials(assignee?: string | null): string {
  if (!assignee) return "?";
  return assignee
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");
}
