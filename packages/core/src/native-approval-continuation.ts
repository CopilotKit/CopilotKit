import { structuredClone_ } from "@ag-ui/client";
import type { AbstractAgent, ResumeEntry, RunAgentResult } from "@ag-ui/client";

const queues = new WeakMap<AbstractAgent, Promise<unknown>>();

/** @internal Serialize individual native choices without caching accepted intent locally. */
export function ɵcontinueNativeApproval(
  agent: AbstractAgent,
  response: ResumeEntry,
  run: (response: ResumeEntry) => Promise<RunAgentResult>,
): Promise<RunAgentResult> | undefined {
  const request = agent.pendingInterrupts.find(
    (i) => i.id === response.interruptId,
  );
  if (
    !agent.allowPartialNativeApprovals ||
    request?.metadata?.["ag-ui:tool-execution"] !== "server"
  )
    return undefined;
  const threadId = agent.threadId;
  const original = JSON.stringify(request);
  const decision = structuredClone_(response);
  const previous = queues.get(agent) ?? Promise.resolve();
  const result = previous.then(() => {
    if (
      agent.threadId !== threadId ||
      !agent.allowPartialNativeApprovals ||
      !agent.pendingInterrupts.some(
        (i) => i.id === decision.interruptId && JSON.stringify(i) === original,
      )
    ) {
      throw new Error(
        "Native approval no longer belongs to the current pending batch",
      );
    }
    return run(decision);
  });
  // A failed choice must not prevent a later independent choice from retrying.
  const settled = result.catch(() => undefined);
  queues.set(agent, settled);
  void settled.then(() => {
    if (queues.get(agent) === settled) queues.delete(agent);
  });
  return result;
}
