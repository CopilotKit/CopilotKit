import type {
  ProductInteractionContext,
  ProductInteractionEvent,
} from "@copilotkit/learning";
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
  getThreadId: (event: ProductInteractionEvent) => string | undefined;
  onError: (error: Error) => void;
}) {
  const pending: {
    input: LearnFromUserActionInput;
    event: ProductInteractionEvent;
    context?: ProductInteractionContext;
  }[] = [];
  const actionThreads = new Map<string, string>();
  const deliveredContexts = new Map<string, string>();
  let latestContext: ProductInteractionContext | undefined;
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
        const { input, event, context } = pending.shift()!;
        const contextKey = context && JSON.stringify(context);
        const needsContext =
          event.type === "interaction" &&
          event.context === undefined &&
          contextKey !== undefined &&
          deliveredContexts.get(input.threadId) !== contextKey;
        const data = {
          source: "copilotkit.learning",
          ...event,
          ...(needsContext && { context }),
        };
        try {
          const result = await record({ ...input, data });
          // Capture deltas are global; each thread needs its own first snapshot.
          // Advance only after successful delivery so a failed annotation does
          // not prevent the next action from restoring missing context.
          if (result.dropped) {
            deliveredContexts.delete(input.threadId);
          } else if (!stopped && contextKey !== undefined) {
            deliveredContexts.delete(input.threadId);
            deliveredContexts.set(input.threadId, contextKey);
            if (deliveredContexts.size > 32)
              deliveredContexts.delete(deliveredContexts.keys().next().value!);
          }
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
      if ("context" in event && event.context !== undefined)
        latestContext = event.context;
      if (event.type === "interaction") {
        const threadId = getThreadId(event);
        if (!threadId) return;
        actionThreads.set(event.actionId, threadId);
        // Bound attribution history too. Very late outcomes can be omitted,
        // but must never be reassigned to whichever thread is now selected.
        if (actionThreads.size > 256) {
          actionThreads.delete(actionThreads.keys().next().value!);
        }
      }
      const threadId =
        event.type === "context" && event.actionId === undefined
          ? getThreadId(event)
          : actionThreads.get(event.actionId!);
      if (!threadId) return;
      // A delayed screen observation must not describe a newly selected
      // thread's interface on the original thread. Request metadata can still
      // finish on its original action/thread.
      if (
        event.type === "context" &&
        event.actionId !== undefined &&
        getThreadId(event) !== threadId
      )
        return;
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
      const input: LearnFromUserActionInput = {
        threadId,
        clientEventId: event.id,
        occurredAt: new Date(event.timestamp).toISOString(),
        title:
          event.type === "interaction"
            ? `User ${event.action}`
            : event.type === "request"
              ? "User action API request"
              : event.type === "context"
                ? event.trigger === "request-completed"
                  ? "Screen context after request"
                  : "Observed screen context"
                : event.type === "response"
                  ? "User action API response"
                  : "User action DOM change",
      };
      pending.push({
        input,
        event,
        context:
          event.type === "interaction"
            ? latestContext
            : "context" in event
              ? event.context
              : undefined,
      });
      // Capture stays synchronous; drain owns delivery and reports every failure
      // through onError without blocking the user's interaction.
      void drain();
    },
    stop() {
      stopped = true;
      pending.length = 0;
      actionThreads.clear();
      deliveredContexts.clear();
      latestContext = undefined;
    },
  };
}
