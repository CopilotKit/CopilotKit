import type {
  FeedResultRecord,
  FeedStoreSnapshot,
  FeedTimingRecord,
} from "./types";
import {
  findOpenBoxResultContent,
  isOpenBoxResultRecord,
  parseFeedToolResult,
  verdictFromResultRecord,
} from "./result-parsing";

const TIMING_STATE_KEY = "openboxTimingEvent";
const TIMING_SCHEMA = "openbox.copilotkit.timing.v1";

const EMPTY: FeedStoreSnapshot = {
  results: [],
  timings: [],
  halted: false,
  revision: 0,
};

let snapshot: FeedStoreSnapshot = EMPTY;
let arrivalCounter = 0;
const seenResultIds = new Set<string>();
const seenTimingKeys = new Set<string>();
const subscribers = new Set<() => void>();

export function getFeedSnapshot(): FeedStoreSnapshot {
  return snapshot;
}

export function subscribeToFeed(listener: () => void): () => void {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

function commit(next: FeedStoreSnapshot) {
  snapshot = { ...next, revision: snapshot.revision + 1 };
  subscribers.forEach((listener) => listener());
}

export function resetFeed(): void {
  // Durable clear: bump revision via commit() (monotonic — useGovernanceFeed's
  // useMemo is keyed on snapshot.revision, so a non-monotonic reset-to-0 would
  // serve a stale tree when the number repeats). KEEP seenResultIds/seenTimingKeys
  // and arrivalCounter so already-ingested messages are NOT re-added when the agent
  // subscription next fires — the clear sticks until genuinely new actions arrive.
  // revision is carried for the type; commit() overwrites it with snapshot.revision + 1.
  commit({
    ...snapshot,
    results: [],
    timings: [],
    halted: false,
    haltedAtMs: undefined,
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function toResultRecord(
  id: string,
  record: Record<string, unknown>,
  isResume: boolean,
): FeedResultRecord {
  const guardrails = asRecord(record.guardrailsResult);
  // Use ingest (arrival) time, not expiresAt: for approval_required results
  // expiresAt is a future approval-expiry, which would future-date the record.
  // emittedAtMs is only a tie-breaker after arrivalIndex; arrival time is correct.
  const emittedAtMs = Date.now();
  return {
    kind: "result",
    id,
    action: textValue(record.action),
    request: textValue(record.request),
    verdict: verdictFromResultRecord(record),
    status: textValue(record.status),
    reason: textValue(record.reason),
    message: textValue(record.message),
    redactionSummary:
      typeof record.redactionSummary === "string"
        ? record.redactionSummary
        : undefined,
    hasGuardrailsSignal: Object.keys(guardrails).length > 0,
    riskScore: numberValue(record.riskScore),
    trustTier:
      typeof record.trustTier === "string" ||
      typeof record.trustTier === "number"
        ? (record.trustTier as string | number)
        : undefined,
    runId: textValue(record.runId) || undefined,
    workflowId: textValue(record.workflowId) || undefined,
    activityId: textValue(record.activityId) || undefined,
    approvalId: textValue(record.approvalId) || undefined,
    governanceEventId: textValue(record.governanceEventId) || undefined,
    isResume,
    arrivalIndex: arrivalCounter++,
    emittedAtMs,
    raw: record,
  };
}

/**
 * Ingest governed result tool-messages from a messages array + state snapshot.
 * Append-only and idempotent: each result is keyed by its tool_call_id (or a
 * derived stable id) and ingested once.
 */
export function ingestResultsFromMessages(
  messages: unknown[],
  stateSnapshot: unknown,
): void {
  if (!Array.isArray(messages) || messages.length === 0) return;
  const additions: FeedResultRecord[] = [];

  for (const message of messages) {
    const msgRecord = asRecord(message);
    const content = findOpenBoxResultContent(msgRecord, stateSnapshot);
    if (!content) continue;
    const parsed = parseFeedToolResult(content);
    if (!isOpenBoxResultRecord(parsed)) continue;

    // Stable id: prefer tool_call_id, else governanceEventId, else
    // action+approvalId+status composite.
    const id =
      textValue(msgRecord.tool_call_id ?? msgRecord.toolCallId) ||
      textValue(parsed.governanceEventId) ||
      `${textValue(parsed.action)}:${textValue(parsed.approvalId)}:${textValue(parsed.status)}`;
    if (!id || seenResultIds.has(id)) continue;

    // Resume detection (heuristic only): a result carrying an approvalId with a
    // terminal status — anything other than approval_required / approval_pending
    // — is treated as a resume continuation of an earlier approval. This is the
    // sole signal used; there is no upstream resume-tool-name resolution.
    const isResume =
      Boolean(textValue(parsed.approvalId)) &&
      parsed.status !== "approval_required" &&
      parsed.status !== "approval_pending";

    seenResultIds.add(id);
    additions.push(toResultRecord(id, parsed, isResume));
  }

  if (additions.length === 0) return;
  commit({ ...snapshot, results: [...snapshot.results, ...additions] });
}

/** Ingest a timing.v1 event from agent state (append-only, dedupe by key). */
export function ingestTimingFromState(state: unknown): void {
  const stateRecord = asRecord(state);
  const payload = asRecord(stateRecord[TIMING_STATE_KEY]);
  if (payload.schemaVersion !== TIMING_SCHEMA) return;
  const event = asRecord(payload.event);
  const action = textValue(payload.action);
  const key = textValue(event.key);
  const phase = textValue(event.phase);
  if (!action || !key || (phase !== "started" && phase !== "finished")) return;

  const dedupeKey = `${action}:${key}:${phase}`;
  if (seenTimingKeys.has(dedupeKey)) return;
  seenTimingKeys.add(dedupeKey);

  const record: FeedTimingRecord = {
    kind: "timing",
    action,
    request: textValue(payload.request),
    key,
    label: textValue(event.label) || key,
    timingKind: textValue(event.kind) || "tool",
    phase,
    startedAtMs: Date.parse(textValue(event.startedAt)) || Date.now(),
    ms: numberValue(event.ms),
    arrivalIndex: arrivalCounter++,
  };
  commit({ ...snapshot, timings: [...snapshot.timings, record] });
}

export function ingestHalt(): void {
  if (snapshot.halted) return;
  commit({ ...snapshot, halted: true, haltedAtMs: Date.now() });
}
