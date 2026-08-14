import type { CopilotKitCoreReact } from "../lib/react-core";

export type HeaderReadinessState = "pending" | "ready" | "failed";
type HeaderRecord = Record<string, string>;

export interface HeaderReadiness {
  state: HeaderReadinessState;
  wait(): Promise<void>;
  waitForRecovery(): Promise<void>;
  currentHeaders(): HeaderRecord;
  pending(): void;
  ready(headers?: HeaderRecord): void;
  failed(error: unknown): void;
}

export class HeaderReadinessBarrier implements HeaderReadiness {
  state: HeaderReadinessState = "pending";
  private headers: HeaderRecord = Object.freeze({}) as HeaderRecord;
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

  pending(): void {
    if (this.state === "pending") return;
    this.state = "pending";
    this.deferred = this.createDeferred();
  }

  ready(headers?: HeaderRecord): void {
    if (headers !== undefined) this.headers = headers;
    if (this.state === "ready") return;
    this.state = "ready";
    this.deferred.resolve();
    this.recovery.resolve();
  }

  failed(error: unknown): void {
    this.state = "failed";
    this.deferred.reject(error);
    this.deferred.promise.catch(() => {});
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
