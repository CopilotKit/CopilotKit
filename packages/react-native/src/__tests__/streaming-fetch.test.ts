import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ─── MockXHR ──────────────────────────────────────────────────────────────────

class MockXHR {
  open = vi.fn();
  send = vi.fn();
  abort = vi.fn();
  setRequestHeader = vi.fn();
  getAllResponseHeaders = vi.fn(() => "");

  readyState = 0;
  status = 0;
  statusText = "";
  responseText = "";
  responseType = "";
  timeout = 0;

  onreadystatechange: (() => void) | null = null;
  onprogress: (() => void) | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
}

let mockXhr: MockXHR;

function simulateHeaders(
  xhr: MockXHR,
  status: number,
  headers = "content-type: text/plain\r\n",
  statusText = "OK",
) {
  xhr.readyState = 2;
  xhr.status = status;
  xhr.statusText = statusText;
  xhr.getAllResponseHeaders.mockReturnValue(headers);
  xhr.onreadystatechange?.();
}

function simulateProgress(xhr: MockXHR, text: string) {
  xhr.responseText = text;
  xhr.onprogress?.();
}

function simulateLoad(xhr: MockXHR) {
  xhr.readyState = 4;
  xhr.onload?.();
}

function simulateError(xhr: MockXHR) {
  xhr.onerror?.();
}

function simulateTimeout(xhr: MockXHR) {
  xhr.ontimeout?.();
}

// ─── Globals save/restore ─────────────────────────────────────────────────────

let savedFetch: typeof globalThis.fetch;
let savedXHR: typeof globalThis.XMLHttpRequest;
let savedResponse: typeof globalThis.Response;

beforeEach(() => {
  savedFetch = globalThis.fetch;
  savedXHR = globalThis.XMLHttpRequest;
  savedResponse = globalThis.Response;

  mockXhr = new MockXHR();
  (globalThis as any).XMLHttpRequest = vi.fn(() => mockXhr);

  // Make feature detection fail so the polyfill installs
  (globalThis as any).Response = class {
    body = null;
  };
});

afterEach(() => {
  globalThis.fetch = savedFetch;
  (globalThis as any).XMLHttpRequest = savedXHR;
  (globalThis as any).Response = savedResponse;
});

// ─── Helper: import fresh module ──────────────────────────────────────────────

async function install() {
  // Reset module cache so installStreamingFetch runs fresh
  vi.resetModules();
  const mod = await import("../streaming-fetch");
  mod.installStreamingFetch();
}

// Helper: make a fetch call and capture the mockXhr for lifecycle simulation
async function fetchAndCapture(
  input: string | URL = "https://api.test/stream",
  init?: RequestInit,
) {
  await install();
  const fetchPromise = globalThis.fetch(input, init);
  return { fetchPromise, xhr: mockXhr };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("installStreamingFetch", () => {
  // ── Feature detection ─────────────────────────────────────────────────────

  describe("feature detection", () => {
    it("skips installation when native fetch already supports ReadableStream body", async () => {
      const originalFetch = globalThis.fetch;
      (globalThis as any).Response = class {
        body = {
          getReader: () => ({}),
        };
      };
      await install();
      expect(globalThis.fetch).toBe(originalFetch);
    });

    it("installs replacement when Response constructor is unavailable", async () => {
      const originalFetch = globalThis.fetch;
      delete (globalThis as any).Response;
      await install();
      expect(globalThis.fetch).not.toBe(originalFetch);
    });

    it("installs replacement when Response.body is null", async () => {
      const originalFetch = globalThis.fetch;
      await install();
      expect(globalThis.fetch).not.toBe(originalFetch);
    });

    it("installs replacement when Response.body.getReader is not a function", async () => {
      const originalFetch = globalThis.fetch;
      (globalThis as any).Response = class {
        body = {};
      };
      await install();
      expect(globalThis.fetch).not.toBe(originalFetch);
    });
  });

  // ── Basic request lifecycle ───────────────────────────────────────────────

  describe("basic request lifecycle", () => {
    it("opens XHR with correct method and URL for string input", async () => {
      const { xhr } = await fetchAndCapture("https://api.test/data", {
        method: "POST",
      });
      expect(xhr.open).toHaveBeenCalledWith("POST", "https://api.test/data");
    });

    it("opens XHR with correct URL for URL input", async () => {
      const { xhr } = await fetchAndCapture(new URL("https://api.test/path"));
      expect(xhr.open).toHaveBeenCalledWith("GET", "https://api.test/path");
    });

    it("defaults to GET when no method specified", async () => {
      const { xhr } = await fetchAndCapture("https://api.test");
      expect(xhr.open).toHaveBeenCalledWith("GET", "https://api.test");
    });

    it("sets request headers from plain object", async () => {
      const { xhr } = await fetchAndCapture("https://api.test", {
        headers: { "Content-Type": "application/json", "X-Custom": "val" },
      });
      expect(xhr.setRequestHeader).toHaveBeenCalledWith(
        "Content-Type",
        "application/json",
      );
      expect(xhr.setRequestHeader).toHaveBeenCalledWith("X-Custom", "val");
    });

    it("sets request headers from Headers instance", async () => {
      const headers = new Headers({ Authorization: "Bearer tok" });
      const { xhr } = await fetchAndCapture("https://api.test", { headers });
      expect(xhr.setRequestHeader).toHaveBeenCalledWith(
        "authorization",
        "Bearer tok",
      );
    });

    it("sets request headers from array of tuples", async () => {
      const { xhr } = await fetchAndCapture("https://api.test", {
        headers: [["X-Key", "val"]],
      });
      expect(xhr.setRequestHeader).toHaveBeenCalledWith("X-Key", "val");
    });

    it("sends the request body", async () => {
      const { xhr } = await fetchAndCapture("https://api.test", {
        method: "POST",
        body: '{"key":"value"}',
      });
      expect(xhr.send).toHaveBeenCalledWith('{"key":"value"}');
    });

    it("sets XHR timeout to 60 seconds", async () => {
      const { xhr } = await fetchAndCapture();
      expect(xhr.timeout).toBe(60_000);
    });
  });

  // ── Response resolution ───────────────────────────────────────────────────

  describe("response resolution", () => {
    it("resolves when headers arrive with non-zero status", async () => {
      const { fetchPromise, xhr } = await fetchAndCapture();
      simulateHeaders(xhr, 200);
      const resp = await fetchPromise;
      expect(resp.status).toBe(200);
    });

    it("exposes correct status, statusText, url, and ok", async () => {
      const { fetchPromise, xhr } = await fetchAndCapture(
        "https://api.test/not-found",
      );
      simulateHeaders(xhr, 404, "", "Not Found");
      const resp = await fetchPromise;
      expect(resp.ok).toBe(false);
      expect(resp.status).toBe(404);
      expect(resp.statusText).toBe("Not Found");
      expect(resp.url).toBe("https://api.test/not-found");
    });

    it("parses response headers into a Headers object", async () => {
      const { fetchPromise, xhr } = await fetchAndCapture();
      simulateHeaders(
        xhr,
        200,
        "content-type: application/json\r\nx-request-id: abc123\r\n",
      );
      const resp = await fetchPromise;
      expect(resp.headers.get("content-type")).toBe("application/json");
      expect(resp.headers.get("x-request-id")).toBe("abc123");
    });

    it("provides a ReadableStream body on the response", async () => {
      const { fetchPromise, xhr } = await fetchAndCapture();
      simulateHeaders(xhr, 200);
      const resp = await fetchPromise;
      expect(resp.body).toBeInstanceOf(ReadableStream);
    });
  });

  // ── Streaming chunks ──────────────────────────────────────────────────────

  describe("streaming chunks", () => {
    it("delivers chunks incrementally as XHR fires onprogress", async () => {
      const { fetchPromise, xhr } = await fetchAndCapture();
      simulateHeaders(xhr, 200);
      const resp = await fetchPromise;
      const reader = resp.body!.getReader();

      simulateProgress(xhr, "chunk1");
      const { value: c1 } = await reader.read();
      expect(new TextDecoder().decode(c1)).toBe("chunk1");

      simulateProgress(xhr, "chunk1chunk2");
      const { value: c2 } = await reader.read();
      expect(new TextDecoder().decode(c2)).toBe("chunk2");
    });

    it("closes stream on onload after delivering final chunks", async () => {
      const { fetchPromise, xhr } = await fetchAndCapture();
      simulateHeaders(xhr, 200);
      const resp = await fetchPromise;
      const reader = resp.body!.getReader();

      xhr.responseText = "all data";
      simulateLoad(xhr);

      const { value, done } = await reader.read();
      expect(new TextDecoder().decode(value)).toBe("all data");
      const final = await reader.read();
      expect(final.done).toBe(true);
    });

    it("encodes chunks as Uint8Array", async () => {
      const { fetchPromise, xhr } = await fetchAndCapture();
      simulateHeaders(xhr, 200);
      const resp = await fetchPromise;
      const reader = resp.body!.getReader();

      simulateProgress(xhr, "hello");
      const { value } = await reader.read();
      // Cross-realm safe check (jsdom TextEncoder may produce a different Uint8Array)
      expect(ArrayBuffer.isView(value)).toBe(true);
      expect(value!.constructor.name).toBe("Uint8Array");
    });
  });

  // ── Convenience methods ───────────────────────────────────────────────────

  describe("convenience methods", () => {
    it("text() returns full response text after XHR completes", async () => {
      const { fetchPromise, xhr } = await fetchAndCapture();
      simulateHeaders(xhr, 200);
      const resp = await fetchPromise;

      xhr.responseText = "hello world";
      simulateLoad(xhr);

      expect(await resp.text()).toBe("hello world");
    });

    it("json() parses full response text as JSON", async () => {
      const { fetchPromise, xhr } = await fetchAndCapture();
      simulateHeaders(xhr, 200);
      const resp = await fetchPromise;

      xhr.responseText = '{"key":"value"}';
      simulateLoad(xhr);

      expect(await resp.json()).toEqual({ key: "value" });
    });

    it("json() throws TypeError with descriptive message on invalid JSON", async () => {
      const { fetchPromise, xhr } = await fetchAndCapture(
        "https://api.test/bad",
        { method: "POST" },
      );
      simulateHeaders(xhr, 200);
      const resp = await fetchPromise;

      xhr.responseText = "not json";
      simulateLoad(xhr);

      await expect(resp.json()).rejects.toThrow(TypeError);
      await expect(resp.json()).rejects.toThrow(/api\.test\/bad/);
    });

    it("clone() always throws", async () => {
      const { fetchPromise, xhr } = await fetchAndCapture();
      simulateHeaders(xhr, 200);
      const resp = await fetchPromise;
      expect(() => resp.clone()).toThrow(/not supported/);
    });

    it("formData() always throws", async () => {
      const { fetchPromise, xhr } = await fetchAndCapture();
      simulateHeaders(xhr, 200);
      const resp = await fetchPromise;
      await expect(resp.formData()).rejects.toThrow(/not supported/);
    });

    it("marks bodyUsed after calling text()", async () => {
      const { fetchPromise, xhr } = await fetchAndCapture();
      simulateHeaders(xhr, 200);
      const resp = await fetchPromise;
      expect(resp.bodyUsed).toBe(false);

      xhr.responseText = "data";
      simulateLoad(xhr);
      await resp.text();

      expect(resp.bodyUsed).toBe(true);
    });
  });

  // ── Abort handling ────────────────────────────────────────────────────────

  describe("abort handling", () => {
    it("rejects immediately when signal is already aborted", async () => {
      await install();
      const controller = new AbortController();
      controller.abort();

      await expect(
        globalThis.fetch("https://api.test", { signal: controller.signal }),
      ).rejects.toThrow(/aborted/i);
    });

    it("aborts XHR and rejects when signal fires before headers", async () => {
      const controller = new AbortController();
      const { fetchPromise, xhr } = await fetchAndCapture("https://api.test", {
        signal: controller.signal,
      });

      controller.abort();

      await expect(fetchPromise).rejects.toThrow(/aborted/i);
      expect(xhr.abort).toHaveBeenCalled();
    });

    it("aborts XHR mid-stream when signal fires after headers arrive", async () => {
      const controller = new AbortController();
      const { fetchPromise, xhr } = await fetchAndCapture("https://api.test", {
        signal: controller.signal,
      });

      simulateHeaders(xhr, 200);
      const resp = await fetchPromise;
      const reader = resp.body!.getReader();

      controller.abort();

      await expect(reader.read()).rejects.toThrow(/aborted/i);
      expect(xhr.abort).toHaveBeenCalled();
    });

    it("cancelling the ReadableStream aborts the XHR", async () => {
      const { fetchPromise, xhr } = await fetchAndCapture();
      simulateHeaders(xhr, 200);
      const resp = await fetchPromise;
      const reader = resp.body!.getReader();

      await reader.cancel();

      expect(xhr.abort).toHaveBeenCalled();
    });

    it("removes abort listener after terminal XHR event (onload)", async () => {
      const controller = new AbortController();
      const removeSpy = vi.spyOn(controller.signal, "removeEventListener");

      const { fetchPromise, xhr } = await fetchAndCapture("https://api.test", {
        signal: controller.signal,
      });
      simulateHeaders(xhr, 200);
      await fetchPromise;

      xhr.responseText = "done";
      simulateLoad(xhr);

      expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));
    });
  });

  // ── Error handling ────────────────────────────────────────────────────────

  describe("error handling", () => {
    it("rejects with TypeError on XHR onerror", async () => {
      const { fetchPromise, xhr } = await fetchAndCapture();
      simulateError(xhr);
      await expect(fetchPromise).rejects.toThrow("Network request failed");
    });

    it("rejects with TypeError on XHR ontimeout", async () => {
      const { fetchPromise, xhr } = await fetchAndCapture();
      simulateTimeout(xhr);
      await expect(fetchPromise).rejects.toThrow("Network request timed out");
    });

    it("rejects with descriptive error on readyState=4 with status=0 (CORS/DNS)", async () => {
      const { fetchPromise, xhr } = await fetchAndCapture();
      xhr.readyState = 4;
      xhr.status = 0;
      xhr.onreadystatechange?.();
      await expect(fetchPromise).rejects.toThrow(/CORS failure/);
    });

    it("errors stream and rejects text() when onerror fires after headers", async () => {
      const { fetchPromise, xhr } = await fetchAndCapture();
      simulateHeaders(xhr, 200);
      const resp = await fetchPromise;

      simulateError(xhr);

      await expect(resp.text()).rejects.toThrow("Network request failed");
    });

    it("does not double-reject (settled guard)", async () => {
      const { fetchPromise, xhr } = await fetchAndCapture();

      // First error settles the promise
      simulateError(xhr);
      await expect(fetchPromise).rejects.toThrow("Network request failed");

      // Second error should not throw unhandled rejection
      expect(() => simulateTimeout(xhr)).not.toThrow();
    });
  });

  // ── __originalFetch ───────────────────────────────────────────────────────

  describe("__originalFetch", () => {
    it("exposes original fetch on the replacement", async () => {
      const originalFetch = globalThis.fetch;
      await install();
      expect((globalThis.fetch as any).__originalFetch).toBe(originalFetch);
    });
  });
});
