import type { ProductInteractionEvent } from "@copilotkit/learning";
import type {
  LearnFromUserActionInput,
  UseLearnFromUserActionRecorder,
} from "../hooks/use-learn-from-user-action";

/** Uses the same annotation transport as manually recorded user actions. */
export function createProductEventRecorder({
  record,
  getThreadId,
  onError,
}: {
  record: UseLearnFromUserActionRecorder;
  getThreadId: () => string | undefined;
  onError: (error: Error) => void;
}) {
  const pending: LearnFromUserActionInput[] = [];
  const actionThreads = new Map<string, string>();
  let active = false;
  let stopped = false;
  let overflowReported = false;

  const report = (error: unknown) => {
    if (stopped) return;
    try {
      const result = onError(
        error instanceof Error ? error : new Error(String(error)),
      );
      void Promise.resolve(result).catch(() => {
        // Void callbacks can still be async at runtime. Their rejection must
        // not become an unhandled error in the application being observed.
      });
    } catch {
      // A telemetry error handler must not break the host application.
    }
  };

  const drain = async () => {
    if (active || stopped) return;
    active = true;
    try {
      while (pending.length) {
        if (stopped) break;
        const input = pending.shift()!;
        try {
          await record(input);
        } catch (error) {
          report(error);
        }
      }
    } finally {
      active = false;
      overflowReported = false;
    }
  };

  return {
    onEvent(event: ProductInteractionEvent) {
      if (stopped) return;
      if (event.type === "interaction") {
        const threadId = getThreadId();
        if (!threadId) return;
        actionThreads.set(event.actionId, threadId);
        // Bound attribution history too. Very late outcomes can be omitted,
        // but must never be reassigned to whichever thread is now selected.
        if (actionThreads.size > 256) {
          actionThreads.delete(actionThreads.keys().next().value!);
        }
      }
      const threadId = actionThreads.get(event.actionId);
      if (!threadId) return;
      // One request in flight and at most 50 waiting. No automatic retries:
      // an unavailable runtime must not create an unbounded browser backlog.
      if (pending.length >= 50) {
        if (!overflowReported) {
          overflowReported = true;
          report(
            new Error(
              "CopilotKit learning queue is full; dropping product events.",
            ),
          );
        }
        return;
      }
      pending.push({
        threadId,
        clientEventId: event.id,
        occurredAt: new Date(event.timestamp).toISOString(),
        title:
          event.type === "interaction"
            ? `User ${event.action}`
            : event.type === "request"
              ? "User action API request"
              : "User action DOM change",
        data: { source: "copilotkit.learning", ...event },
      });
      // Capture stays synchronous; drain owns delivery and reports every failure
      // through onError without blocking the user's interaction.
      void drain();
    },
    stop() {
      stopped = true;
      pending.length = 0;
      actionThreads.clear();
    },
  };
}
