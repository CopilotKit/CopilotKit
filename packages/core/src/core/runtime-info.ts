import type { RuntimeEntitlementResponse } from "@copilotkit/shared";
import type {
  IntelligenceRuntimeInfo,
  RuntimeLicenseStatus,
  ThreadEndpointRuntimeInfo,
} from "../types";
import type { CopilotKitCoreRuntimeConnectionStatus } from "./core";

/**
 * @internal What the connected runtime reported through `/info`, plus the
 * connection status. Read it with `CopilotKitCore.ɵruntimeInfo`. The object is
 * frozen and keeps its identity until a field changes, so framework adapters
 * can project it directly (`useSyncExternalStore`, `shallowRef`, `signal`).
 */
export interface ɵRuntimeInfo {
  readonly status: CopilotKitCoreRuntimeConnectionStatus;
  readonly a2uiEnabled: boolean;
  /** `undefined` means A2UI applies to every agent (or is off). */
  readonly a2uiAgents: string[] | undefined;
  readonly openGenerativeUIEnabled: boolean;
  readonly licenseStatus: RuntimeLicenseStatus | undefined;
  readonly runtimeEntitlements: RuntimeEntitlementResponse | undefined;
  readonly runtimeEntitlementRetryPending: boolean;
  readonly threadEndpoints: ThreadEndpointRuntimeInfo | undefined;
  readonly intelligence: IntelligenceRuntimeInfo | undefined;
  readonly audioFileTranscriptionEnabled: boolean;
}

const RUNTIME_INFO_KEYS = [
  "status",
  "a2uiEnabled",
  "a2uiAgents",
  "openGenerativeUIEnabled",
  "licenseStatus",
  "runtimeEntitlements",
  "runtimeEntitlementRetryPending",
  "threadEndpoints",
  "intelligence",
  "audioFileTranscriptionEnabled",
] as const satisfies readonly (keyof ɵRuntimeInfo)[];

function sameRuntimeInfo(a: ɵRuntimeInfo, b: ɵRuntimeInfo) {
  return RUNTIME_INFO_KEYS.every((key) => a[key] === b[key]);
}

/**
 * @internal Holds the current {@link ɵRuntimeInfo} snapshot.
 *
 * `getSnapshot()` reads the source every time, so it never returns a stale
 * value, and returns the previous object when nothing changed. `refresh()`
 * notifies listeners when the snapshot changed since the last notification.
 */
export class ɵRuntimeInfoStore {
  private snapshot: ɵRuntimeInfo;
  private notified: ɵRuntimeInfo;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly read: () => ɵRuntimeInfo) {
    this.snapshot = Object.freeze(read());
    this.notified = this.snapshot;
  }

  getSnapshot() {
    const next = this.read();
    if (!sameRuntimeInfo(this.snapshot, next)) {
      this.snapshot = Object.freeze(next);
    }
    return this.snapshot;
  }

  /** Re-read the source and notify listeners if the snapshot changed. */
  refresh() {
    const snapshot = this.getSnapshot();
    if (snapshot === this.notified) return;
    this.notified = snapshot;
    const listeners = [...this.listeners];
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        console.error("Runtime info listener error:", error);
      }
    }
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose() {
    this.listeners.clear();
  }
}
