"use client";

/**
 * Renderer for the `mastra-background-task` activity.
 *
 * When Mastra dispatches a background tool, the Mastra AG-UI adapter sends an
 * `ACTIVITY_SNAPSHOT` with this activity type. It then sends an
 * `ACTIVITY_DELTA` each time the task's lifecycle advances. The adapter
 * documents the content shape on its `MASTRA_BACKGROUND_TASK_ACTIVITY_TYPE`
 * export.
 *
 * In the turn that dispatches the task, Mastra sends `started` and a
 * placeholder result, and completion arrives out of band. So within that
 * turn the card's status stays `running`. The renderer is built around that
 * live "working" state, and it shows whatever `status` the adapter sets.
 */

import { z } from "zod";
import type { ReactActivityMessageRenderer } from "@copilotkit/react-core/v2";

export const MASTRA_BACKGROUND_TASK_ACTIVITY_TYPE = "mastra-background-task";

// The content of a background-task activity. The adapter fills it in across
// the snapshot and the deltas, so every field is optional and unknown keys
// pass through. The card state reads only `status`.
const backgroundTaskContentSchema = z.looseObject({
  taskId: z.string().optional(),
  toolName: z.string().optional(),
  toolCallId: z.string().optional(),
  status: z.string().optional(),
  args: z.record(z.string(), z.unknown()).optional(),
  outputs: z.array(z.unknown()).optional(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
});

type BackgroundTaskContent = z.infer<typeof backgroundTaskContentSchema>;

function statusLabel(status: string | undefined) {
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
      // "started", "running", "resumed": the task is still in flight.
      return { text: "Working…", working: true };
  }
}

function BackgroundTaskCard({ content }: { content: BackgroundTaskContent }) {
  const { text, working } = statusLabel(content.status);
  const topicArg = content.args?.topic;
  const toolLabel = content.toolName
    ? content.toolName.replace(/[-_]/g, " ")
    : "task";
  const topic = typeof topicArg === "string" ? topicArg : toolLabel;

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
        {working && (
          <p className="mt-3 text-xs text-muted-foreground">
            Running in the background — the conversation stays responsive while
            this task works.
          </p>
        )}
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
