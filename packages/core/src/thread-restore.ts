export const THREAD_RESTORE_FAILURE_CODES = [
  "timeout",
  "dependency_failure",
  "decode_failure",
  "partial_window",
  "invalid_cursor",
  "buffer_overflow",
  "scope_violation",
  "internal_failure",
] as const;

export type ThreadRestoreFailureCode =
  (typeof THREAD_RESTORE_FAILURE_CODES)[number];

export type ThreadRestoreRetryAction = "reload_conversation" | "none";

export interface ThreadRestoreProgress {
  restoreAttemptId: string;
  status: "restoring";
  elapsedMs: number;
}

export interface ThreadRestoreFailure {
  restoreAttemptId: string;
  code: ThreadRestoreFailureCode;
  retryable: boolean;
  retryAction: ThreadRestoreRetryAction;
}

export type ThreadRestoreState =
  | {
      status: "ready";
      threadId: string;
      restoreAttemptId?: string;
    }
  | {
      status: "restoring";
      threadId: string;
      restoreAttemptId?: string;
      elapsedMs: number;
    }
  | {
      status: "failed";
      threadId: string;
      restoreAttemptId: string;
      error: ThreadRestoreError;
    };

export interface ThreadRestoreAware {
  getThreadRestoreState(): ThreadRestoreState;
  subscribeToThreadRestore(listener: () => void): () => void;
  forceFullRestore(): Promise<void>;
}

export class ThreadRestoreError extends Error {
  readonly code: ThreadRestoreFailureCode;
  readonly retryable: boolean;
  readonly retryAction: ThreadRestoreRetryAction;
  readonly restoreAttemptId: string;

  constructor(
    failure: ThreadRestoreFailure,
    options?: { message?: string; cause?: unknown },
  ) {
    super(options?.message ?? `Thread restore failed (${failure.code})`, {
      cause: options?.cause,
    });
    this.name = "ThreadRestoreError";
    this.code = failure.code;
    this.retryable = failure.retryable;
    this.retryAction = failure.retryAction;
    this.restoreAttemptId = failure.restoreAttemptId;
  }
}

export function isThreadRestoreAware(
  agent: unknown,
): agent is ThreadRestoreAware {
  if (typeof agent !== "object" || agent === null) {
    return false;
  }

  const candidate = agent as Partial<ThreadRestoreAware>;
  return (
    typeof candidate.getThreadRestoreState === "function" &&
    typeof candidate.subscribeToThreadRestore === "function" &&
    typeof candidate.forceFullRestore === "function"
  );
}

export function parseThreadRestoreJoinAcknowledgement(
  payload: unknown,
): { restoreAttemptId: string } | null {
  const envelope = asRecord(payload);
  const restore = asRecord(envelope?.restore);
  return restore?.mode === "failure_reporting" &&
    isNonEmptyString(restore.restoreAttemptId)
    ? { restoreAttemptId: restore.restoreAttemptId }
    : null;
}

export function parseThreadRestoreProgress(
  payload: unknown,
): ThreadRestoreProgress | null {
  const progress = asRecord(payload);
  return progress &&
    isNonEmptyString(progress.restoreAttemptId) &&
    progress.status === "restoring" &&
    typeof progress.elapsedMs === "number" &&
    Number.isFinite(progress.elapsedMs) &&
    progress.elapsedMs >= 0
    ? {
        restoreAttemptId: progress.restoreAttemptId,
        status: "restoring",
        elapsedMs: progress.elapsedMs,
      }
    : null;
}

export function parseThreadRestoreFailure(
  payload: unknown,
): ThreadRestoreFailure | null {
  const failure = asRecord(payload);
  return failure &&
    isNonEmptyString(failure.restoreAttemptId) &&
    isThreadRestoreFailureCode(failure.code) &&
    typeof failure.retryable === "boolean" &&
    isThreadRestoreRetryAction(failure.retryAction)
    ? {
        restoreAttemptId: failure.restoreAttemptId,
        code: failure.code,
        retryable: failure.retryable,
        retryAction: failure.retryAction,
      }
    : null;
}

function isThreadRestoreFailureCode(
  value: unknown,
): value is ThreadRestoreFailureCode {
  return (
    typeof value === "string" &&
    (THREAD_RESTORE_FAILURE_CODES as readonly string[]).includes(value)
  );
}

function isThreadRestoreRetryAction(
  value: unknown,
): value is ThreadRestoreRetryAction {
  return value === "reload_conversation" || value === "none";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
