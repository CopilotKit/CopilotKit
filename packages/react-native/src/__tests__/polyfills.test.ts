import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock streaming-fetch to isolate polyfill tests
vi.mock("../streaming-fetch", () => ({
  installStreamingFetch: vi.fn(),
}));

// ─── Global save/restore ──────────────────────────────────────────────────────

const savedGlobals: Record<string, any> = {};

function saveGlobal(name: string) {
  savedGlobals[name] = (globalThis as any)[name];
}

function deleteGlobal(name: string) {
  saveGlobal(name);
  delete (globalThis as any)[name];
}

function restoreGlobals() {
  for (const [name, value] of Object.entries(savedGlobals)) {
    if (value === undefined) {
      delete (globalThis as any)[name];
    } else {
      (globalThis as any)[name] = value;
    }
  }
  // Clear the saved state
  for (const key of Object.keys(savedGlobals)) {
    delete savedGlobals[key];
  }
}

async function importPolyfills() {
  vi.resetModules();
  await import("../polyfills");
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("polyfills", () => {
  afterEach(() => {
    restoreGlobals();
  });

  // ── ReadableStream / WritableStream / TransformStream ───────────────────

  describe("ReadableStream / WritableStream / TransformStream", () => {
    it("installs when missing", async () => {
      deleteGlobal("ReadableStream");
      deleteGlobal("WritableStream");
      deleteGlobal("TransformStream");
      await importPolyfills();
      expect(typeof globalThis.ReadableStream).toBe("function");
      expect(typeof (globalThis as any).WritableStream).toBe("function");
      expect(typeof (globalThis as any).TransformStream).toBe("function");
    });

    it("preserves existing ReadableStream", async () => {
      const sentinel = function Sentinel() {};
      saveGlobal("ReadableStream");
      (globalThis as any).ReadableStream = sentinel;
      await importPolyfills();
      expect((globalThis as any).ReadableStream).toBe(sentinel);
    });
  });

  // ── TextEncoder / TextDecoder ───────────────────────────────────────────

  describe("TextEncoder / TextDecoder", () => {
    it("installs TextEncoder when missing", async () => {
      deleteGlobal("TextEncoder");
      await importPolyfills();
      expect(typeof globalThis.TextEncoder).toBe("function");
    });

    it("installs TextDecoder when missing", async () => {
      deleteGlobal("TextDecoder");
      await importPolyfills();
      expect(typeof globalThis.TextDecoder).toBe("function");
    });

    it("preserves existing TextEncoder", async () => {
      const sentinel = function Sentinel() {};
      saveGlobal("TextEncoder");
      (globalThis as any).TextEncoder = sentinel;
      await importPolyfills();
      expect((globalThis as any).TextEncoder).toBe(sentinel);
    });
  });

  // ── crypto.getRandomValues ──────────────────────────────────────────────

  describe("crypto.getRandomValues", () => {
    it("installs when crypto is undefined", async () => {
      deleteGlobal("crypto");
      vi.spyOn(console, "warn").mockImplementation(() => {});
      await importPolyfills();
      expect(typeof globalThis.crypto.getRandomValues).toBe("function");
    });

    it("installs when crypto exists but getRandomValues is missing", async () => {
      saveGlobal("crypto");
      (globalThis as any).crypto = {};
      vi.spyOn(console, "warn").mockImplementation(() => {});
      await importPolyfills();
      expect(typeof globalThis.crypto.getRandomValues).toBe("function");
    });

    it("preserves existing getRandomValues", async () => {
      const sentinel = vi.fn();
      saveGlobal("crypto");
      (globalThis as any).crypto = { getRandomValues: sentinel };
      await importPolyfills();
      expect(globalThis.crypto.getRandomValues).toBe(sentinel);
    });

    it("produces a filled Uint8Array with values in [0, 255]", async () => {
      deleteGlobal("crypto");
      vi.spyOn(console, "warn").mockImplementation(() => {});
      await importPolyfills();

      const arr = new Uint8Array(32);
      const result = globalThis.crypto.getRandomValues(arr);
      expect(result).toBe(arr);
      // With 32 random bytes, at least some should be non-zero
      expect(arr.some((v) => v > 0)).toBe(true);
      expect(arr.every((v) => v >= 0 && v <= 255)).toBe(true);
    });

    it("logs a security warning", async () => {
      deleteGlobal("crypto");
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      await importPolyfills();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("non-cryptographic"),
      );
    });
  });

  // ── DOMException ────────────────────────────────────────────────────────

  describe("DOMException", () => {
    it("installs when missing", async () => {
      deleteGlobal("DOMException");
      await importPolyfills();
      expect(typeof (globalThis as any).DOMException).toBe("function");
    });

    it("polyfill supports name parameter (e.g. AbortError)", async () => {
      deleteGlobal("DOMException");
      await importPolyfills();
      const err = new (globalThis as any).DOMException("msg", "AbortError");
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("AbortError");
      expect(err.message).toBe("msg");
    });

    it("preserves existing DOMException", async () => {
      const sentinel = function Sentinel() {};
      saveGlobal("DOMException");
      (globalThis as any).DOMException = sentinel;
      await importPolyfills();
      expect((globalThis as any).DOMException).toBe(sentinel);
    });
  });

  // ── Headers ─────────────────────────────────────────────────────────────

  describe("Headers polyfill", () => {
    it("installs when missing", async () => {
      deleteGlobal("Headers");
      await importPolyfills();
      expect(typeof (globalThis as any).Headers).toBe("function");
    });

    it("supports get/set/has/delete/append", async () => {
      deleteGlobal("Headers");
      await importPolyfills();
      const h = new Headers();
      h.set("X-Key", "val1");
      expect(h.get("x-key")).toBe("val1");
      expect(h.has("x-key")).toBe(true);
      h.append("x-key", "val2");
      expect(h.get("x-key")).toBe("val1, val2");
      h.delete("x-key");
      expect(h.has("x-key")).toBe(false);
    });

    it("normalizes header names to lowercase", async () => {
      deleteGlobal("Headers");
      await importPolyfills();
      const h = new Headers({ "Content-Type": "text/html" });
      expect(h.get("content-type")).toBe("text/html");
    });

    it("is iterable", async () => {
      deleteGlobal("Headers");
      await importPolyfills();
      const h = new Headers({ a: "1", b: "2" });
      const entries = [...h];
      expect(entries).toEqual(
        expect.arrayContaining([
          ["a", "1"],
          ["b", "2"],
        ]),
      );
    });

    it("preserves existing Headers", async () => {
      const sentinel = function Sentinel() {};
      saveGlobal("Headers");
      (globalThis as any).Headers = sentinel;
      await importPolyfills();
      expect((globalThis as any).Headers).toBe(sentinel);
    });
  });

  // ── window.location ─────────────────────────────────────────────────────

  describe("window.location", () => {
    it("installs with react-native.invalid hostname when missing", async () => {
      if (typeof window !== "undefined") {
        saveGlobal("location");
        delete (window as any).location;
        await importPolyfills();
        expect((window as any).location.hostname).toBe("react-native.invalid");
      }
    });
  });

  // ── streaming fetch integration ─────────────────────────────────────────

  describe("streaming fetch integration", () => {
    it("calls installStreamingFetch()", async () => {
      await importPolyfills();
      const { installStreamingFetch } = await import("../streaming-fetch");
      expect(installStreamingFetch).toHaveBeenCalled();
    });
  });
});
