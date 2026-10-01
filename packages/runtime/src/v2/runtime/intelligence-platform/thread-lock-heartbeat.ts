import { logger } from "@copilotkit/shared";
import { PlatformRequestError } from "./client";
import type { RenewThreadLockResponse } from "./client";

/** Delay before the first retry of a failed renewal; doubles per attempt. */
const INITIAL_RETRY_DELAY_MS = 1_000;
/** Upper bound for the delay between renewal retries. */
const MAX_RETRY_DELAY_MS = 8_000;
/** Longest a single renewal may stay in flight before it counts as failed. */
const ATTEMPT_TIMEOUT_MS = 10_000;
/** Stop retrying this long before the lock would expire. */
const DEADLINE_SAFETY_MARGIN_MS = 1_000;

export interface ThreadLockHeartbeatOptions {
  /** Sends one renewal request. */
  renew: () => Promise<RenewThreadLockResponse>;
  /** Delay between successful renewals. */
  intervalMs: number;
  /**
   * Lock lifetime assumed when the platform has not reported one: from
   * acquisition until the first successful renewal, and for responses that
   * omit `ttlSeconds`.
   */
  fallbackTtlSeconds: number;
  /**
   * Called once when the lock can no longer be kept: a non-retryable failure,
   * or retryable failures that ran out the lock's remaining lifetime. Never
   * called after {@link ThreadLockHeartbeat.stop}.
   */
  onLost: (error: unknown) => void;
  /** Unref timers so a pending heartbeat never keeps the process alive. */
  unref?: boolean;
}

export interface ThreadLockHeartbeat {
  /** Cancel the next renewal and any pending retry. Idempotent. */
  stop(): void;
}

class RenewalTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Thread lock renewal did not settle within ${timeoutMs}ms`);
    this.name = "RenewalTimeoutError";
  }
}

/**
 * Whether a failed renewal may succeed if retried. A lost lock is a 409 the
 * platform marks `retryable: false`; server failures (5xx), timeouts and
 * network errors are worth retrying while the lock is still valid.
 */
export function isRetryableLockRenewalError(error: unknown): boolean {
  if (error instanceof PlatformRequestError) {
    if (error.retryable !== undefined) return error.retryable;
    return error.status >= 500 || error.status === 408 || error.status === 429;
  }
  // Timeouts, fetch network failures and malformed responses.
  return true;
}

/**
 * Keep a thread lock alive for a running agent.
 *
 * Renews every `intervalMs`, with at most one renewal in flight. A failed
 * renewal is retried with exponential backoff while the lock is still valid:
 * the deadline is the last successful renewal plus the `ttlSeconds` it
 * returned (initially acquisition plus `fallbackTtlSeconds`). A non-retryable
 * failure, or running out of time before the deadline, calls `onLost`.
 * A `"completed"` response means the run already ended on the platform, so
 * the heartbeat stops without calling `onLost`.
 */
export function startThreadLockHeartbeat(
  options: ThreadLockHeartbeatOptions,
): ThreadLockHeartbeat {
  const { renew, intervalMs, fallbackTtlSeconds, onLost } = options;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let deadline = Date.now() + fallbackTtlSeconds * 1_000;
  let failedAttempts = 0;

  const schedule = (delayMs: number): void => {
    timer = setTimeout(() => {
      timer = undefined;
      void attempt();
    }, delayMs);
    if (options.unref) timer.unref?.();
  };

  const stop = (): void => {
    stopped = true;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const lose = (error: unknown): void => {
    stop();
    onLost(error);
  };

  const attempt = async (): Promise<void> => {
    let response: RenewThreadLockResponse;
    try {
      response = await withTimeout(renew(), attemptTimeoutMs(), options.unref);
    } catch (error) {
      if (!stopped) handleFailure(error);
      return;
    }
    if (stopped) return;

    failedAttempts = 0;
    if (response?.status === "completed") {
      stop();
      return;
    }
    const ttlSeconds =
      typeof response?.ttlSeconds === "number" && response.ttlSeconds > 0
        ? response.ttlSeconds
        : fallbackTtlSeconds;
    deadline = Date.now() + ttlSeconds * 1_000;
    schedule(intervalMs);
  };

  // Bound each attempt by the lock's remaining lifetime so a hung request
  // cannot silently outlive the lock.
  const attemptTimeoutMs = (): number => {
    const remaining = deadline - DEADLINE_SAFETY_MARGIN_MS - Date.now();
    return remaining > 0
      ? Math.min(ATTEMPT_TIMEOUT_MS, remaining)
      : ATTEMPT_TIMEOUT_MS;
  };

  const handleFailure = (error: unknown): void => {
    if (!isRetryableLockRenewalError(error)) {
      lose(error);
      return;
    }
    const delayMs = Math.min(
      INITIAL_RETRY_DELAY_MS * 2 ** failedAttempts,
      MAX_RETRY_DELAY_MS,
    );
    failedAttempts += 1;
    const remainingMs = deadline - DEADLINE_SAFETY_MARGIN_MS - Date.now();
    if (delayMs >= remainingMs) {
      lose(error);
      return;
    }
    logger.warn(
      { err: error, attempt: failedAttempts, retryInMs: delayMs, remainingMs },
      "Thread lock renewal failed; retrying before the lock expires",
    );
    schedule(delayMs);
  };

  schedule(intervalMs);
  return { stop };
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  unref: boolean | undefined,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new RenewalTimeoutError(timeoutMs)),
      timeoutMs,
    );
    if (unref) timeout.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}
