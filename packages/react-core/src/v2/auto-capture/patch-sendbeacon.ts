import type { AutoCaptureBridge } from "./bridge";
import {
  formDataToObject,
  formUrlEncodedToObject,
  parseBodyText,
  toAbsoluteUrl,
} from "./parse";
import type { RawExchange } from "./types";

const SB_PATCHED = Symbol.for("copilotkit.autoCapture.sendBeaconPatched");
const SB_ORIGINAL = Symbol.for("copilotkit.autoCapture.sendBeaconOriginal");

type SendBeacon = (url: string | URL, data?: BodyInit | null) => boolean;
type PatchableSendBeacon = SendBeacon & {
  [SB_PATCHED]?: boolean;
  [SB_ORIGINAL]?: SendBeacon;
};

let originalSendBeacon: SendBeacon | null = null;

/**
 * Parse a `sendBeacon` payload into a recordable value. Like fetch's request
 * body handling: strings / URLSearchParams / FormData decode into objects;
 * Blob / ArrayBuffer / ArrayBufferView are intentionally not read (we never
 * exfiltrate binary payloads through capture).
 */
const readBeaconBody = (data: BodyInit | null | undefined): unknown => {
  if (data == null) return undefined;
  if (typeof data === "string") return parseBodyText(data, null);
  if (typeof URLSearchParams !== "undefined" && data instanceof URLSearchParams) {
    return formUrlEncodedToObject(data.toString());
  }
  if (typeof FormData !== "undefined" && data instanceof FormData) {
    return formDataToObject(data);
  }
  return undefined;
};

/**
 * Wrap `navigator.sendBeacon`. The beacon API is fire-and-forget (POST with
 * no response and a synchronous boolean return), so the captured exchange
 * carries `method: "POST"`, no response body, and `status: 0` to signal
 * "no response semantics" — matches the convention `patchXHR` uses for an
 * aborted/CORS-failed XHR (also `status === 0`).
 */
export function createPatchedSendBeacon(
  original: SendBeacon,
  bridge: AutoCaptureBridge,
): SendBeacon {
  return function patchedSendBeacon(
    this: Navigator,
    url: string | URL,
    data?: BodyInit | null,
  ): boolean {
    const queued = original.call(this, url, data);
    if (!bridge.enabled || !bridge.dispatch) return queued;

    try {
      const raw: RawExchange = {
        method: "POST",
        url: toAbsoluteUrl(typeof url === "string" ? url : url.toString()),
        requestBody: readBeaconBody(data),
        status: 0,
        responseBody: undefined,
        durationMs: 0,
      };
      bridge.dispatch(raw);
    } catch {
      // capture must never affect the caller
    }

    return queued;
  };
}

/** Install the global `navigator.sendBeacon` patch (idempotent, browser-only). */
export function patchSendBeacon(bridge: AutoCaptureBridge): void {
  if (
    typeof window === "undefined"
    || typeof navigator === "undefined"
    || typeof navigator.sendBeacon !== "function"
  ) {
    return;
  }
  const current = navigator.sendBeacon as PatchableSendBeacon;
  if (current[SB_PATCHED]) {
    // Recover the true original from the patched artifact so a later restore
    // is reliable across module re-instantiation / HMR.
    originalSendBeacon = current[SB_ORIGINAL] ?? originalSendBeacon;
    return;
  }
  // Keep the original reference for an exact restore, but pass a bound copy
  // to the wrapper — calling unbound `navigator.sendBeacon` throws "Illegal
  // invocation" in real browsers.
  originalSendBeacon = navigator.sendBeacon;
  const bound = originalSendBeacon.bind(navigator);
  const patched = createPatchedSendBeacon(bound, bridge) as PatchableSendBeacon;
  patched[SB_PATCHED] = true;
  patched[SB_ORIGINAL] = originalSendBeacon;
  // `navigator.sendBeacon` is a normal configurable property in real browsers;
  // a plain assignment works. jsdom typically doesn't expose `sendBeacon` at
  // all (the guard above short-circuits there), so this branch only runs in
  // real-browser execution.
  navigator.sendBeacon = patched;
}

/**
 * Restore the original `navigator.sendBeacon`. Falls back to the symbol on
 * the patched artifact when the module-level reference was lost, so restore
 * works across module re-instantiation.
 */
export function restoreSendBeacon(): void {
  if (typeof navigator === "undefined") return;
  const current = navigator.sendBeacon as PatchableSendBeacon | undefined;
  const original = originalSendBeacon ?? current?.[SB_ORIGINAL] ?? null;
  if (original) {
    navigator.sendBeacon = original;
  }
  originalSendBeacon = null;
}
