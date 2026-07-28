// Node 25 ships an experimental built-in `localStorage` global (gated on the
// `--localstorage-file` flag, but the accessor exists unconditionally). When
// vitest boots the jsdom environment, jsdom defines its own `localStorage` on
// the synthetic `window`, but Node's global accessor still wins on
// `globalThis.localStorage` AND — because vitest's jsdom integration aliases
// `window` to `globalThis` — also on `window.localStorage`. The result is that
// `window.localStorage` resolves to Node's stub object which has no `clear`,
// `setItem`, `removeItem`, etc., breaking every test that touches localStorage.
//
// This setup file installs a proper in-memory Storage implementation on both
// `globalThis` and `window` BEFORE any test code runs. The shim is a plain
// object (not a class) so `vi.spyOn(window.localStorage, "getItem")` works —
// vitest needs the methods to be own properties on the spied target.
//
// We re-install the shim in `beforeEach` so a test that did
// `vi.restoreAllMocks()` (which restores spied methods) still sees the shim's
// methods, and so each test starts with a fresh empty store.

import { beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Telemetry egress guard (OSS-565)
//
// The inspector's telemetry is browser-side: it keys off `telemetryDisabled`
// from the runtime's /info handshake, so COPILOTKIT_TELEMETRY_DISABLED in a CI
// job cannot reach it. Any test that drives a banner / threads / open code
// path without stubbing fetch therefore POSTs a real `oss.inspector.*` event
// to the live sink from CI — pollution indistinguishable from user activity.
//
// This wrapper swallows requests to the sink and delegates everything else, so
// tests that stub or spy on fetch themselves are unaffected.
// ---------------------------------------------------------------------------

const TELEMETRY_SINK_ORIGIN = "https://telemetry.copilotkit.ai";

/** Exported for its own unit test — see `telemetry-egress-guard.spec.ts`. */
export function createTelemetryEgressGuard(
  realFetch: typeof fetch,
): typeof fetch {
  return (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url?.startsWith(TELEMETRY_SINK_ORIGIN)) {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    return realFetch(input, init);
  };
}

if (typeof globalThis.fetch === "function") {
  globalThis.fetch = createTelemetryEgressGuard(globalThis.fetch);
}

function createStorageShim(): Storage {
  const store = new Map<string, string>();
  const shim = {
    get length() {
      return store.size;
    },
    key(index: number): string | null {
      return Array.from(store.keys())[index] ?? null;
    },
    getItem(key: string): string | null {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string): void {
      store.set(String(key), String(value));
    },
    removeItem(key: string): void {
      store.delete(key);
    },
    clear(): void {
      store.clear();
    },
  } as Storage;
  return shim;
}

function installLocalStorageShim(): void {
  const shim = createStorageShim();
  // Override the Node 25 global accessor (and any jsdom accessor) with a
  // plain data property pointing at our shim. `configurable: true` so a
  // subsequent install can replace it.
  Object.defineProperty(globalThis, "localStorage", {
    value: shim,
    writable: true,
    configurable: true,
    enumerable: true,
  });
  if (typeof window !== "undefined" && window !== (globalThis as unknown)) {
    Object.defineProperty(window, "localStorage", {
      value: shim,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }
}

// Install once at module load so any top-level code in test files (e.g.
// imports that read localStorage on init) sees the shim.
installLocalStorageShim();

// Re-install before each test so `vi.restoreAllMocks()` from a prior test
// can't leave behind spied/replaced methods, and each test starts with an
// empty store.
beforeEach(() => {
  installLocalStorageShim();
});
