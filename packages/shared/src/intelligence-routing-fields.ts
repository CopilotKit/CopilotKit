import type { BaseEvent } from "@ag-ui/client";

/**
 * The only AG-UI 1.0 events whose schema declares `threadId` and `runId`.
 * Plain literals, not `EventType`: a value import of `@ag-ui/client` here put
 * the client and its zod validators into the initial chunk of every app that
 * imports `@copilotkit/shared`.
 */
const RUN_IDENTITY_EVENTS = new Set<string>(["RUN_STARTED", "RUN_FINISHED"]);

/**
 * Fields no AG-UI event declares: the runner's `thread_id` / `run_id`, and
 * the `organization_id` / `project_id` the gateway adds when it relays an
 * event.
 */
const GATEWAY_ONLY_FIELDS = [
  "thread_id",
  "run_id",
  "organization_id",
  "project_id",
] as const;

/**
 * Removes the routing fields that Intelligence adds to every event: the
 * runner stamps `thread_id`, `run_id`, and `threadId` / `runId` on events
 * that do not declare them before sending them to the gateway, and the
 * gateway adds `organization_id` and `project_id` when it relays them.
 *
 * AG-UI 1.0 strips unknown fields before subscribers see them and warns once
 * per field, per event, so a streamed answer would log hundreds of warnings.
 * Call this where a gateway payload enters an AG-UI pipeline. The gateway
 * still receives the runner's fields, because the runner adds them after
 * this point.
 */
export function stripIntelligenceRoutingFields<T extends BaseEvent>(
  event: T,
): T {
  const record = event as T & Record<string, unknown>;
  const keepRunIdentity = RUN_IDENTITY_EVENTS.has(record.type);
  if (
    !GATEWAY_ONLY_FIELDS.some((field) => field in record) &&
    (keepRunIdentity || (!("threadId" in record) && !("runId" in record)))
  ) {
    return event;
  }
  const rest: Record<string, unknown> = { ...record };
  for (const field of GATEWAY_ONLY_FIELDS) delete rest[field];
  if (!keepRunIdentity) {
    delete rest.threadId;
    delete rest.runId;
  }
  return rest as unknown as T;
}
