import type { CopilotKitCoreReact } from "../lib/react-core";

export type HeaderReadinessState = "pending" | "ready" | "failed";
type HeaderRecord = Record<string, string>;

export interface HeaderReadiness {
  state: HeaderReadinessState;
  wait(): Promise<void>;
  waitForRecovery(): Promise<void>;
  currentHeaders(): HeaderRecord;
  currentRuntimeUrl(): string | undefined;
  update(headers: HeaderRecord): void;
  updateRuntimeUrl(runtimeUrl: string | undefined): void;
  pending(): void;
  ready(headers?: HeaderRecord): void;
  recover(headers?: HeaderRecord): void;
  failed(error: unknown): void;
  dispose(error: unknown): void;
}

export class HeaderReadinessBarrier implements HeaderReadiness {
  state: HeaderReadinessState = "pending";
  private headers: HeaderRecord = Object.freeze({}) as HeaderRecord;
  private hasCurrentHeaders = false;
  private runtimeUrl: string | undefined;
  private failure: unknown;
  private ignoredFailure: unknown;
  private manualRecovery = false;
  private disposed = false;
  private deferred = this.createDeferred();
  private recovery = this.createDeferred();

  wait(): Promise<void> {
    return this.state === "ready"
      ? Promise.resolve()
      : this.state === "failed"
        ? this.deferred.promise
        : this.deferred.promise;
  }

  waitForRecovery(): Promise<void> {
    return this.recovery.promise;
  }

  currentHeaders(): HeaderRecord {
    return this.headers;
  }

  currentRuntimeUrl(): string | undefined {
    return this.runtimeUrl;
  }

  update(headers: HeaderRecord): void {
    this.headers = headers;
    this.hasCurrentHeaders = true;
  }

  updateRuntimeUrl(runtimeUrl: string | undefined): void {
    this.runtimeUrl = runtimeUrl;
  }

  pending(): void {
    if (this.disposed) return;
    if (this.manualRecovery) return;
    if (this.state === "pending") return;
    this.state = "pending";
    this.failure = undefined;
    this.manualRecovery = false;
    this.deferred = this.createDeferred();
  }

  ready(headers?: HeaderRecord): void {
    if (this.disposed) return;
    if (headers !== undefined && !this.hasCurrentHeaders) {
      this.headers = headers;
    }
    this.ignoredFailure = undefined;
    this.failure = undefined;
    this.manualRecovery = false;
    if (this.state === "ready") return;
    this.state = "ready";
    this.deferred.resolve();
    this.recovery.resolve();
  }

  recover(headers?: HeaderRecord): void {
    if (headers !== undefined) this.update(headers);
    const failure = this.failure;
    this.manualRecovery = true;
    this.ready();
    this.manualRecovery = true;
    this.ignoredFailure = failure;
  }

  failed(error: unknown): void {
    if (this.disposed || this.ignoredFailure === error) return;
    this.manualRecovery = false;
    if (this.state === "ready") {
      this.deferred = this.createDeferred();
      this.recovery = this.createDeferred();
    } else if (this.state === "failed" && this.failure !== error) {
      this.deferred = this.createDeferred();
    }
    this.state = "failed";
    this.failure = error;
    this.deferred.reject(error);
    this.deferred.promise.catch(() => {});
  }

  dispose(error: unknown): void {
    if (this.disposed) return;
    this.disposed = true;
    this.state = "failed";
    this.failure = error;
    this.deferred.reject(error);
    this.recovery.reject(error);
    this.deferred.promise.catch(() => {});
    this.recovery.promise.catch(() => {});
  }

  private createDeferred(): {
    promise: Promise<void>;
    resolve: () => void;
    reject: (error: unknown) => void;
  } {
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }
}

const coreBarriers = new WeakMap<object, HeaderReadiness>();
const configBarriers = new WeakMap<object, HeaderReadiness>();
const providerHeaderSync = new WeakSet<object>();

export function bindHeaderReadiness(
  core: CopilotKitCoreReact,
  barrier: HeaderReadiness,
): void {
  coreBarriers.set(core, barrier);
}

export function headerReadinessFor(value: object): HeaderReadiness | undefined {
  return coreBarriers.get(value) ?? configBarriers.get(value);
}

export function bindConfigHeaderReadiness(
  config: object,
  barrier: HeaderReadiness,
): void {
  configBarriers.set(config, barrier);
}

export function withProviderHeaderSync<T>(core: object, fn: () => T): T {
  providerHeaderSync.add(core);
  try {
    return fn();
  } finally {
    providerHeaderSync.delete(core);
  }
}

export function isProviderHeaderSync(core: object): boolean {
  return providerHeaderSync.has(core);
}

export async function waitForHeaderReadiness(value: object): Promise<void> {
  await headerReadinessFor(value)?.wait();
}

export function headerReadinessHeadersFor(
  value: object,
): Record<string, string> | undefined {
  return headerReadinessFor(value)?.currentHeaders();
}

export function headerReadinessRuntimeUrlFor(
  value: object,
): string | undefined {
  return headerReadinessFor(value)?.currentRuntimeUrl();
}
