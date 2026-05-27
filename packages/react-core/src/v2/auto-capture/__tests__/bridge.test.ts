import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearAutoCaptureDispatch,
  getAutoCaptureBridge,
  installAutoCapturePatches,
  setAutoCaptureDispatch,
  uninstallAutoCapturePatches,
} from "../bridge";
import { resetAutoCaptureGlobals } from "./reset-globals";

afterEach(() => {
  // Ensure a failed assertion here can never leak a patched global into the
  // next test file when the suite runs many files in parallel.
  resetAutoCaptureGlobals();
});

describe("auto-capture bridge install/restore", () => {
  it("patches fetch once across consumers and restores on the last release", () => {
    const originalFetch = globalThis.fetch;

    installAutoCapturePatches();
    expect(globalThis.fetch).not.toBe(originalFetch);
    const patchedRef = globalThis.fetch;
    expect(getAutoCaptureBridge().enabled).toBe(true);

    // Second consumer must NOT double-patch.
    installAutoCapturePatches();
    expect(globalThis.fetch).toBe(patchedRef);

    // First release keeps the patch installed (one consumer remains).
    uninstallAutoCapturePatches();
    expect(globalThis.fetch).toBe(patchedRef);

    // Last release restores the original and disables the bridge.
    uninstallAutoCapturePatches();
    expect(globalThis.fetch).toBe(originalFetch);
    expect(getAutoCaptureBridge().enabled).toBe(false);
  });

  it("patches and restores XMLHttpRequest open/send", () => {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    installAutoCapturePatches();
    expect(XMLHttpRequest.prototype.open).not.toBe(originalOpen);
    expect(XMLHttpRequest.prototype.send).not.toBe(originalSend);

    uninstallAutoCapturePatches();
    expect(XMLHttpRequest.prototype.open).toBe(originalOpen);
    expect(XMLHttpRequest.prototype.send).toBe(originalSend);
  });
});

describe("dispatch ownership", () => {
  it("only clears the dispatcher when the caller still owns it", () => {
    const a = vi.fn();
    const b = vi.fn();

    setAutoCaptureDispatch(a);
    clearAutoCaptureDispatch(b); // not the owner — no-op
    expect(getAutoCaptureBridge().dispatch).toBe(a);

    clearAutoCaptureDispatch(a); // owner — clears
    expect(getAutoCaptureBridge().dispatch).toBeNull();
  });
});
