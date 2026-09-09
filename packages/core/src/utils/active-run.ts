/**
 * Serialization helpers for the window between `isRunning = true` and the
 * assignment of `activeRunDetach$` / `activeRunCompletionPromise`.
 *
 * `@ag-ui/client` AbstractAgent (through at least 0.0.59) does:
 *
 *   1. `this.isRunning = true`          — synchronous
 *   2. `await this.onInitialize(...)`    — yields
 *   3. assign detach$ + completion promise
 *
 * `detachActiveRun()` starts with `if (!this.activeRunDetach$) return`, so
 * both CopilotKit guards fail open inside that window unless they wait for
 * the handles (or, on the connect-replay path, we assign them first).
 *
 * These fields are private on AbstractAgent, so they are reached through a
 * structural cast — the same escape hatch `connect-replay.ts` already uses.
 */

interface AgentRunLifecycle {
  isRunning: boolean;
  detachActiveRun?: () => Promise<void>;
  activeRunCompletionPromise?: Promise<void>;
  activeRunDetach$?: unknown;
}

function asLifecycle(agent: object): AgentRunLifecycle {
  return agent as AgentRunLifecycle;
}

function yieldMacrotask(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * Await an in-flight run even when `activeRunCompletionPromise` is not
 * assigned yet. Callers that used to gate on
 * `isRunning && activeRunCompletionPromise` returned immediately during
 * `await onInitialize` and let a second send pre-empt the first.
 *
 * If the run ends (`isRunning` flips false) without ever exposing a
 * completion promise, this resolves so the caller can proceed.
 */
export async function ɵawaitActiveRunSettlement(agent: object): Promise<void> {
  const lifecycle = asLifecycle(agent);
  while (lifecycle.isRunning) {
    const completion = lifecycle.activeRunCompletionPromise;
    if (completion) {
      await completion;
      return;
    }
    await yieldMacrotask();
  }
}

/**
 * `AbstractAgent.detachActiveRun` no-ops when `activeRunDetach$` is still
 * unset. Wait out the `onInitialize` window so a follow-up run actually
 * detaches instead of orphaning the first pipeline.
 */
export async function ɵdetachActiveRunWhenReady(agent: object): Promise<void> {
  const lifecycle = asLifecycle(agent);
  while (lifecycle.isRunning && lifecycle.activeRunDetach$ == null) {
    await yieldMacrotask();
  }
  if (typeof lifecycle.detachActiveRun === "function") {
    await lifecycle.detachActiveRun();
  }
}
