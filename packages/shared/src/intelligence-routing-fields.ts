import type { BaseEvent } from "@ag-ui/client";

/**
 * The only AG-UI 1.0 events whose schema declares `threadId` and `runId`.
 * Plain literals, not `EventType`: a value import of `@ag-ui/client` here put
 * the client and its zod validators into the initial chunk of every app that
 * imports `@copilotkit/shared`.
 */
const RUN_IDENTITY_EVENTS = new Set<string>(["RUN_STARTED", "RUN_FINISHED"]);

/**
 * Removes the routing fields that the Intelligence runner stamps on every
 * event it sends to the gateway (`thread_id`, `run_id`, and `threadId` /
 * `runId` on events that do not declare them).
 *
 * The gateway relays these payloads unchanged. AG-UI 1.0 strips unknown
 * fields before subscribers see them and warns once per field, per event,
 * so a streamed answer would log hundreds of warnings. Call this where a
 * gateway payload enters an AG-UI pipeline. The gateway still receives the
 * fields, because the runner adds them after this point.
 */
export function stripIntelligenceRoutingFields<T extends BaseEvent>(
  event: T,
): T {
  const record = event as T & Record<string, unknown>;
  const keepRunIdentity = RUN_IDENTITY_EVENTS.has(record.type);
  if (
    !("thread_id" in record) &&
    !("run_id" in record) &&
    (keepRunIdentity || (!("threadId" in record) && !("runId" in record)))
  ) {
    return event;
  }
  const { thread_id: _t, run_id: _r, ...rest } = record;
  if (!keepRunIdentity) {
    delete rest.threadId;
    delete rest.runId;
  }
  return rest as unknown as T;
}
