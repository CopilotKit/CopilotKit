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

import { createTelemetryEgressGuard } from "./src/lib/testing/telemetry-egress-guard.js";

// No test may POST a real `oss.inspector.*` event to the live telemetry sink —
// see the helper for why no environment variable can cover this.
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

// The announcement read state lives in a cookie because cookies are scoped to
// the host while localStorage is scoped to the origin (port included), and
// "have I read this announcement" has to survive a change of dev-server port.
// jsdom's own `document.cookie` is backed by a jar we cannot reset or block
// between tests, so we install an in-memory one in the same style as the
// localStorage shim above: a fresh jar per test, and a plain configurable
// accessor so a test can shadow it to simulate a browser that blocks cookies.
function installCookieShim(): void {
  // Some suites in this package declare the `node` environment and have no
  // document at all.
  if (typeof document === "undefined") return;
  const jar = new Map<string, string>();
  Object.defineProperty(document, "cookie", {
    get(): string {
      return Array.from(jar, ([name, value]) => `${name}=${value}`).join("; ");
    },
    set(input: string): void {
      const [pair, ...attributes] = String(input).split(";");
      const separator = pair?.indexOf("=") ?? -1;
      if (!pair || separator === -1) return;
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      // A real browser deletes rather than stores a cookie whose lifetime has
      // already elapsed, so the shim does too.
      const expired = attributes.some((attribute) => {
        const [key, raw] = attribute.split("=");
        return key?.trim().toLowerCase() === "max-age" && Number(raw) <= 0;
      });
      if (expired) {
        jar.delete(name);
        return;
      }
      jar.set(name, value);
    },
    configurable: true,
  });
}

/**
 * jsdom exposes mouse events but does not construct PointerEvent. The
 * Inspector uses pointer handlers for launcher and resize interactions, so a
 * small MouseEvent-based constructor keeps those tests on their browser path.
 */
function installPointerEventShim(): void {
  if (
    typeof globalThis.PointerEvent === "function" ||
    typeof globalThis.MouseEvent !== "function"
  ) {
    return;
  }

  class PointerEventShim extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly isPrimary: boolean;

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? "mouse";
      this.isPrimary = init.isPrimary ?? true;
    }
  }

  Object.defineProperty(globalThis, "PointerEvent", {
    value: PointerEventShim,
    writable: true,
    configurable: true,
  });
}

/**
 * jsdom does not implement the pointer-capture methods, so any handler that
 * releases capture on pointerup throws under test even though it is correct in
 * every real browser. Capture has no observable effect here, so tracking the
 * captured ids is enough to keep the handlers on their normal path.
 */
function installPointerCaptureShim(): void {
  const proto = globalThis.Element?.prototype as
    | (Element & { __cpkPointerCapture?: Set<number> })
    | undefined;
  if (!proto || typeof proto.hasPointerCapture === "function") return;

  const captured = new WeakMap<Element, Set<number>>();
  const ids = (element: Element): Set<number> => {
    const existing = captured.get(element);
    if (existing) return existing;
    const created = new Set<number>();
    captured.set(element, created);
    return created;
  };

  proto.setPointerCapture = function setPointerCapture(pointerId: number) {
    ids(this).add(pointerId);
  };
  proto.releasePointerCapture = function releasePointerCapture(
    pointerId: number,
  ) {
    ids(this).delete(pointerId);
  };
  proto.hasPointerCapture = function hasPointerCapture(pointerId: number) {
    return ids(this).has(pointerId);
  };
}

// Install once at module load so any top-level code in test files (e.g.
// imports that read localStorage on init) sees the shim.
installLocalStorageShim();
installCookieShim();
installPointerEventShim();
installPointerCaptureShim();

// Re-install before each test so `vi.restoreAllMocks()` from a prior test
// can't leave behind spied/replaced methods, and each test starts with an
// empty store.
beforeEach(() => {
  installLocalStorageShim();
  installCookieShim();
});
