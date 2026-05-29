// Test-only helper: force-restore the global `fetch`/`XMLHttpRequest` to their
// pristine originals and clear the auto-capture guard symbols. The patch layer
// stores the originals on the patched artifacts (under `Symbol.for(...)` keys),
// so this works even if a prior test failed before its own teardown ran —
// guaranteeing one test file can never leak a patched global into the next when
// the suite runs many files in parallel.

const FETCH_PATCHED = Symbol.for("copilotkit.autoCapture.fetchPatched");
const FETCH_ORIGINAL = Symbol.for("copilotkit.autoCapture.fetchOriginal");
const XHR_PATCHED = Symbol.for("copilotkit.autoCapture.xhrPatched");
const XHR_ORIGINAL_OPEN = Symbol.for("copilotkit.autoCapture.xhrOriginalOpen");
const XHR_ORIGINAL_SEND = Symbol.for("copilotkit.autoCapture.xhrOriginalSend");
const SB_PATCHED = Symbol.for("copilotkit.autoCapture.sendBeaconPatched");
const SB_ORIGINAL = Symbol.for("copilotkit.autoCapture.sendBeaconOriginal");

export function resetAutoCaptureGlobals(): void {
  const f = globalThis.fetch as unknown as Record<symbol, unknown>;
  if (f && typeof f[FETCH_ORIGINAL] === "function") {
    globalThis.fetch = f[FETCH_ORIGINAL] as typeof fetch;
  }
  if (f) delete f[FETCH_PATCHED];

  if (typeof XMLHttpRequest !== "undefined") {
    const proto = XMLHttpRequest.prototype as unknown as Record<symbol, unknown>;
    if (typeof proto[XHR_ORIGINAL_OPEN] === "function") {
      XMLHttpRequest.prototype.open = proto[XHR_ORIGINAL_OPEN] as XMLHttpRequest["open"];
    }
    if (typeof proto[XHR_ORIGINAL_SEND] === "function") {
      XMLHttpRequest.prototype.send = proto[XHR_ORIGINAL_SEND] as XMLHttpRequest["send"];
    }
    delete proto[XHR_PATCHED];
    delete proto[XHR_ORIGINAL_OPEN];
    delete proto[XHR_ORIGINAL_SEND];
  }

  if (
    typeof navigator !== "undefined"
    && typeof navigator.sendBeacon === "function"
  ) {
    const sb = navigator.sendBeacon as unknown as Record<symbol, unknown>;
    if (typeof sb[SB_ORIGINAL] === "function") {
      navigator.sendBeacon = sb[SB_ORIGINAL] as typeof navigator.sendBeacon;
    }
    delete sb[SB_PATCHED];
  }
}
