import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createStreamingFetch,
  installStreamingFetch,
  platformFetchStreams,
  streamingFetchForPlatform,
} from "../streaming-fetch";

// ─── MockXHR ──────────────────────────────────────────────────────────────────

class MockXHR {
  open = vi.fn();
  // Enforces `timeout` over the whole request, as React Native's Android
  // networking (OkHttp's call timeout) does.
  send = vi.fn(() => {
    if (this.timeout > 0) {
      setTimeout(() => this.ontimeout?.(), this.timeout);
    }
  });
  abort = vi.fn();
  setRequestHeader = vi.fn();
  getAllResponseHeaders = vi.fn(() => "");

  readyState = 0;
  status = 0;
  statusText = "";
  responseText = "";
  responseType = "";
  timeout = 0;
  // React Native's XMLHttpRequest defaults this to true.
  withCredentials = true;

  onreadystatechange: (() => void) | null = null;
  onprogress: (() => void) | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
}

let mockXhr: MockXHR;

/**
 * Flush pending setTimeout(fn, 0) callbacks and microtasks.
 * The streaming-fetch polyfill defers all XHR callbacks via setTimeout(fn, 0)
 * to ensure they run on the JS thread in React Native. In tests we need to
 * flush these timers after each simulated XHR event.
 *
 * We flush multiple ticks to ensure all chained timers and microtasks settle.
 */
async function flushTimers() {
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

async function simulateHeaders(
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
  await flushTimers();
}

async function simulateProgress(xhr: MockXHR, text: string) {
  xhr.responseText = text;
  xhr.onprogress?.();
  await flushTimers();
}

async function simulateLoad(xhr: MockXHR) {
  xhr.readyState = 4;
  xhr.onload?.();
  await flushTimers();
}

async function simulateError(xhr: MockXHR) {
  xhr.onerror?.();
  await flushTimers();
}

async function simulateTimeout(xhr: MockXHR) {
  xhr.ontimeout?.();
  await flushTimers();
}

// ─── Platform environments ────────────────────────────────────────────────────

/** React Native's `Response` (whatwg-fetch): no streaming `body`. */
class NonStreamingResponse {
  body = null;
}

/** A `Response` whose body streams, as in browsers and Node. */
class StreamingResponse {
  body = { getReader: () => ({}) };
}

/** React Native's own fetch: whatwg-fetch, which marks itself `polyfill`. */
function reactNativeFetch(): typeof fetch {
  const rnFetch = vi.fn() as unknown as typeof fetch & { polyfill?: boolean };
  rnFetch.polyfill = true;
  return rnFetch;
}

/** `expo/fetch`: a plain function, installed over React Native's fetch. */
function expoFetch(): typeof fetch {
  return vi.fn() as unknown as typeof fetch;
}

type PlatformGlobals = {
  fetch?: typeof fetch;
  Response?: unknown;
  expo?: unknown;
};

function setPlatform(platform: PlatformGlobals) {
  const g = globalThis as unknown as Record<string, unknown>;
  for (const key of ["fetch", "Response", "expo"] as const) {
    if (key in platform) g[key] = platform[key];
    else delete g[key];
  }
}

const bareReactNative = (): PlatformGlobals => ({
  fetch: reactNativeFetch(),
  Response: NonStreamingResponse,
});

const expo = (): PlatformGlobals => ({
  fetch: expoFetch(),
  Response: NonStreamingResponse,
  expo: { modules: {} },
});

// ─── Globals save/restore ─────────────────────────────────────────────────────

let savedFetch: typeof globalThis.fetch;
let savedXHR: typeof globalThis.XMLHttpRequest;
let savedResponse: typeof globalThis.Response;
let savedExpo: unknown;
let hadExpo: boolean;

beforeEach(() => {
  savedFetch = globalThis.fetch;
  savedXHR = globalThis.XMLHttpRequest;
  savedResponse = globalThis.Response;
  hadExpo = "expo" in globalThis;
  savedExpo = (globalThis as { expo?: unknown }).expo;

  mockXhr = new MockXHR();
  // Must use a regular function (not arrow) so it can be called with `new`
  (globalThis as any).XMLHttpRequest = vi.fn(function () {
    return mockXhr;
  });
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.fetch = savedFetch;
  (globalThis as any).XMLHttpRequest = savedXHR;
  (globalThis as any).Response = savedResponse;
  if (hadExpo) (globalThis as any).expo = savedExpo;
  else delete (globalThis as any).expo;
});

// Helper: make a fetch call and capture the mockXhr for lifecycle simulation
function fetchAndCapture(
  input: RequestInfo | URL = "https://api.test/stream",
  init?: RequestInit,
  options?: Parameters<typeof createStreamingFetch>[0],
) {
  const streamingFetch = createStreamingFetch(options);
  const fetchPromise = streamingFetch(input, init);
  return { fetchPromise, xhr: mockXhr };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("platformFetchStreams", () => {
  it("is false for React Native's own fetch, which buffers the whole body", () => {
    setPlatform(bareReactNative());
    expect(platformFetchStreams()).toBe(false);
  });

  it("is true on Expo, whose fetch streams although the global Response does not", () => {
    setPlatform(expo());
    expect(platformFetchStreams()).toBe(true);
  });

  it("is false on Expo opted back into React Native's fetch (EXPO_PUBLIC_USE_RN_FETCH)", () => {
    setPlatform({ ...expo(), fetch: reactNativeFetch() });
    expect(platformFetchStreams()).toBe(false);
  });

  it("is true where the global Response streams (browsers, Node, react-native-web)", () => {
    setPlatform({ fetch: expoFetch(), Response: StreamingResponse });
    expect(platformFetchStreams()).toBe(true);
  });

  it("is false for an unidentified fetch on a runtime whose Response cannot stream", () => {
    // e.g. a monitoring wrapper around React Native's fetch, which hides the
    // `polyfill` flag. Falling back to the XHR transport keeps chat working.
    setPlatform({ fetch: expoFetch(), Response: NonStreamingResponse });
    expect(platformFetchStreams()).toBe(false);
  });

  it("is false when there is no global fetch", () => {
    setPlatform({ Response: StreamingResponse });
    expect(platformFetchStreams()).toBe(false);
  });

  it("is true for CopilotKit's own streaming fetch installed as the global", () => {
    setPlatform({
      fetch: createStreamingFetch(),
      Response: NonStreamingResponse,
    });
    expect(platformFetchStreams()).toBe(true);
  });
});

describe("streamingFetchForPlatform", () => {
  it("returns a streaming fetch on bare React Native, without touching the global fetch", () => {
    const platform = bareReactNative();
    setPlatform(platform);

    const scoped = streamingFetchForPlatform();

    expect(typeof scoped).toBe("function");
    expect(scoped).not.toBe(platform.fetch);
    expect(globalThis.fetch).toBe(platform.fetch);
  });

  it("returns nothing on Expo, so Core keeps using Expo's fetch", () => {
    const platform = expo();
    setPlatform(platform);

    expect(streamingFetchForPlatform()).toBeUndefined();
    expect(globalThis.fetch).toBe(platform.fetch);
  });

  it("returns nothing where the platform fetch already streams", () => {
    setPlatform({ fetch: expoFetch(), Response: StreamingResponse });
    expect(streamingFetchForPlatform()).toBeUndefined();
  });
});

describe("installStreamingFetch (opt-in global replacement)", () => {
  it("replaces React Native's fetch and keeps the original on __originalFetch", () => {
    const platform = bareReactNative();
    setPlatform(platform);

    installStreamingFetch();

    expect(globalThis.fetch).not.toBe(platform.fetch);
    expect((globalThis.fetch as any).__originalFetch).toBe(platform.fetch);
  });

  it("leaves Expo's streaming fetch in place", () => {
    const platform = expo();
    setPlatform(platform);

    installStreamingFetch();

    expect(globalThis.fetch).toBe(platform.fetch);
  });

  it("leaves a fetch that streams in place", () => {
    const platform = { fetch: expoFetch(), Response: StreamingResponse };
    setPlatform(platform);

    installStreamingFetch();

    expect(globalThis.fetch).toBe(platform.fetch);
  });

  it("is idempotent", () => {
    setPlatform(bareReactNative());

    installStreamingFetch();
    const installed = globalThis.fetch;
    installStreamingFetch();

    expect(globalThis.fetch).toBe(installed);
  });
});

describe("createStreamingFetch", () => {
  it("does not touch the global fetch", () => {
    const platform = bareReactNative();
    setPlatform(platform);

    createStreamingFetch();

    expect(globalThis.fetch).toBe(platform.fetch);
  });

  it("rejects an invalid idle timeout", () => {
    expect(() => createStreamingFetch({ idleTimeoutMs: -1 })).toThrow(
      RangeError,
    );
    expect(() =>
      createStreamingFetch({ idleTimeoutMs: Number.POSITIVE_INFINITY }),
    ).toThrow(RangeError);
  });

  // ── Basic request lifecycle ───────────────────────────────────────────────

  describe("basic request lifecycle", () => {
    it("opens XHR with correct method and URL for string input", () => {
      const { xhr } = fetchAndCapture("https://api.test/data", {
        method: "POST",
      });
      expect(xhr.open).toHaveBeenCalledWith("POST", "https://api.test/data");
    });

    it("opens XHR with correct URL for URL input", () => {
      const { xhr } = fetchAndCapture(new URL("https://api.test/path"));
      expect(xhr.open).toHaveBeenCalledWith("GET", "https://api.test/path");
    });

    it("defaults to GET when no method specified", () => {
      const { xhr } = fetchAndCapture("https://api.test");
      expect(xhr.open).toHaveBeenCalledWith("GET", "https://api.test");
    });

    it("sets request headers from plain object", () => {
      const { xhr } = fetchAndCapture("https://api.test", {
        headers: { "Content-Type": "application/json", "X-Custom": "val" },
      });
      expect(xhr.setRequestHeader).toHaveBeenCalledWith(
        "Content-Type",
        "application/json",
      );
      expect(xhr.setRequestHeader).toHaveBeenCalledWith("X-Custom", "val");
    });

    it("sets request headers from Headers instance", () => {
      const headers = new Headers({ Authorization: "Bearer tok" });
      const { xhr } = fetchAndCapture("https://api.test", { headers });
      expect(xhr.setRequestHeader).toHaveBeenCalledWith(
        "authorization",
        "Bearer tok",
      );
    });

    it("sets request headers from array of tuples", () => {
      const { xhr } = fetchAndCapture("https://api.test", {
        headers: [["X-Key", "val"]],
      });
      expect(xhr.setRequestHeader).toHaveBeenCalledWith("X-Key", "val");
    });

    it("sends the request body", () => {
      const { xhr } = fetchAndCapture("https://api.test", {
        method: "POST",
        body: '{"key":"value"}',
      });
      expect(xhr.send).toHaveBeenCalledWith('{"key":"value"}');
    });
  });

  // ── Credentials ───────────────────────────────────────────────────────────

  describe("credentials", () => {
    it('sends no cookies for credentials: "omit"', () => {
      const { xhr } = fetchAndCapture("https://api.test", {
        credentials: "omit",
      });
      expect(xhr.withCredentials).toBe(false);
    });

    it('sends cookies for credentials: "include"', () => {
      mockXhr.withCredentials = false;
      const { xhr } = fetchAndCapture("https://api.test", {
        credentials: "include",
      });
      expect(xhr.withCredentials).toBe(true);
    });

    it('keeps the platform default for "same-origin" and when unset, as React Native\'s fetch does', () => {
      const sameOrigin = fetchAndCapture("https://api.test", {
        credentials: "same-origin",
      });
      expect(sameOrigin.xhr.withCredentials).toBe(true);

      mockXhr = new MockXHR();
      const unset = fetchAndCapture("https://api.test");
      expect(unset.xhr.withCredentials).toBe(true);
    });

    it("reads credentials from a Request input", () => {
      const { xhr } = fetchAndCapture(
        new Request("https://api.test", { credentials: "omit" }),
      );
      expect(xhr.withCredentials).toBe(false);
    });
  });

  // ── Timeouts ──────────────────────────────────────────────────────────────

  describe("timeouts", () => {
    it("puts no whole-request cap on the XHR, which Android enforces as a call timeout", () => {
      const { xhr } = fetchAndCapture();
      expect(xhr.timeout).toBe(0);
    });

    it("keeps a stream that is still delivering data open past 60 seconds", async () => {
      vi.useFakeTimers();
      const { fetchPromise, xhr } = fetchAndCapture();
      xhr.readyState = 2;
      xhr.status = 200;
      xhr.getAllResponseHeaders.mockReturnValue(
        "content-type: text/event-stream\r\n",
      );
      xhr.onreadystatechange?.();
      await vi.advanceTimersByTimeAsync(1);
      const resp = await fetchPromise;
      const reader = resp.body!.getReader();

      // Five minutes of a run that emits a keep-alive every 15 seconds.
      let sent = "";
      for (let second = 15; second <= 300; second += 15) {
        sent += ": keep-alive\n\n";
        xhr.responseText = sent;
        xhr.onprogress?.();
        await vi.advanceTimersByTimeAsync(15_000);
      }
      xhr.responseText = sent + "data: done\n\n";
      xhr.readyState = 4;
      xhr.onload?.();
      await vi.advanceTimersByTimeAsync(1);

      let received = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        received += new TextDecoder().decode(value);
      }
      expect(received).toBe(sent + "data: done\n\n");
      expect(xhr.abort).not.toHaveBeenCalled();
    });

    it("fails a stream that goes silent for the idle timeout and aborts the XHR", async () => {
      vi.useFakeTimers();
      const { fetchPromise, xhr } = fetchAndCapture();
      xhr.readyState = 2;
      xhr.status = 200;
      xhr.onreadystatechange?.();
      await vi.advanceTimersByTimeAsync(1);
      const resp = await fetchPromise;
      const reader = resp.body!.getReader();
      const read = reader.read();
      const failure = expect(read).rejects.toThrow("Network request timed out");

      await vi.advanceTimersByTimeAsync(59_000);
      expect(xhr.abort).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2_000);

      await failure;
      expect(xhr.abort).toHaveBeenCalled();
    });

    it("fails a request whose headers never arrive within the idle timeout", async () => {
      vi.useFakeTimers();
      const { fetchPromise } = fetchAndCapture(undefined, undefined, {
        idleTimeoutMs: 5_000,
      });
      const failure = expect(fetchPromise).rejects.toThrow(
        "Network request timed out",
      );

      await vi.advanceTimersByTimeAsync(5_001);

      await failure;
    });

    it("never times out when the idle timeout is 0", async () => {
      vi.useFakeTimers();
      const { fetchPromise, xhr } = fetchAndCapture(undefined, undefined, {
        idleTimeoutMs: 0,
      });

      await vi.advanceTimersByTimeAsync(60 * 60_000);
      xhr.readyState = 2;
      xhr.status = 200;
      xhr.onreadystatechange?.();
      await vi.advanceTimersByTimeAsync(1);

      expect((await fetchPromise).status).toBe(200);
      expect(xhr.abort).not.toHaveBeenCalled();
    });

    it("does not fire after the response completes", async () => {
      vi.useFakeTimers();
      const { fetchPromise, xhr } = fetchAndCapture();
      xhr.readyState = 2;
      xhr.status = 200;
      xhr.onreadystatechange?.();
      await vi.advanceTimersByTimeAsync(1);
      const resp = await fetchPromise;
      xhr.responseText = "all";
      xhr.readyState = 4;
      xhr.onload?.();
      await vi.advanceTimersByTimeAsync(120_000);

      expect(await resp.text()).toBe("all");
      expect(xhr.abort).not.toHaveBeenCalled();
    });
  });

  // ── Response resolution ───────────────────────────────────────────────────

  describe("response resolution", () => {
    it("resolves when headers arrive with non-zero status", async () => {
      const { fetchPromise, xhr } = fetchAndCapture();
      await simulateHeaders(xhr, 200);
      const resp = await fetchPromise;
      expect(resp.status).toBe(200);
    });

    it("exposes correct status, statusText, url, and ok", async () => {
      const { fetchPromise, xhr } = fetchAndCapture(
        "https://api.test/not-found",
      );
      await simulateHeaders(xhr, 404, "", "Not Found");
      const resp = await fetchPromise;
      expect(resp.ok).toBe(false);
      expect(resp.status).toBe(404);
      expect(resp.statusText).toBe("Not Found");
      expect(resp.url).toBe("https://api.test/not-found");
    });

    it("parses response headers into a Headers object", async () => {
      const { fetchPromise, xhr } = fetchAndCapture();
      await simulateHeaders(
        xhr,
        200,
        "content-type: application/json\r\nx-request-id: abc123\r\n",
      );
      const resp = await fetchPromise;
      expect(resp.headers.get("content-type")).toBe("application/json");
      expect(resp.headers.get("x-request-id")).toBe("abc123");
    });

    it("provides a ReadableStream body on the response", async () => {
      const { fetchPromise, xhr } = fetchAndCapture();
      await simulateHeaders(xhr, 200);
      const resp = await fetchPromise;
      expect(resp.body).toBeInstanceOf(ReadableStream);
    });
  });

  // ── Streaming chunks ──────────────────────────────────────────────────────

  describe("streaming chunks", () => {
    it("delivers chunks incrementally as XHR fires onprogress", async () => {
      const { fetchPromise, xhr } = fetchAndCapture();
      await simulateHeaders(xhr, 200);
      const resp = await fetchPromise;
      const reader = resp.body!.getReader();

      await simulateProgress(xhr, "chunk1");
      const { value: c1 } = await reader.read();
      expect(new TextDecoder().decode(c1)).toBe("chunk1");

      await simulateProgress(xhr, "chunk1chunk2");
      const { value: c2 } = await reader.read();
      expect(new TextDecoder().decode(c2)).toBe("chunk2");
    });

    it("closes stream on onload after delivering final chunks", async () => {
      const { fetchPromise, xhr } = fetchAndCapture();
      await simulateHeaders(xhr, 200);
      const resp = await fetchPromise;
      const reader = resp.body!.getReader();

      xhr.responseText = "all data";
      await simulateLoad(xhr);

      const { value } = await reader.read();
      expect(new TextDecoder().decode(value)).toBe("all data");
      const final = await reader.read();
      expect(final.done).toBe(true);
    });

    it("encodes chunks as Uint8Array", async () => {
      const { fetchPromise, xhr } = fetchAndCapture();
      await simulateHeaders(xhr, 200);
      const resp = await fetchPromise;
      const reader = resp.body!.getReader();

      await simulateProgress(xhr, "hello");
      const { value } = await reader.read();
      // Cross-realm safe check (jsdom TextEncoder may produce a different Uint8Array)
      expect(ArrayBuffer.isView(value)).toBe(true);
      expect(value!.constructor.name).toBe("Uint8Array");
    });
  });

  // ── Convenience methods ───────────────────────────────────────────────────

  describe("convenience methods", () => {
    it("text() returns full response text after XHR completes", async () => {
      const { fetchPromise, xhr } = fetchAndCapture();
      await simulateHeaders(xhr, 200);
      const resp = await fetchPromise;

      xhr.responseText = "hello world";
      await simulateLoad(xhr);

      expect(await resp.text()).toBe("hello world");
    });

    it("json() parses full response text as JSON", async () => {
      const { fetchPromise, xhr } = fetchAndCapture();
      await simulateHeaders(xhr, 200);
      const resp = await fetchPromise;

      xhr.responseText = '{"key":"value"}';
      await simulateLoad(xhr);

      expect(await resp.json()).toEqual({ key: "value" });
    });

    it("json() throws TypeError with descriptive message on invalid JSON", async () => {
      const { fetchPromise, xhr } = fetchAndCapture("https://api.test/bad", {
        method: "POST",
      });
      await simulateHeaders(xhr, 200);
      const resp = await fetchPromise;

      xhr.responseText = "not json";
      await simulateLoad(xhr);

      await expect(resp.json()).rejects.toThrow(TypeError);
      await expect(resp.json()).rejects.toThrow(/api\.test\/bad/);
    });

    it("formData() always throws", async () => {
      const { fetchPromise, xhr } = fetchAndCapture();
      await simulateHeaders(xhr, 200);
      const resp = await fetchPromise;
      await expect(resp.formData()).rejects.toThrow(/not supported/);
    });

    it("marks bodyUsed after calling text()", async () => {
      const { fetchPromise, xhr } = fetchAndCapture();
      await simulateHeaders(xhr, 200);
      const resp = await fetchPromise;
      expect(resp.bodyUsed).toBe(false);

      xhr.responseText = "data";
      await simulateLoad(xhr);
      await resp.text();

      expect(resp.bodyUsed).toBe(true);
    });
  });

  // ── clone() ───────────────────────────────────────────────────────────────

  describe("clone()", () => {
    it("lets a clone read the body as JSON while the original stays unread", async () => {
      // Core reads a failed /info's error message through
      // `response.clone().json()`.
      const { fetchPromise, xhr } = fetchAndCapture();
      await simulateHeaders(
        xhr,
        404,
        "content-type: application/json\r\n",
        "Not Found",
      );
      const resp = await fetchPromise;

      const copy = resp.clone();
      xhr.responseText = '{"message":"Wrong transport"}';
      await simulateLoad(xhr);

      expect(await copy.json()).toEqual({ message: "Wrong transport" });
      expect(copy.status).toBe(404);
      expect(copy.statusText).toBe("Not Found");
      expect(copy.headers.get("content-type")).toBe("application/json");
      expect(resp.bodyUsed).toBe(false);
      expect(await resp.text()).toBe('{"message":"Wrong transport"}');
    });

    it("gives the clone its own stream with every chunk, including those that arrived before it", async () => {
      const { fetchPromise, xhr } = fetchAndCapture();
      await simulateHeaders(xhr, 200);
      const resp = await fetchPromise;
      await simulateProgress(xhr, "one,");

      const copy = resp.clone();
      await simulateProgress(xhr, "one,two");
      xhr.responseText = "one,two,three";
      await simulateLoad(xhr);

      const readAll = async (response: Response) => {
        const reader = response.body!.getReader();
        let text = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return text;
          text += new TextDecoder().decode(value);
        }
      };
      expect(await readAll(copy)).toBe("one,two,three");
      expect(await readAll(resp)).toBe("one,two,three");
    });

    it("keeps the request alive while a clone is still reading after the original is cancelled", async () => {
      const { fetchPromise, xhr } = fetchAndCapture();
      await simulateHeaders(xhr, 200);
      const resp = await fetchPromise;
      const copy = resp.clone();

      await resp.body!.cancel();
      expect(xhr.abort).not.toHaveBeenCalled();
      await copy.body!.cancel();
      expect(xhr.abort).toHaveBeenCalled();
    });

    it("throws once the body has been used", async () => {
      const { fetchPromise, xhr } = fetchAndCapture();
      await simulateHeaders(xhr, 200);
      const resp = await fetchPromise;
      xhr.responseText = "data";
      await simulateLoad(xhr);
      await resp.text();

      expect(() => resp.clone()).toThrow(TypeError);
    });

    it("throws once the body stream is locked to a reader", async () => {
      const { fetchPromise, xhr } = fetchAndCapture();
      await simulateHeaders(xhr, 200);
      const resp = await fetchPromise;
      resp.body!.getReader();

      expect(() => resp.clone()).toThrow(TypeError);
    });
  });

  // ── Abort handling ────────────────────────────────────────────────────────

  describe("abort handling", () => {
    it("rejects immediately when signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        createStreamingFetch()("https://api.test", {
          signal: controller.signal,
        }),
      ).rejects.toThrow(/aborted/i);
    });

    it("aborts XHR and rejects when signal fires before headers", async () => {
      const controller = new AbortController();
      const { fetchPromise, xhr } = fetchAndCapture("https://api.test", {
        signal: controller.signal,
      });

      controller.abort();

      await expect(fetchPromise).rejects.toThrow(/aborted/i);
      expect(xhr.abort).toHaveBeenCalled();
    });

    it("aborts XHR mid-stream when signal fires after headers arrive", async () => {
      const controller = new AbortController();
      const { fetchPromise, xhr } = fetchAndCapture("https://api.test", {
        signal: controller.signal,
      });

      await simulateHeaders(xhr, 200);
      const resp = await fetchPromise;
      const reader = resp.body!.getReader();

      controller.abort();

      await expect(reader.read()).rejects.toThrow(/aborted/i);
      expect(xhr.abort).toHaveBeenCalled();
    });

    it("cancelling the ReadableStream aborts the XHR", async () => {
      const { fetchPromise, xhr } = fetchAndCapture();
      await simulateHeaders(xhr, 200);
      const resp = await fetchPromise;
      const reader = resp.body!.getReader();

      await reader.cancel();

      expect(xhr.abort).toHaveBeenCalled();
    });

    it("removes abort listener after terminal XHR event (onload)", async () => {
      const controller = new AbortController();
      const removeSpy = vi.spyOn(controller.signal, "removeEventListener");

      const { fetchPromise, xhr } = fetchAndCapture("https://api.test", {
        signal: controller.signal,
      });
      await simulateHeaders(xhr, 200);
      await fetchPromise;

      xhr.responseText = "done";
      await simulateLoad(xhr);

      expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));
    });
  });

  // ── Error handling ────────────────────────────────────────────────────────

  describe("error handling", () => {
    it("rejects with TypeError on XHR onerror", async () => {
      const { fetchPromise, xhr } = fetchAndCapture();
      // Attach rejection handler BEFORE triggering error to avoid
      // Node's unhandled rejection warning (setTimeout defers the rejection)
      const rejection = expect(fetchPromise).rejects.toThrow(
        "Network request failed",
      );
      await simulateError(xhr);
      await rejection;
    });

    it("rejects with TypeError on XHR ontimeout", async () => {
      const { fetchPromise, xhr } = fetchAndCapture();
      const rejection = expect(fetchPromise).rejects.toThrow(
        "Network request timed out",
      );
      await simulateTimeout(xhr);
      await rejection;
    });

    it("rejects with descriptive error on readyState=4 with status=0 (CORS/DNS)", async () => {
      const { fetchPromise, xhr } = fetchAndCapture();
      const rejection = expect(fetchPromise).rejects.toThrow(/CORS failure/);
      xhr.readyState = 4;
      xhr.status = 0;
      xhr.onreadystatechange?.();
      await flushTimers();
      await rejection;
    });

    it("errors stream and rejects text() when onerror fires after headers", async () => {
      const { fetchPromise, xhr } = fetchAndCapture();
      await simulateHeaders(xhr, 200);
      const resp = await fetchPromise;

      // text() rejection handler must be attached before triggering error
      const textRejection = expect(resp.text()).rejects.toThrow(
        "Network request failed",
      );
      await simulateError(xhr);
      await textRejection;
    });

    it("does not double-reject (settled guard)", async () => {
      const { fetchPromise, xhr } = fetchAndCapture();

      // Attach rejection handler before triggering error
      const rejection = expect(fetchPromise).rejects.toThrow(
        "Network request failed",
      );
      await simulateError(xhr);
      await rejection;

      // Second error should not throw unhandled rejection
      await simulateTimeout(xhr);
    });
  });
});
