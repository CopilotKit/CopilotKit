import type { AbstractAgent } from "@ag-ui/client";
import { isRunCompletionAware } from "@copilotkit/core";

export async function dispatchAfterActiveRunSettles(
  agent: AbstractAgent,
  dispatch: () => void | Promise<void>,
): Promise<void> {
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
}
