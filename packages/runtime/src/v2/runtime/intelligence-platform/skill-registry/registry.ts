import { createHash } from "node:crypto";
import { resolveRegistryConfig } from "./config";
import type { SingleContainerConfig, SkillRegistryOptions } from "./config";
import { SkillDeliveryError, invalidSnapshot } from "./errors";
import type { SkillDeliveryErrorCode } from "./errors";
import { validateSnapshot } from "./snapshot";
import type { VerifiedSnapshot } from "./snapshot";

export interface SkillRegistryStatus {
  /** Present only for the explicit containers interface. */
  readonly containers?: readonly (SkillRegistryStatus & {
    readonly id: string;
  })[];
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
class SingleContainerRegistry {
  readonly #config: SingleContainerConfig;
  #snapshot?: VerifiedSnapshot;
  #inFlight?: Promise<VerifiedSnapshot>;
  #lastCheckedAt?: number;
  #stale = false;
  #lastError?: SkillDeliveryError;
  #blocked?: SkillDeliveryError;

  constructor(config: SingleContainerConfig) {
    this.#config = config;
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

/** Compose independent container caches into one immutable invocation snapshot. */
export class SkillRegistry {
  readonly #sources: readonly {
    readonly id: string;
    readonly registry: SingleContainerRegistry;
  }[];
  readonly #multiple: boolean;
  #snapshot?: VerifiedSnapshot;
  #parts?: readonly VerifiedSnapshot[];
  #inFlight?: Promise<VerifiedSnapshot>;

  constructor(options: SkillRegistryOptions = {}) {
    const config = resolveRegistryConfig(options);
    this.#multiple = config.containers !== undefined;
    this.#sources =
      config.containers !== undefined
        ? config.containers.map(({ id, revision }) => ({
            id,
            registry: new SingleContainerRegistry(
              Object.freeze({
                client: config.client,
                freshnessWindowMs: config.freshnessWindowMs,
                requestTimeoutMs: config.requestTimeoutMs,
                debug: config.debug,
                containerId: id,
                ...(revision !== undefined ? { revision } : {}),
              }),
            ),
          }))
        : [
            {
              id: config.containerId!,
              registry: new SingleContainerRegistry({
                client: config.client,
                containerId: config.containerId!,
                revision: config.revision,
                freshnessWindowMs: config.freshnessWindowMs,
                requestTimeoutMs: config.requestTimeoutMs,
                debug: config.debug,
              }),
            },
          ];
  }

  /** Load every configured container before agent initialization completes. */
  async initialize(): Promise<void> {
    await this.acquireSnapshot();
  }

  /** Capture every container once; a failed source cannot yield a partial catalog. */
  acquireSnapshot(): Promise<VerifiedSnapshot> {
    if (!this.#multiple) return this.#sources[0].registry.acquireSnapshot();
    if (this.#inFlight) return this.#inFlight;
    this.#inFlight = Promise.all(
      this.#sources.map(({ registry }) => registry.acquireSnapshot()),
    )
      .then((parts) => {
        if (
          this.#snapshot &&
          parts.every((part, index) => part === this.#parts?.[index])
        ) {
          return this.#snapshot;
        }
        const identity = createHash("sha256")
          .update(
            JSON.stringify(
              parts.map((part, index) => [
                this.#sources[index].id,
                part.revision,
                part.etag,
              ]),
            ),
          )
          .digest("hex");
        const skills = Object.freeze(
          parts.flatMap((part, index) =>
            part.skills.map((skill) =>
              Object.freeze({
                ...skill,
                name: `${encodeURIComponent(this.#sources[index].id)}/${skill.name}`,
              }),
            ),
          ),
        );
        this.#parts = parts;
        this.#snapshot = Object.freeze({
          revision: `multi:${identity}`,
          etag: `"${identity}"`,
          skills,
        });
        return this.#snapshot;
      })
      .finally(() => {
        this.#inFlight = undefined;
      });
    return this.#inFlight;
  }

  /** Report each container's real revision; no aggregate server revision exists. */
  get status(): SkillRegistryStatus {
    if (!this.#multiple) return this.#sources[0].registry.status;
    const containers = Object.freeze(
      this.#sources.map(({ id, registry }) =>
        Object.freeze({ id, ...registry.status }),
      ),
    );
    const error =
      containers.find(
        (source) => source.lastError && !source.lastError.retryable,
      )?.lastError ?? containers.find((source) => source.lastError)?.lastError;
    const timestamps = containers.map((source) => source.lastCheckedAt);
    return Object.freeze({
      initialized: this.#snapshot !== undefined,
      mode: containers.every((source) => source.mode === "pinned")
        ? "pinned"
        : "latest",
      stale: containers.some((source) => source.stale),
      ...(timestamps.every((timestamp) => timestamp !== undefined)
        ? { lastCheckedAt: [...timestamps].sort()[0] }
        : {}),
      ...(error ? { lastError: error } : {}),
      containers,
    });
  }
}
