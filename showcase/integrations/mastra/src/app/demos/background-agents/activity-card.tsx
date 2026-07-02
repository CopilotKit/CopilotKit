"use client";

/**
 * Renderer for the `mastra-background-task` activity.
 *
 * MastraAgent emits an AG-UI `ACTIVITY_SNAPSHOT` (activity type
 * `mastra-background-task`) when Mastra dispatches a backgroundable tool, then
 * `ACTIVITY_DELTA`s as the task's lifecycle advances. The content payload is
 * the shape the adapter documents on its exported
 * `MASTRA_BACKGROUND_TASK_ACTIVITY_TYPE` constant.
 *
 * Terminal-state note: on the dispatching turn Mastra delivers `started` plus
 * a placeholder result and defers real completion out of band, so within the
 * turn the card's status stays `running` — this renderer is built around the
 * live "working" state and simply reflects whatever `status` the adapter sets.
 */

import React from "react";
import { z } from "zod";
import type { ReactActivityMessageRenderer } from "@copilotkit/react-core/v2";

export const MASTRA_BACKGROUND_TASK_ACTIVITY_TYPE = "mastra-background-task";

// Content shape for the background-task activity. Kept loose (`.passthrough()`,
// optional fields) because the adapter fills the payload progressively across
// snapshot + deltas — only `status` is relied on for the card state.
const backgroundTaskContentSchema = z
  .object({
    taskId: z.string().optional(),
    toolName: z.string().optional(),
    toolCallId: z.string().optional(),
    status: z.string().optional(),
    args: z.record(z.unknown()).optional(),
    outputs: z.array(z.unknown()).optional(),
    result: z.unknown().optional(),
    error: z.unknown().optional(),
  })
  .passthrough();

type BackgroundTaskContent = z.infer<typeof backgroundTaskContentSchema>;

function statusLabel(status: string | undefined): {
  text: string;
  working: boolean;
} {
  switch (status) {
    case "completed":
      return { text: "Completed", working: false };
    case "failed":
      return { text: "Failed", working: false };
    case "cancelled":
      return { text: "Cancelled", working: false };
    case "suspended":
      return { text: "Paused", working: false };
    default:
      // "running" / "resumed" / anything in-flight
      return { text: "Working…", working: true };
  }
}

function BackgroundTaskCard({ content }: { content: BackgroundTaskContent }) {
  const { text, working } = statusLabel(content.status);
  const topic =
    (content.args?.topic as string | undefined) ??
    (content.toolName ? content.toolName.replace(/[-_]/g, " ") : "task");

  return (
    <div
      className="flex w-full justify-start"
      data-testid="background-task-activity"
      data-status={content.status ?? "running"}
    >
      <div className="w-full max-w-md rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-3">
          {working ? (
            <span
              className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent"
              aria-hidden
            />
          ) : (
            <span
              className="inline-block h-4 w-4 rounded-full bg-muted-foreground"
              aria-hidden
            />
          )}
          <div className="flex flex-col">
            <span className="text-sm font-medium">Deep research</span>
            <span className="text-xs text-muted-foreground">{topic}</span>
          </div>
          <span
            className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
            data-testid="background-task-status"
          >
            {text}
          </span>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Running in the background — the conversation stays responsive while
          this task works.
        </p>
      </div>
    </div>
  );
}

export const backgroundTaskActivityRenderer: ReactActivityMessageRenderer<BackgroundTaskContent> =
  {
    activityType: MASTRA_BACKGROUND_TASK_ACTIVITY_TYPE,
    content: backgroundTaskContentSchema,
    render: ({ content }) => <BackgroundTaskCard content={content} />,
  };
