/**
 * Streaming fetch implementation for React Native.
 *
 * React Native's built-in fetch doesn't support response.body.getReader()
 * (ReadableStream). This replaces global.fetch with an XHR-based
 * implementation that streams chunks via ReadableStream, enabling
 * CopilotKit's SSE-based agent communication.
 *
 * If native fetch already supports ReadableStream bodies (newer RN / Hermes),
 * the replacement is skipped entirely.
 *
 * Call `installStreamingFetch()` once at app startup after polyfills.
 */

declare const global: typeof globalThis;

export function installStreamingFetch(): void {
  // Skip if native fetch already supports ReadableStream body.
  // Newer React Native versions (Hermes) may support this natively.
  try {
    const testResponse = new Response("");
    if (
      testResponse.body != null &&
      typeof testResponse.body.getReader === "function"
    ) {
      return;
    }
  } catch (e) {
    // Response constructor unavailable — expected in older RN environments.
    if (
      __DEV__ &&
      e instanceof Error &&
      !(e instanceof ReferenceError) &&
      !(e instanceof TypeError)
    ) {
      console.warn(
        "[CopilotKit] Unexpected error during streaming fetch feature detection, " +
          "installing XHR-based polyfill:",
        e,
      );
    }
  }

  const originalFetch = global.fetch;
  const TextEncoder = global.TextEncoder;

  const streamingFetch = function streamingFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    // Extract defaults from Request object when input is a Request
    const request =
      typeof input !== "string" && !(input instanceof URL) ? input : null;
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    const method = init?.method || request?.method || "GET";
    const headers = init?.headers || (request ? request.headers : {});
    const body = (init?.body ?? request?.body) as string | null | undefined;
    const signal = init?.signal || request?.signal;

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

      const headerEntries: [string, string][] =
        headers instanceof Headers
          ? Array.from(headers.entries())
          : Array.isArray(headers)
            ? (headers as [string, string][])
            : Object.entries(headers as Record<string, string>);
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

      const onAbort = () => {
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
      };

      if (signal) {
        signal.addEventListener("abort", onAbort);
      }

      function cleanupAbortListener() {
        if (signal) {
          signal.removeEventListener("abort", onAbort);
        }
      }

      xhr.onprogress = function () {
        try {
          flushChunks();
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          errorStream(error);
          rejectFullText(error);
          xhr.abort();
        }
      };

      xhr.onload = function () {
        cleanupAbortListener();
        try {
          flushChunks();
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          errorStream(error);
          rejectFullText(error);
          return;
        }
        closeStream();
        resolveFullText(xhr.responseText);
      };

      xhr.onerror = function () {
        cleanupAbortListener();
        const err = new TypeError("Network request failed");
        errorStream(err);
        rejectFullText(err);
        if (!settled) {
          settled = true;
          reject(err);
        }
      };

      xhr.ontimeout = function () {
        cleanupAbortListener();
        const err = new TypeError("Network request timed out");
        errorStream(err);
        rejectFullText(err);
        if (!settled) {
          settled = true;
          reject(err);
        }
      };

      // Resolve with Response once headers arrive.
      // Guard against status === 0 which XHR produces for CORS failures,
      // DNS errors, and mixed-content blocks — let onerror handle those.
      let resp: any = null;
      xhr.onreadystatechange = function () {
        // Safety net: if XHR completed but we never resolved/rejected, fail explicitly.
        // This can happen when status === 0 and onerror doesn't fire (some RN networking impls).
        if (xhr.readyState === 4 && !settled && !resp) {
          cleanupAbortListener();
          const err = new TypeError(
            `Network request to ${url} completed with status ${xhr.status} but no response was produced. ` +
              `This may indicate a CORS failure, DNS error, or React Native networking issue.`,
          );
          errorStream(err);
          rejectFullText(err);
          settled = true;
          reject(err);
          return;
        }

        if (xhr.readyState >= 2 && !resp && xhr.status !== 0) {
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

          let bodyUsed = false;
          const markBodyUsed = () => {
            bodyUsed = true;
          };

          resp = {
            // Standard Response properties
            ok: xhr.status >= 200 && xhr.status < 300,
            status: xhr.status,
            statusText: xhr.statusText,
            url: url,
            type: "basic",
            redirected: false,
            get bodyUsed() {
              return bodyUsed;
            },
            headers: responseHeaders,
            body: stream,
            json: async () => {
              markBodyUsed();
              const text = await fullTextPromise;
              try {
                return JSON.parse(text);
              } catch (e) {
                throw new TypeError(
                  `Failed to parse JSON from ${method} ${url} (status ${xhr.status}): ${
                    text.length > 200 ? text.slice(0, 200) + "..." : text
                  }`,
                );
              }
            },
            text: async () => {
              markBodyUsed();
              return fullTextPromise;
            },
            arrayBuffer: async () => {
              markBodyUsed();
              return encoder.encode(await fullTextPromise).buffer;
            },
            blob: async () => {
              markBodyUsed();
              const buf = encoder.encode(await fullTextPromise);
              if (typeof Blob !== "undefined") {
                return new Blob([buf], {
                  type: responseHeaders.get("content-type") || "",
                });
              }
              throw new Error(
                "Blob is not available in this React Native environment.",
              );
            },
            clone: () => {
              throw new Error(
                "Response.clone() is not supported by the React Native streaming fetch polyfill.",
              );
            },
            formData: async () => {
              throw new Error(
                "Response.formData() is not supported by the React Native streaming fetch polyfill.",
              );
            },
          };
          settled = true;
          resolve(resp);
        }
      };

      xhr.send((body as any) || null);
    });
  };

  // Expose original fetch for opt-out (e.g., third-party libs that need native behavior)
  (streamingFetch as any).__originalFetch = originalFetch;
  global.fetch = streamingFetch;
}
