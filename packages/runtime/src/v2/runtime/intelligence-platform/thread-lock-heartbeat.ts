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
  /**
   * Sends one renewal request. The signal aborts when the attempt times out,
   * so an abandoned request never overlaps its retry.
   */
  renew: (signal: AbortSignal) => Promise<RenewThreadLockResponse>;
  /** Delay between successful renewals. */
  intervalMs: number;
  /**
   * Lock lifetime assumed when the platform has not reported one: until the
   * first successful renewal when {@link initialTtlSeconds} is absent, and
   * for renewal responses that omit `ttlSeconds`.
   */
  fallbackTtlSeconds: number;
  /**
   * Remaining lock lifetime when the heartbeat starts, as reported by the
   * platform at acquisition, measured from when the acquire request was sent.
   * Used until the first successful renewal; when absent,
   * {@link fallbackTtlSeconds} applies instead. A value of zero or less means
   * the lock has already expired.
   */
  initialTtlSeconds?: number;
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
 * Renews every `intervalMs` (sooner if that would run past the lock's
 * lifetime), with at most one renewal in flight. A failed renewal is retried
 * with exponential backoff while the lock is still valid: the deadline is when
 * the last successful renewal was *sent* plus the `ttlSeconds` it returned,
 * because the platform starts the TTL when it handles the request (initially
 * start plus `initialTtlSeconds`, or `fallbackTtlSeconds` when the platform
 * reported no lifetime at acquisition). A non-retryable failure, or running
 * out of time before the deadline, calls `onLost`.
 * A `"completed"` response means the run already ended on the platform, so
 * the heartbeat stops without calling `onLost`.
 */
export function startThreadLockHeartbeat(
  options: ThreadLockHeartbeatOptions,
): ThreadLockHeartbeat {
  const { renew, intervalMs, fallbackTtlSeconds, onLost } = options;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const initialTtlSeconds =
    typeof options.initialTtlSeconds === "number" &&
    Number.isFinite(options.initialTtlSeconds)
      ? options.initialTtlSeconds
      : fallbackTtlSeconds;
  let deadline = Date.now() + initialTtlSeconds * 1_000;
  let failedAttempts = 0;

  const schedule = (delayMs: number): void => {
    timer = setTimeout(() => {
      timer = undefined;
      void attempt();
    }, delayMs);
    if (options.unref) timer.unref?.();
  };

  /** Time left before the safety cutoff ahead of the lock's expiry. */
  const remainingMs = (): number =>
    deadline - DEADLINE_SAFETY_MARGIN_MS - Date.now();

  // Renew on the interval, or right away when waiting that long would run
  // past the cutoff and leave the lock to lapse.
  const scheduleRenewal = (): void => {
    schedule(intervalMs < remainingMs() ? intervalMs : 0);
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
    // Bound each attempt by the lock's remaining lifetime so a hung request
    // cannot silently outlive the lock; past the cutoff, renewing is too late.
    const timeoutMs = Math.min(ATTEMPT_TIMEOUT_MS, remainingMs());
    if (timeoutMs <= 0) {
      lose(new Error("Thread lock expired before it could be renewed"));
      return;
    }
    const sentAt = Date.now();
    const controller = new AbortController();
    let response: RenewThreadLockResponse;
    try {
      response = await withTimeout(
        renew(controller.signal),
        timeoutMs,
        options.unref,
        () => controller.abort(),
      );
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
    deadline = sentAt + ttlSeconds * 1_000;
    scheduleRenewal();
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
    const remaining = remainingMs();
    if (delayMs >= remaining) {
      lose(error);
      return;
    }
    logger.warn(
      {
        err: error,
        attempt: failedAttempts,
        retryInMs: delayMs,
        remainingMs: remaining,
      },
      "Thread lock renewal failed; retrying before the lock expires",
    );
    schedule(delayMs);
  };

  scheduleRenewal();
  return { stop };
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  unref: boolean | undefined,
  onTimeout: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      onTimeout();
      reject(new RenewalTimeoutError(timeoutMs));
    }, timeoutMs);
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
