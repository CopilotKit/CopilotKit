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
      // Issue 4: Reject immediately if signal is already aborted
      if (signal?.aborted) {
        reject(
          new (global as any).DOMException(
            "The operation was aborted.",
            "AbortError",
          ),
        );
        return;
      }

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
      let streamClosed = false;
      let settled = false;
      const encoder = new TextEncoder();

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
        },
        cancel() {
          xhr.abort();
        },
      });

      // Promise that resolves/rejects when XHR completes or fails
      let resolveFullText: (text: string) => void;
      let rejectFullText: (error: Error) => void;
      const fullTextPromise = new Promise<string>((res, rej) => {
        resolveFullText = res;
        rejectFullText = rej;
      });

      function closeStream() {
        if (streamController && !streamClosed) {
          streamClosed = true;
          streamController.close();
        }
      }

      function errorStream(err: Error) {
        if (streamController && !streamClosed) {
          streamClosed = true;
          streamController.error(err);
        }
      }

      function flushChunks() {
        if (
          streamController &&
          !streamClosed &&
          xhr.responseText.length > lastIndex
        ) {
          const newData = xhr.responseText.slice(lastIndex);
          lastIndex = xhr.responseText.length;
          streamController.enqueue(encoder.encode(newData));
        }
      }

      if (signal) {
        signal.addEventListener("abort", () => {
          const err = new (global as any).DOMException(
            "The operation was aborted.",
            "AbortError",
          );
          xhr.abort();
          errorStream(err);
          rejectFullText(err);
          if (!settled) {
            settled = true;
            reject(err);
          }
        });
      }

      xhr.onprogress = function () {
        flushChunks();
      };

      xhr.onload = function () {
        flushChunks();
        closeStream();
        resolveFullText(xhr.responseText);
      };

      xhr.onerror = function () {
        const err = new TypeError("Network request failed");
        errorStream(err);
        rejectFullText(err);
        if (!settled) {
          settled = true;
          reject(err);
        }
      };

      xhr.ontimeout = function () {
        const err = new TypeError("Network request timed out");
        errorStream(err);
        rejectFullText(err);
        if (!settled) {
          settled = true;
          reject(err);
        }
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

          const responseHeaders = new Headers(respHeaders);

          resp = {
            ok: xhr.status >= 200 && xhr.status < 300,
            status: xhr.status,
            statusText: xhr.statusText,
            headers: responseHeaders,
            body: stream,
            json: async () => JSON.parse(await fullTextPromise),
            text: async () => fullTextPromise,
            // Issue 5: clone() is not supported — throw instead of silently returning same ref
            clone: () => {
              throw new Error(
                "Response.clone() is not supported by the React Native streaming fetch polyfill.",
              );
            },
            arrayBuffer: async () =>
              encoder.encode(await fullTextPromise).buffer,
          };
          settled = true;
          resolve(resp);
        }
      };

      xhr.send((body as any) || null);
    });
  };
}
