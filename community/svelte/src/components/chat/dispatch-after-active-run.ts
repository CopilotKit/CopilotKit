import type { AbstractAgent } from "@ag-ui/client";
import { isRunCompletionAware } from "@copilotkit/core";

const dispatchQueues = new WeakMap<AbstractAgent, Promise<void>>();

export async function dispatchAfterActiveRunSettles(
  agent: AbstractAgent,
  dispatch: () => Promise<void>,
): Promise<void> {
  const previous = dispatchQueues.get(agent) ?? Promise.resolve();
  const current = previous
    .catch(() => {})
    .then(async () => {
      const maybeAware: unknown = agent;
      const activeRunCompletionPromise = isRunCompletionAware(maybeAware)
        ? maybeAware.activeRunCompletionPromise
        : undefined;

      if (agent.isRunning && activeRunCompletionPromise) {
        try {
          await activeRunCompletionPromise;
        } catch (error) {
          // Let the queued message proceed, but make a failed run observable.
          console.error(
            "CopilotChat: in-flight run rejected while queuing send",
            error,
          );
        }
      }

      await dispatch();
    });
  dispatchQueues.set(agent, current);

  try {
    await current;
  } finally {
    if (dispatchQueues.get(agent) === current) dispatchQueues.delete(agent);
  }
}
