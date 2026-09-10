import { resolveRegistryConfig } from "./config.js";
import type { RegistryConfig, SkillRegistryOptions } from "./config.js";
import { SkillDeliveryError, invalidSnapshot } from "./errors.js";
import type { SkillDeliveryErrorCode } from "./errors.js";
import { validateSnapshot } from "./snapshot.js";
import type { VerifiedSnapshot } from "./snapshot.js";

export interface SkillRegistryStatus {
  readonly initialized: boolean;
  readonly revision?: string;
  readonly mode: "latest" | "pinned";
  /** ISO 8601 timestamp of the last successful 200 or matching 304 check. */
  readonly lastCheckedAt?: string;
  readonly stale: boolean;
  readonly lastError?: Readonly<{
    code: SkillDeliveryErrorCode;
    message: string;
    retryable: boolean;
  }>;
}

function transient(error: SkillDeliveryError): boolean {
  return [
    "NETWORK_ERROR",
    "TIMEOUT",
    "INVALID_SNAPSHOT",
    "UNSUPPORTED_SERVER",
  ].includes(error.code);
}
function deliveryError(error: unknown): SkillDeliveryError {
  if (error instanceof SkillDeliveryError) return error;
  return new SkillDeliveryError(
    error instanceof Error && error.name === "TimeoutError"
      ? "TIMEOUT"
      : "NETWORK_ERROR",
    true,
    error,
  );
}

/** Internal registry shared by framework adapters; public API is framework-native. */
export class SkillRegistry {
  readonly #config: RegistryConfig;
  #snapshot?: VerifiedSnapshot;
  #inFlight?: Promise<VerifiedSnapshot>;
  #lastCheckedAt?: number;
  #stale = false;
  #lastError?: SkillDeliveryError;
  #blocked?: SkillDeliveryError;

  constructor(options: SkillRegistryOptions = {}) {
    this.#config = resolveRegistryConfig(options);
  }

  async initialize(): Promise<void> {
    await this.acquireSnapshot();
  }

  /** Capture exactly one immutable snapshot before model work begins. */
  acquireSnapshot(): Promise<VerifiedSnapshot> {
    if (this.#inFlight) return this.#inFlight;
    if (
      this.#snapshot &&
      !this.#blocked &&
      this.#lastCheckedAt !== undefined &&
      Date.now() - this.#lastCheckedAt < this.#config.freshnessWindowMs
    ) {
      return Promise.resolve(this.#snapshot);
    }
    // Defer work one microtask so reentrant and concurrent callers observe the
    // same promise before an injected client can start its request.
    this.#inFlight = Promise.resolve()
      .then(() => this.#refresh())
      .finally(() => {
        this.#inFlight = undefined;
      });
    return this.#inFlight;
  }

  get status(): SkillRegistryStatus {
    const error = this.#lastError;
    return Object.freeze({
      initialized: this.#snapshot !== undefined,
      ...(this.#snapshot ? { revision: this.#snapshot.revision } : {}),
      mode: this.#config.revision === undefined ? "latest" : "pinned",
      ...(this.#lastCheckedAt !== undefined
        ? { lastCheckedAt: new Date(this.#lastCheckedAt).toISOString() }
        : {}),
      stale: this.#stale,
      ...(error
        ? {
            lastError: Object.freeze({
              code: error.code,
              message: error.message,
              retryable: error.retryable,
            }),
          }
        : {}),
    });
  }

  async #refresh(): Promise<VerifiedSnapshot> {
    const startedAt = Date.now();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = new SkillDeliveryError("TIMEOUT", true);
        controller.abort(error);
        // Give a canonical client that already received denial headers one
        // event-loop turn to report that denial before the watchdog wins.
        timer = setTimeout(() => reject(error), 0);
      }, this.#config.requestTimeoutMs);
    });
    const replacement = async (): Promise<VerifiedSnapshot> => {
      const response = await this.#config.client.getLearnedSkillsSnapshot({
        containerId: this.#config.containerId,
        ...(this.#config.revision !== undefined
          ? { revision: this.#config.revision }
          : {}),
        ...(this.#snapshot ? { ifNoneMatch: this.#snapshot.etag } : {}),
        signal: controller.signal,
      });
      controller.signal.throwIfAborted();
      if (!response || typeof response !== "object") throw invalidSnapshot();
      if (response.status === "unchanged") {
        if (
          !this.#snapshot ||
          response.etag !== this.#snapshot.etag ||
          response.revision !== this.#snapshot.revision
        )
          throw invalidSnapshot();
        return this.#snapshot;
      }
      if (
        this.#config.revision !== undefined &&
        response.revision !== this.#config.revision
      )
        throw invalidSnapshot();
      return validateSnapshot(response, controller.signal);
    };
    try {
      const snapshot = await Promise.race([replacement(), deadline]);
      // An abandoned parse never writes registry state: only the winning
      // complete replacement reaches this assignment.
      this.#snapshot = snapshot;
      this.#lastCheckedAt = Date.now();
      this.#stale = false;
      this.#lastError = undefined;
      this.#blocked = undefined;
      this.#debug("refresh-success", startedAt);
      return snapshot;
    } catch (cause) {
      const error = deliveryError(cause);
      if (!transient(error)) {
        this.#blocked = error;
        this.#stale = false;
        this.#lastError = error;
        this.#debug("refresh-denied", startedAt, error.code);
        throw error;
      }
      // A later unreachable server cannot undo an already confirmed denial.
      if (this.#blocked) {
        this.#lastError = this.#blocked;
        this.#debug("refresh-failed", startedAt, error.code);
        throw this.#blocked;
      }
      this.#lastError = error;
      this.#stale = this.#snapshot !== undefined;
      this.#debug("refresh-failed", startedAt, error.code);
      if (this.#snapshot) return this.#snapshot;
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  #debug(
    event: string,
    startedAt: number,
    errorCode?: SkillDeliveryErrorCode,
  ): void {
    if (!this.#config.debug) return;
    console.debug("CopilotKit learned skills", {
      event,
      containerId: this.#config.containerId,
      revision: this.#snapshot?.revision,
      durationMs: Date.now() - startedAt,
      ...(errorCode ? { errorCode } : {}),
    });
  }
}
