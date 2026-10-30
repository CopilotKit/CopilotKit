import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("streaming fetch capability detection", () => {
  it("preserves a streaming fetch when the global Response has no body", async () => {
    const nativeFetch = vi.fn(async () => ({
      body: new ReadableStream({ start: (controller) => controller.close() }),
    }));
    vi.stubGlobal("fetch", nativeFetch);
    vi.stubGlobal(
      "Response",
      class {
        body = null;
      },
    );

    const { installStreamingFetch } = await import("../streaming-fetch");
    await installStreamingFetch();
    expect(globalThis.fetch).toBe(nativeFetch);
  });

  it("does not mistake a streaming Response constructor for a streaming fetch", async () => {
    const bufferedFetch = vi.fn(async () => ({ body: null }));
    vi.stubGlobal("fetch", bufferedFetch);
    vi.stubGlobal(
      "Response",
      class {
        body = new ReadableStream({
          start: (controller) => controller.close(),
        });
      },
    );

    const { installStreamingFetch } = await import("../streaming-fetch");
    await installStreamingFetch();
    expect(globalThis.fetch).not.toBe(bufferedFetch);
  });

  it("preserves fetch when the global Response constructor is missing", async () => {
    const nativeFetch = vi.fn(async () => streamingResponse());
    vi.stubGlobal("fetch", nativeFetch);
    vi.stubGlobal("Response", undefined);

    const { installStreamingFetch } = await import("../streaming-fetch");
    await installStreamingFetch();
    expect(globalThis.fetch).toBe(nativeFetch);
  });

  it("preserves a streaming fetch that rejects data URLs but supports local files", async () => {
    const nativeFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("Unsupported URL scheme: data"))
      .mockResolvedValueOnce({ ...streamingResponse(), status: 404 });
    vi.stubGlobal("fetch", nativeFetch);
    vi.stubGlobal(
      "Response",
      class {
        body = null;
      },
    );

    const { installStreamingFetch } = await import("../streaming-fetch");
    await installStreamingFetch();
    expect(globalThis.fetch).toBe(nativeFetch);
    expect(nativeFetch.mock.calls.map(([url]) => url)).toEqual([
      "data:text/plain,copilotkit",
      "file:///__copilotkit_streaming_fetch_probe__",
    ]);
  });

  it.each(["rejects", "throws"])(
    "falls back when the local probe %s",
    async (failure) => {
      const originalFetch = vi.fn(() => {
        if (failure === "throws") throw new Error("unsupported data URL");
        return Promise.reject(new Error("unsupported data URL"));
      });
      vi.stubGlobal("fetch", originalFetch);

      const { installStreamingFetch } = await import("../streaming-fetch");
      await installStreamingFetch();
      expect(globalThis.fetch).not.toBe(originalFetch);
      expect((globalThis.fetch as any).__originalFetch).toBe(originalFetch);
    },
  );

  it("bounds a stalled probe and ignores its late response", async () => {
    vi.useFakeTimers();
    const probe = deferred<Response>();
    const originalFetch = vi.fn(
      (_input: RequestInfo | URL, _init?: RequestInit) => probe.promise,
    );
    vi.stubGlobal("fetch", originalFetch);

    const { installStreamingFetch } = await import("../streaming-fetch");
    const ready = installStreamingFetch();
    let finished = false;
    void ready.then(() => {
      finished = true;
    });
    await vi.advanceTimersByTimeAsync(1_999);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await ready;

    const fallback = globalThis.fetch;
    expect(fallback).not.toBe(originalFetch);
    expect(originalFetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
    probe.resolve(streamingResponse());
    await vi.advanceTimersByTimeAsync(0);
    expect(globalThis.fetch).toBe(fallback);
  });

  it("queues early requests and sends each once through the original fetch", async () => {
    const probe = deferred<Response>();
    const response = streamingResponse();
    const originalFetch = vi.fn(
      (input: RequestInfo | URL, _init?: RequestInit) =>
        typeof input === "string" && input.startsWith("data:")
          ? probe.promise
          : Promise.resolve(response),
    );
    vi.stubGlobal("fetch", originalFetch);
    vi.stubGlobal(
      "Response",
      class {
        body = null;
      },
    );

    const { installStreamingFetch } = await import("../streaming-fetch");
    const ready = installStreamingFetch();
    const request = new Request("https://api.test/action", { method: "POST" });
    const init = {
      headers: { "X-Test": "preserved" },
      body: "one side effect",
    };
    const first = globalThis.fetch(request, init);
    const second = globalThis.fetch("https://api.test/other");
    await Promise.resolve();
    expect(originalFetch).toHaveBeenCalledTimes(1);
    expect(originalFetch.mock.calls[0][0]).toMatch(/^data:text\/plain,/);

    probe.resolve(streamingResponse());
    expect(await first).toBe(response);
    expect(await second).toBe(response);
    await ready;
    expect(originalFetch).toHaveBeenCalledTimes(3);
    expect(originalFetch.mock.calls[1]).toEqual([request, init]);
    expect(originalFetch.mock.calls[2]).toEqual([
      "https://api.test/other",
      undefined,
    ]);
    expect(originalFetch.mock.contexts).toEqual([
      globalThis,
      globalThis,
      globalThis,
    ]);
    expect(globalThis.fetch).toBe(originalFetch);
  });

  it("queues early requests for the XHR fallback without replaying them", async () => {
    const probe = deferred<Response>();
    const originalFetch = vi.fn(() => probe.promise);
    const xhr = {
      open: vi.fn(),
      send: vi.fn(),
      abort: vi.fn(),
      setRequestHeader: vi.fn(),
      getAllResponseHeaders: () => "",
      readyState: 0,
      status: 0,
      statusText: "",
      responseText: "",
      onreadystatechange: null as (() => void) | null,
      onload: null as (() => void) | null,
    };
    vi.stubGlobal("fetch", originalFetch);
    vi.stubGlobal(
      "XMLHttpRequest",
      vi.fn(function () {
        return xhr;
      }),
    );

    const { installStreamingFetch } = await import("../streaming-fetch");
    const ready = installStreamingFetch();
    const request = globalThis.fetch("https://api.test/action", {
      method: "POST",
      body: "once",
    });
    expect(xhr.send).not.toHaveBeenCalled();
    probe.resolve({ body: null } as Response);
    await ready;
    await Promise.resolve();
    expect(xhr.open).toHaveBeenCalledWith("POST", "https://api.test/action");
    expect(xhr.send).toHaveBeenCalledExactlyOnceWith("once");
    expect(originalFetch).toHaveBeenCalledTimes(1);

    xhr.readyState = 2;
    xhr.status = 200;
    xhr.onreadystatechange?.();
    xhr.onload?.();
    expect((await request).status).toBe(200);
  });

  it("shares detection across repeated installation calls", async () => {
    const probe = deferred<Response>();
    const originalFetch = vi.fn(() => probe.promise);
    vi.stubGlobal("fetch", originalFetch);

    const { installStreamingFetch } = await import("../streaming-fetch");
    const ready = installStreamingFetch();
    expect(installStreamingFetch()).toBe(ready);
    probe.resolve(streamingResponse());
    await ready;
    expect(installStreamingFetch()).toBe(ready);
    expect(originalFetch).toHaveBeenCalledTimes(1);
  });

  it("does not overwrite an application replacement installed during detection", async () => {
    const probe = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => probe.promise),
    );

    const { installStreamingFetch } = await import("../streaming-fetch");
    const ready = installStreamingFetch();
    const replacement = vi.fn();
    globalThis.fetch = replacement;
    probe.resolve(streamingResponse());
    await ready;
    expect(globalThis.fetch).toBe(replacement);
  });
});

function streamingResponse(): Response {
  return {
    body: new ReadableStream({ start: (controller) => controller.close() }),
  } as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}
