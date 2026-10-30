"use client";

import { z } from "zod";
import {
  useAgent,
  useCopilotChatConfiguration,
} from "@copilotkit/react-core/v2";
import { IssueCardChip, IssueCardProps } from "./issue-card";
import type { Issue } from "@/components/pm-board/types";

/**
 * Render a list of issues inline in chat. The agent passes either:
 *   - a list of issue ids → we look up the full record in agent.state.issues
 *   - inline issue objects → we render them directly
 *
 * "View on board" buttons on each card jump to the kanban via the board-events
 * bus.
 */
export const IssueListProps = z.object({
  issueIds: z
    .array(z.string())
    .optional()
    .describe(
      "Issue ids to look up in agent state. Prefer this over passing full issue objects.",
    ),
  issues: z.array(IssueCardProps).optional(),
  caption: z
    .string()
    .optional()
    .describe("Optional short caption shown above the list."),
});

export type IssueListArgs = z.infer<typeof IssueListProps>;

export function IssueList({ issueIds, issues, caption }: IssueListArgs) {
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
      {caption && (
        <div
          style={{
            fontSize: 10,
            fontWeight: 400,
            color: "#57575b",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            paddingLeft: 4,
          }}
        >
          {caption}
        </div>
      )}
      {resolved.map((issue) => (
        <IssueCardChip
          key={issue.id}
          id={issue.id}
          title={issue.title}
          description={issue.description}
          status={issue.status}
          priority={issue.priority}
          assignee={issue.assignee ?? undefined}
          labels={issue.labels}
          dueDate={issue.dueDate ?? undefined}
        />
      ))}
    </div>
  );
}
