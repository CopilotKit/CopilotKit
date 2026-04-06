/**
 * Streaming fetch implementation for React Native.
 *
 * React Native's built-in fetch doesn't support response.body.getReader()
 * (ReadableStream). This replaces global.fetch with an XHR-based
 * implementation that streams chunks via ReadableStream, enabling
 * CopilotKit's SSE-based agent communication.
 *
 * Call `installStreamingFetch()` once at app startup after polyfills.
 */

declare const global: typeof globalThis;

export function installStreamingFetch(): void {
  const TextEncoder = global.TextEncoder;

  global.fetch = function streamingFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const url = typeof input === "string" ? input : (input as Request).url;
    const method = init?.method || "GET";
    const headers = init?.headers || {};
    const body = init?.body as string | null | undefined;
    const signal = init?.signal;

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(method, url);

      const headerEntries =
        headers instanceof Headers
          ? Array.from(headers.entries())
          : Object.entries(headers);
      for (const [key, value] of headerEntries) {
        xhr.setRequestHeader(key, value as string);
      }

      xhr.responseType = "text";

      let streamController: ReadableStreamDefaultController<Uint8Array> | null =
        null;
      let lastIndex = 0;
      let done = false;
      const encoder = new TextEncoder();

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
        },
        cancel() {
          xhr.abort();
        },
      });

      // Promise that resolves when XHR completes with full text
      let resolveFullText: (text: string) => void;
      const fullTextPromise = new Promise<string>((r) => {
        resolveFullText = r;
      });

      if (signal) {
        signal.addEventListener("abort", () => {
          xhr.abort();
          reject(
            new (global as any).DOMException(
              "The operation was aborted.",
              "AbortError",
            ),
          );
        });
      }

      xhr.onprogress = function () {
        if (streamController && xhr.responseText.length > lastIndex) {
          const newData = xhr.responseText.slice(lastIndex);
          lastIndex = xhr.responseText.length;
          streamController.enqueue(encoder.encode(newData));
        }
      };

      xhr.onload = function () {
        if (streamController && xhr.responseText.length > lastIndex) {
          const newData = xhr.responseText.slice(lastIndex);
          streamController.enqueue(encoder.encode(newData));
        }
        if (streamController && !done) {
          done = true;
          streamController.close();
        }
        resolveFullText(xhr.responseText);
      };

      xhr.onerror = function () {
        if (streamController && !done) {
          done = true;
          streamController.error(new TypeError("Network request failed"));
        }
        reject(new TypeError("Network request failed"));
      };

      xhr.ontimeout = function () {
        if (streamController && !done) {
          done = true;
          streamController.error(new TypeError("Network request timed out"));
        }
        reject(new TypeError("Network request timed out"));
      };

      // Resolve with Response once headers arrive
      let resp: any = null;
      xhr.onreadystatechange = function () {
        if (xhr.readyState >= 2 && !resp) {
          const respHeaders: Record<string, string> = {};
          const rawHeaders = xhr.getAllResponseHeaders() || "";
          for (const line of rawHeaders.trim().split("\r\n")) {
            const idx = line.indexOf(": ");
            if (idx > 0) {
              respHeaders[line.slice(0, idx).toLowerCase()] = line.slice(
                idx + 2,
              );
            }
          }

          resp = {
            ok: xhr.status >= 200 && xhr.status < 300,
            status: xhr.status,
            statusText: xhr.statusText,
            headers: new Headers(respHeaders),
            body: stream,
            json: async () => JSON.parse(await fullTextPromise),
            text: async () => fullTextPromise,
            clone: () => resp,
            arrayBuffer: async () =>
              encoder.encode(await fullTextPromise).buffer,
          };
          resolve(resp);
        }
      };

      xhr.send((body as any) || null);
    });
  };
}
