/** Bounded, local-only diagnostic record for an Autopilot browser tool. */
export type AutopilotTraceRecord = {
  id: string;
  time: number;
  agentId: string;
  threadId: string;
  toolName: string;
  phase: "started" | "finished";
  targetRef?: string;
  status?: string;
  resultPreview?: string;
  resultBytes?: number;
  elapsedMs?: number;
  remainingActionBudget?: number;
  remainingReadBudget?: number;
  error?: string;
};

const MAX_RECORDS = 64;
const MAX_PREVIEW = 4_000;
let records: readonly AutopilotTraceRecord[] = [];
const listeners = new Set<() => void>();

export function getAutopilotTrace(): readonly AutopilotTraceRecord[] {
  return records;
}

export function subscribeAutopilotTrace(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Input must already have passed the tool's observation/result filters. */
export function recordAutopilotToolTrace(input: {
  id: string;
  agentId: string;
  threadId: string;
  toolName: string;
  phase: "started" | "finished";
  args?: unknown;
  result?: string;
  error?: string;
  elapsedMs?: number;
}): void {
  if (typeof window === "undefined") return;
  const args =
    input.args && typeof input.args === "object"
      ? (input.args as Record<string, unknown>)
      : {};
  const target = args.ref ?? args.target ?? args.submitRef;
  let parsed: Record<string, unknown> = {};
  let preview = input.result;
  if (input.result) {
    try {
      const value = JSON.parse(input.result);
      if (value && typeof value === "object" && !Array.isArray(value)) {
        parsed = value as Record<string, unknown>;
        preview = JSON.stringify(value, null, 2);
      }
    } catch {
      // Plain-text results remain visible in the bounded preview.
    }
  }
  const numeric = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? value : undefined;
  const record: AutopilotTraceRecord = {
    id: input.id,
    time: Date.now(),
    agentId: input.agentId,
    threadId: input.threadId,
    toolName: input.toolName,
    phase: input.phase,
    ...(typeof target === "string" ? { targetRef: target.slice(0, 80) } : {}),
    ...(typeof parsed.status === "string"
      ? { status: parsed.status.slice(0, 80) }
      : {}),
    ...(input.result
      ? {
          resultPreview: preview?.slice(0, MAX_PREVIEW),
          resultBytes: new TextEncoder().encode(input.result).length,
        }
      : {}),
    ...(input.error ? { error: input.error.slice(0, MAX_PREVIEW) } : {}),
    ...(input.elapsedMs === undefined ? {} : { elapsedMs: input.elapsedMs }),
    ...(numeric(parsed.remainingActionBudget) === undefined
      ? {}
      : { remainingActionBudget: numeric(parsed.remainingActionBudget) }),
    ...(numeric(parsed.remainingReadBudget) === undefined
      ? {}
      : { remainingReadBudget: numeric(parsed.remainingReadBudget) }),
  };
  records = [
    ...records.filter((candidate) => candidate.id !== record.id),
    record,
  ].slice(-MAX_RECORDS);
  for (const listener of listeners) listener();
}
