import { readFile } from "node:fs/promises";
import { posix, resolve } from "node:path";
import type {
  InstalledSkillSet,
  IntelligenceClient,
} from "@copilotkit/intelligence";

const FRAMEWORK = "langgraph-typescript";
const ADAPTER_VERSION = "0.1.0";
const DEFAULT_REFRESH_INTERVAL_MS = 30_000;
const DEFAULT_MAXIMUM_SKILLS = 128;
const DEFAULT_MAXIMUM_INSTRUCTION_BYTES = 262_144;
const DEFAULT_MAXIMUM_AGGREGATE_BYTES = 1_048_576;

export type AdapterStatus =
  | "cold"
  | "loading"
  | "ready"
  | "refreshing"
  | "stale"
  | "denied"
  | "revoked"
  | "closed";

export interface RenderedSkill {
  readonly position: number;
  readonly kind: "instruction";
  readonly name: string;
  readonly text: string;
  readonly byteLength: number;
  readonly skillId: string;
  readonly versionId: string;
  readonly description: string | null;
}

export interface AdapterSnapshot {
  readonly status: AdapterStatus;
  readonly source: "fresh" | "cached" | "none";
  readonly installedSkillSet: InstalledSkillSet | null;
  readonly renderedSkills: readonly RenderedSkill[];
  readonly prompt: string;
  readonly lastAttemptAt: number | null;
  readonly lastSuccessAt: number | null;
  readonly error: Error | null;
  readonly registryRevision: string | null;
}

export interface SkillRegistryTelemetryEvent {
  readonly name:
    | "load.started"
    | "load.throttled"
    | "load.singleflight_joined"
    | "load.succeeded"
    | "load.failed"
    | "status.changed";
  readonly atMs: number;
  readonly metadata: Readonly<{
    framework: typeof FRAMEWORK;
    adapterVersion: typeof ADAPTER_VERSION;
    source?: "load" | "preload" | "refresh";
    freshness?: "fresh" | "cached";
    status?: AdapterStatus;
    skillCount?: number;
    registryRevision?: string;
    joinedCallers?: number;
    outcome?: "success" | "failure";
    reason?:
      | "closed"
      | "denied"
      | "integrity"
      | "loading"
      | "stale"
      | "transient";
    errorCode?: string;
    errorCategory?: string;
    retryable?: boolean;
    requestId?: string;
    traceId?: string;
    refreshLatencyMs?: number;
  }>;
}

export interface SkillRegistryClient {
  readonly skills: Pick<IntelligenceClient["skills"], "get" | "getCached">;
}

export interface RegistryStateOptions {
  readonly client: SkillRegistryClient;
  readonly learningContainerId: string;
  readonly refreshIntervalMs?: number;
  readonly maximumSkills?: number;
  readonly maximumInstructionBytes?: number;
  readonly maximumAggregateBytes?: number;
  readonly clock?: () => number;
  readonly telemetry?: (
    event: SkillRegistryTelemetryEvent,
  ) => void | Promise<void>;
}

type LoadSource = "load" | "preload" | "refresh";

interface CanonicalError extends Error {
  readonly code: string;
  readonly category: string;
  readonly retryable: boolean;
  readonly requestId?: string;
  readonly traceId?: string;
  readonly status?: number;
  readonly causeIdentity?: string;
}

class AdapterError extends Error implements CanonicalError {
  readonly code: string;
  readonly category: string;
  readonly retryable: boolean;
  readonly requestId?: string;
  readonly traceId?: string;
  readonly status?: number;
  readonly causeIdentity?: string;

  constructor(options: {
    readonly message: string;
    readonly code: string;
    readonly category: string;
    readonly retryable: boolean;
    readonly requestId?: string;
    readonly traceId?: string;
    readonly status?: number;
    readonly causeIdentity?: string;
    readonly cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = "IntelligenceLangGraphAdapterError";
    this.code = options.code;
    this.category = options.category;
    this.retryable = options.retryable;
    this.requestId = options.requestId;
    this.traceId = options.traceId;
    this.status = options.status;
    this.causeIdentity = options.causeIdentity;
  }
}

function adapterError(
  message: string,
  code: string,
  category: string,
  retryable: boolean,
  cause?: unknown,
  causeIdentity?: string,
): AdapterError {
  return new AdapterError({
    message,
    code,
    category,
    retryable,
    cause,
    causeIdentity,
  });
}

function isCanonicalError(error: unknown): error is CanonicalError {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    "category" in error &&
    typeof error.category === "string" &&
    "retryable" in error &&
    typeof error.retryable === "boolean"
  );
}

function canonicalError(error: unknown): CanonicalError {
  if (isCanonicalError(error)) return error;
  return adapterError(
    "Registry load failed",
    "INTELLIGENCE_ADAPTER_TRANSIENT_FAILURE",
    "availability",
    true,
    error,
  );
}

function isPermanentDenial(error: CanonicalError): boolean {
  return (
    (error.code.startsWith("INTELLIGENCE_ADAPTER_") &&
      error.code !== "INTELLIGENCE_ADAPTER_TRANSIENT_FAILURE") ||
    error.code === "LEARNING_REGISTRY_DENIED" ||
    error.code === "LEARNING_REGISTRY_UNRECOVERABLE" ||
    error.code === "LEARNING_CONTAINER_ARCHIVED" ||
    error.code === "LEARNING_CONTAINER_PROJECT_MISMATCH" ||
    error.code === "LEARNING_CONTAINER_NOT_FOUND" ||
    error.category === "auth" ||
    error.category === "permission" ||
    error.category === "not_found" ||
    error.status === 401 ||
    error.status === 403 ||
    error.status === 404 ||
    error.status === 410
  );
}

function immutableSnapshot(snapshot: AdapterSnapshot): AdapterSnapshot {
  return Object.freeze({
    ...snapshot,
    renderedSkills: Object.freeze([...snapshot.renderedSkills]),
  });
}

function emptySnapshot(): AdapterSnapshot {
  return immutableSnapshot({
    status: "cold",
    source: "none",
    installedSkillSet: null,
    renderedSkills: [],
    prompt: "",
    lastAttemptAt: null,
    lastSuccessAt: null,
    error: null,
    registryRevision: null,
  });
}

function renderPrompt(skills: readonly RenderedSkill[]): string {
  if (skills.length === 0) return "";
  return [
    "CopilotKit Intelligence Registry skills (verified, ordered):",
    ...skills.map(
      (skill) =>
        `<skill id="${skill.skillId}" version="${skill.versionId}" name=${JSON.stringify(skill.name)} description=${JSON.stringify(skill.description)}>\n${skill.text}</skill>`,
    ),
  ].join("\n\n");
}

export class RegistryState {
  private readonly options: Required<
    Pick<
      RegistryStateOptions,
      | "refreshIntervalMs"
      | "maximumSkills"
      | "maximumInstructionBytes"
      | "maximumAggregateBytes"
      | "clock"
    >
  > &
    Pick<RegistryStateOptions, "client" | "learningContainerId" | "telemetry">;
  private current = emptySnapshot();
  private closedLatch = false;
  private inFlight: Promise<AdapterSnapshot> | null = null;
  private joinedCallers = 0;
  private joinedTelemetryChain: Promise<void> = Promise.resolve();
  private readonly closedFailure = adapterError(
    "Registry adapter is closed",
    "LEARNING_REGISTRY_CLOSED",
    "lifecycle",
    false,
    undefined,
    "closed-1",
  );
  private readonly waiters = new Set<{
    readonly resolve: (snapshot: AdapterSnapshot) => void;
    readonly reject: (error: Error) => void;
  }>();

  constructor(options: RegistryStateOptions) {
    this.options = {
      ...options,
      refreshIntervalMs:
        options.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS,
      maximumSkills: options.maximumSkills ?? DEFAULT_MAXIMUM_SKILLS,
      maximumInstructionBytes:
        options.maximumInstructionBytes ?? DEFAULT_MAXIMUM_INSTRUCTION_BYTES,
      maximumAggregateBytes:
        options.maximumAggregateBytes ?? DEFAULT_MAXIMUM_AGGREGATE_BYTES,
      clock: options.clock ?? (() => performance.now()),
    };
    for (const [name, value] of Object.entries({
      refreshIntervalMs: this.options.refreshIntervalMs,
      maximumSkills: this.options.maximumSkills,
      maximumInstructionBytes: this.options.maximumInstructionBytes,
      maximumAggregateBytes: this.options.maximumAggregateBytes,
    })) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new TypeError(`${name} must be a positive safe integer`);
      }
    }
    if (this.options.learningContainerId.length === 0) {
      throw new TypeError("learningContainerId is required");
    }
  }

  get snapshot(): AdapterSnapshot {
    return this.current;
  }

  get ready(): boolean {
    return this.current.status === "ready" || this.current.status === "revoked";
  }

  get status(): AdapterStatus {
    return this.current.status;
  }

  preload(): Promise<AdapterSnapshot> {
    return this.startLoad("preload", false);
  }

  preloadCached(): Promise<AdapterSnapshot> {
    return this.startLoad("preload", true);
  }

  load(): Promise<AdapterSnapshot> {
    if (this.closedLatch) return Promise.reject(this.closedError());
    if (this.inFlight !== null) {
      return this.startLoad(this.ready ? "refresh" : "load", false);
    }
    const now = this.options.clock();
    const lastAttemptAt = this.current.lastAttemptAt;
    if (
      lastAttemptAt !== null &&
      now - lastAttemptAt < this.options.refreshIntervalMs
    ) {
      if (this.ready) return this.completeThrottledReadyLoad();
      return this.emit("load.throttled", {
        source: "refresh",
      }).then(() => {
        throw (
          this.current.error ??
          adapterError(
            "Registry is not ready",
            "LEARNING_REGISTRY_STALE",
            "availability",
            true,
          )
        );
      });
    }
    return this.startLoad(
      this.current.installedSkillSet ? "refresh" : "load",
      false,
    );
  }

  private async completeThrottledReadyLoad(): Promise<AdapterSnapshot> {
    const ready = this.current;
    await this.emit("load.throttled", {
      source: "load",
    });
    return ready;
  }

  async waitUntilReady(options: {
    readonly timeoutMs: number;
  }): Promise<AdapterSnapshot> {
    this.throwIfClosed();
    if (this.ready) return this.current;
    if (
      this.current.status === "denied" ||
      this.current.status === "stale" ||
      this.current.status === "closed"
    ) {
      throw this.current.error ?? this.closedError();
    }
    if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 0) {
      throw new TypeError("timeoutMs must be a non-negative safe integer");
    }
    return new Promise<AdapterSnapshot>((resolveWait, rejectWait) => {
      const waiter = { resolve: resolveWait, reject: rejectWait };
      this.waiters.add(waiter);
      const timeout = setTimeout(() => {
        this.waiters.delete(waiter);
        rejectWait(
          adapterError(
            "Timed out waiting for the Registry adapter to become ready",
            "LEARNING_REGISTRY_READINESS_TIMEOUT",
            "availability",
            true,
            undefined,
            `timeout-${options.timeoutMs}`,
          ),
        );
      }, options.timeoutMs);
      const resolveWaiter = waiter.resolve;
      const rejectWaiter = waiter.reject;
      Object.assign(waiter, {
        resolve: (snapshot: AdapterSnapshot) => {
          clearTimeout(timeout);
          resolveWaiter(snapshot);
        },
        reject: (error: Error) => {
          clearTimeout(timeout);
          rejectWaiter(error);
        },
      });
    });
  }

  async close(): Promise<void> {
    if (this.closedLatch) return;
    this.closedLatch = true;
    const error = this.closedError();
    await this.swap(
      immutableSnapshot({
        ...this.current,
        status: "closed",
        source: "none",
        installedSkillSet: null,
        renderedSkills: [],
        prompt: "",
        error,
      }),
    );
  }

  private startLoad(
    source: LoadSource,
    cached: boolean,
  ): Promise<AdapterSnapshot> {
    if (this.closedLatch) return Promise.reject(this.closedError());
    if (this.inFlight !== null) {
      this.joinedCallers += 1;
      const joinedTelemetry = this.emit("load.singleflight_joined", {
        joinedCallers: this.joinedCallers + 1,
      }).then(
        () => ({ succeeded: true }) as const,
        (error: unknown) => ({ succeeded: false, error }) as const,
      );
      this.joinedTelemetryChain = this.joinedTelemetryChain.then(
        async () => {
          const result = await joinedTelemetry;
          if (!result.succeeded) throw result.error;
        },
        async (firstError: unknown) => {
          await joinedTelemetry;
          throw firstError;
        },
      );
      // Observe rejection immediately so a slow Registry request cannot leave
      // this internal chain unhandled. performLoad still awaits the original
      // rejected chain and surfaces that exact first failure to every caller.
      void this.joinedTelemetryChain.catch(() => undefined);
      return this.inFlight;
    }
    const promise = this.performLoad(source, cached);
    this.inFlight = promise;
    this.joinedCallers = 0;
    this.joinedTelemetryChain = Promise.resolve();
    // Observe both outcomes solely to release the single-flight slot; callers
    // still receive the original promise and its rejection unchanged.
    void promise.then(
      () => {
        if (this.inFlight === promise) this.inFlight = null;
      },
      () => {
        if (this.inFlight === promise) this.inFlight = null;
      },
    );
    return promise;
  }

  private async performLoad(
    source: LoadSource,
    cached: boolean,
  ): Promise<AdapterSnapshot> {
    const startedAt = this.options.clock();
    const loadingStatus = this.current.installedSkillSet
      ? "refreshing"
      : "loading";
    this.current = immutableSnapshot({
      ...this.current,
      status: loadingStatus,
      lastAttemptAt: startedAt,
      error: null,
    });
    try {
      await this.emit("load.started", { source });
      this.throwIfClosed();
      const installed = await (cached
        ? this.options.client.skills.getCached({
            learningContainerId: this.options.learningContainerId,
          })
        : this.options.client.skills.get({
            learningContainerId: this.options.learningContainerId,
          }));
      await this.drainJoinedTelemetry();
      this.throwIfClosed();
      const renderedSkills = await this.render(installed);
      await this.drainJoinedTelemetry();
      this.throwIfClosed();
      const completedAt = this.options.clock();
      const status = installed.projection.revoked ? "revoked" : "ready";
      const next = immutableSnapshot({
        status,
        source: installed.freshness,
        installedSkillSet: installed,
        renderedSkills,
        prompt: renderPrompt(renderedSkills),
        lastAttemptAt: startedAt,
        lastSuccessAt: completedAt,
        error: null,
        registryRevision: installed.projection.registryRevision,
      });
      await this.swap(next);
      this.throwIfClosed();
      await this.emit("load.succeeded", {
        outcome: "success",
        freshness: installed.freshness,
        skillCount: renderedSkills.length,
        registryRevision: installed.projection.registryRevision,
        refreshLatencyMs: completedAt - startedAt,
      });
      await this.drainJoinedTelemetry();
      this.throwIfClosed();
      return next;
    } catch (error) {
      this.throwIfClosed();
      if (this.isTelemetryFailure(error)) return this.failTelemetry(error);
      try {
        await this.drainJoinedTelemetry();
      } catch (joinedTelemetryError) {
        this.throwIfClosed();
        if (this.isTelemetryFailure(joinedTelemetryError)) {
          return this.failTelemetry(joinedTelemetryError);
        }
        throw joinedTelemetryError;
      }
      this.throwIfClosed();

      const canonical = canonicalError(error);
      const denied = isPermanentDenial(canonical);
      const surfaced = denied
        ? canonical
        : new AdapterError({
            message: "Registry refresh failed; stale skills are unavailable",
            code: "LEARNING_REGISTRY_STALE",
            category:
              canonical.code === "LEARNING_BLOB_INTEGRITY_FAILURE"
                ? "integrity"
                : "availability",
            retryable: canonical.retryable,
            requestId: canonical.requestId,
            traceId: canonical.traceId,
            status: canonical.status,
            causeIdentity: canonical.causeIdentity,
            cause: canonical,
          });
      const next = immutableSnapshot({
        ...this.current,
        status: denied ? "denied" : "stale",
        source: this.current.installedSkillSet ? this.current.source : "none",
        error: surfaced,
        installedSkillSet: denied ? null : this.current.installedSkillSet,
        renderedSkills: denied ? [] : this.current.renderedSkills,
        prompt: denied ? "" : this.current.prompt,
      });
      const terminalTelemetry = await (async () => {
        try {
          this.throwIfClosed();
          await this.swap(next);
          this.throwIfClosed();
          await this.emit("load.failed", this.errorMetadata(surfaced));
          this.throwIfClosed();
          return { succeeded: true } as const;
        } catch (terminalError) {
          return { succeeded: false, error: terminalError } as const;
        }
      })();
      try {
        await this.drainJoinedTelemetry();
      } catch (joinedTelemetryError) {
        this.throwIfClosed();
        if (this.isTelemetryFailure(joinedTelemetryError)) {
          return this.failTelemetry(joinedTelemetryError);
        }
        throw joinedTelemetryError;
      }
      this.throwIfClosed();
      if (!terminalTelemetry.succeeded) {
        if (this.isTelemetryFailure(terminalTelemetry.error)) {
          return this.failTelemetry(terminalTelemetry.error);
        }
        throw terminalTelemetry.error;
      }
      throw error;
    }
  }

  private async render(
    installed: InstalledSkillSet,
  ): Promise<readonly RenderedSkill[]> {
    if (installed.skills.length !== installed.projection.entries.length) {
      throw adapterError(
        "Installed skills do not match the verified projection",
        "INTELLIGENCE_ADAPTER_UNSUPPORTED_SDK_PROJECTION",
        "integrity",
        false,
      );
    }
    if (installed.skills.length > this.options.maximumSkills) {
      throw adapterError(
        "Registry projection exceeds the adapter skill limit",
        "INTELLIGENCE_ADAPTER_TOO_MANY_SKILLS",
        "validation",
        false,
        undefined,
        `count-${installed.skills.length}`,
      );
    }
    for (const entry of installed.projection.entries) {
      if (
        entry.manifest.files.some((file) => {
          const normalized = posix.normalize(file.path);
          return file.role === "script" || normalized.startsWith("scripts/");
        })
      ) {
        throw adapterError(
          "Executable skill artifacts are disabled",
          "INTELLIGENCE_ADAPTER_SCRIPT_DISABLED",
          "validation",
          false,
          undefined,
          "script-disabled-1",
        );
      }
    }

    const rendered: RenderedSkill[] = [];
    let aggregateBytes = 0;
    for (const [index, skill] of installed.skills.entries()) {
      const entry = installed.projection.entries[index];
      if (
        !entry ||
        skill.skillId !== entry.skillId ||
        skill.versionId !== entry.versionId ||
        skill.position !== entry.position
      ) {
        throw adapterError(
          "Installed skill identity does not match the verified projection",
          "INTELLIGENCE_ADAPTER_UNSUPPORTED_SDK_PROJECTION",
          "integrity",
          false,
        );
      }
      let bytes: Uint8Array;
      try {
        bytes = await readFile(resolve(skill.directory, "SKILL.md"));
      } catch (error) {
        throw adapterError(
          "Verified root SKILL.md is unavailable",
          "INTELLIGENCE_ADAPTER_INVALID_UTF8",
          "integrity",
          false,
          error,
        );
      }
      if (bytes.byteLength > this.options.maximumInstructionBytes) {
        throw adapterError(
          "SKILL.md exceeds the adapter byte limit",
          "INTELLIGENCE_ADAPTER_SKILL_TOO_LARGE",
          "validation",
          false,
          undefined,
          `bytes-${bytes.byteLength}`,
        );
      }
      aggregateBytes += bytes.byteLength;
      if (aggregateBytes > this.options.maximumAggregateBytes) {
        throw adapterError(
          "Rendered skills exceed the adapter aggregate byte limit",
          "INTELLIGENCE_ADAPTER_CONTEXT_TOO_LARGE",
          "validation",
          false,
          undefined,
          `bytes-${aggregateBytes}`,
        );
      }
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch (error) {
        throw adapterError(
          "SKILL.md is not strict UTF-8",
          "INTELLIGENCE_ADAPTER_INVALID_UTF8",
          "integrity",
          false,
          error,
          "utf8-1",
        );
      }
      rendered.push(
        Object.freeze({
          position: entry.position,
          kind: "instruction",
          name: entry.name,
          text,
          byteLength: bytes.byteLength,
          skillId: entry.skillId,
          versionId: entry.versionId,
          description: entry.description,
        }),
      );
    }
    return Object.freeze(rendered);
  }

  private async swap(next: AdapterSnapshot): Promise<void> {
    const previous = this.current.status;
    this.current = next;
    this.settleWaiters(next);
    if (previous !== next.status) {
      await this.emit("status.changed", { status: next.status });
    }
  }

  private settleWaiters(next: AdapterSnapshot): void {
    if (next.status === "ready" || next.status === "revoked") {
      for (const waiter of this.waiters) waiter.resolve(next);
      this.waiters.clear();
    } else if (
      next.status === "denied" ||
      next.status === "stale" ||
      next.status === "closed"
    ) {
      this.rejectWaiters(next.error ?? this.closedError());
    }
  }

  private async drainJoinedTelemetry(): Promise<void> {
    let observed: Promise<void>;
    do {
      observed = this.joinedTelemetryChain;
      await observed;
    } while (observed !== this.joinedTelemetryChain);
  }

  private rejectWaiters(error: Error): void {
    for (const waiter of this.waiters) waiter.reject(error);
    this.waiters.clear();
  }

  private closedError(): AdapterError {
    return this.closedFailure;
  }

  private throwIfClosed(): void {
    if (this.closedLatch) throw this.closedError();
  }

  private isTelemetryFailure(error: unknown): error is AdapterError {
    return (
      error instanceof AdapterError &&
      error.code === "LEARNING_TELEMETRY_SINK_FAILED"
    );
  }

  private async failTelemetry(error: AdapterError): Promise<never> {
    this.throwIfClosed();
    const next = immutableSnapshot({
      ...this.current,
      status: "denied",
      source: "none",
      installedSkillSet: null,
      renderedSkills: [],
      prompt: "",
      error,
    });
    try {
      this.throwIfClosed();
      await this.swap(next);
      this.throwIfClosed();
    } catch {
      this.throwIfClosed();
      // Preserve the initiating canonical failure if the terminal status
      // notification also rejects.
    }
    try {
      await this.emit("load.failed", this.errorMetadata(error));
      this.throwIfClosed();
    } catch {
      this.throwIfClosed();
      // Preserve one error identity for every caller of this load.
    }
    try {
      await this.drainJoinedTelemetry();
      this.throwIfClosed();
    } catch {
      this.throwIfClosed();
      // The initiating canonical telemetry failure remains authoritative.
    }
    this.throwIfClosed();
    throw error;
  }

  private errorMetadata(
    error: CanonicalError,
  ): Omit<
    SkillRegistryTelemetryEvent["metadata"],
    "framework" | "adapterVersion"
  > {
    return {
      outcome: "failure",
      reason:
        this.current.status === "stale"
          ? error.category === "integrity"
            ? "integrity"
            : "transient"
          : this.current.status === "closed"
            ? "closed"
            : this.current.status === "loading"
              ? "loading"
              : "denied",
      errorCode: error.code,
      errorCategory: error.category,
      retryable: error.retryable,
      ...(error.requestId ? { requestId: error.requestId } : {}),
      ...(error.traceId ? { traceId: error.traceId } : {}),
    };
  }

  private async emit(
    name: SkillRegistryTelemetryEvent["name"],
    metadata: Omit<
      SkillRegistryTelemetryEvent["metadata"],
      "framework" | "adapterVersion"
    >,
  ): Promise<void> {
    if (!this.options.telemetry) return;
    try {
      await this.options.telemetry(
        Object.freeze({
          name,
          atMs: this.options.clock(),
          metadata: Object.freeze({
            framework: FRAMEWORK,
            adapterVersion: ADAPTER_VERSION,
            ...metadata,
          }),
        }),
      );
    } catch (error) {
      throw new AdapterError({
        message: "Registry telemetry sink failed",
        code: "LEARNING_TELEMETRY_SINK_FAILED",
        category: "internal",
        retryable: false,
        causeIdentity: error instanceof Error ? error.message : String(error),
        cause: error,
      });
    }
  }
}
