import { patchFetch, restoreFetch } from "./patch-fetch";
import { patchXHR, restoreXHR } from "./patch-xhr";
import type { RawExchange } from "./types";

/**
 * The single, module-level "latest ref" the patched `fetch`/XHR read at call
 * time. The React hook keeps `dispatch` pointed at a context-bound pipeline and
 * flips `enabled` on/off; the patch closures only ever read this object, so
 * they always see current state without re-patching. Mirrors how
 * `CopilotKitProvider` syncs the long-lived `CopilotKitCore`.
 */
export interface AutoCaptureBridge {
  enabled: boolean;
  dispatch: ((raw: RawExchange) => void) | null;
}

const bridge: AutoCaptureBridge = { enabled: false, dispatch: null };

/** Access the shared bridge (used by the patch layer and tests). */
export const getAutoCaptureBridge = (): AutoCaptureBridge => bridge;

// Reference count so the global patch is installed once across any number of
// active consumers and restored only when the last one tears down.
let installCount = 0;

/**
 * Install the global `fetch`/XHR patches if not already installed, and mark the
 * bridge enabled. Browser-only and idempotent (double-patch guarded). Safe to
 * call from multiple consumers; the patch is installed exactly once.
 */
export function installAutoCapturePatches(): void {
  if (typeof window === "undefined") return;
  installCount += 1;
  if (installCount === 1) {
    patchFetch(bridge);
    patchXHR(bridge);
  }
  bridge.enabled = true;
}

/**
 * Release one consumer. When the last consumer releases, the original
 * `fetch`/XHR are restored and the bridge is fully disabled.
 */
export function uninstallAutoCapturePatches(): void {
  if (typeof window === "undefined") return;
  if (installCount === 0) return;
  installCount -= 1;
  if (installCount === 0) {
    restoreFetch();
    restoreXHR();
    bridge.enabled = false;
    bridge.dispatch = null;
  }
}

/** Point the bridge at a context-bound dispatcher (called on each hook render). */
export function setAutoCaptureDispatch(
  dispatch: (raw: RawExchange) => void,
): void {
  bridge.dispatch = dispatch;
}

/** Clear the dispatcher, but only if it is still the one provided (ownership-safe). */
export function clearAutoCaptureDispatch(
  dispatch: (raw: RawExchange) => void,
): void {
  if (bridge.dispatch === dispatch) {
    bridge.dispatch = null;
  }
}
