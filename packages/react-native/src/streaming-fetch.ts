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
 * THREADING NOTE: In React Native, XHR callbacks (onprogress, onload, etc.)
 * may fire on a native networking thread. Pushing data into the ReadableStream
 * from that thread can trigger downstream React setState calls on the wrong
 * thread, causing iOS to kill the process with "deleted thread with uncommitted
 * CATransaction". All stream-mutating operations are therefore deferred via
 * setTimeout(fn, 0) to bounce back to the JS thread (main thread in Hermes).
 *
 * Call `installStreamingFetch()` once at app startup after polyfills.
 */

declare const global: typeof globalThis;

/** Subset of the Response interface implemented by the streaming fetch polyfill. */
interface StreamingFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly url: string;
  readonly type: string;
  readonly redirected: boolean;
  readonly bodyUsed: boolean;
  readonly headers: Headers;
  readonly body: ReadableStream<Uint8Array>;
  json(): Promise<unknown>;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
  blob(): Promise<Blob>;
  clone(): never;
  formData(): Promise<never>;
}

function createAbortError(): DOMException {
  return new (global as any).DOMException(
    "The operation was aborted.",
    "AbortError",
  );
}

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
    let url: string;
    if (typeof input === "string") {
      url = input;
    } else if (input instanceof URL) {
      url = input.href;
    } else {
      url = (input as Request).url;
    }
    const method = init?.method || request?.method || "GET";
    const headers = init?.headers || (request ? request.headers : {});
    const body = (init?.body ?? request?.body) as string | null | undefined;
    const signal = init?.signal || request?.signal;

    return new Promise((resolve, reject) => {
      // Reject immediately if signal is already aborted (per fetch spec)
      if (signal?.aborted) {
        reject(createAbortError());
        return;
      }

      const xhr = new XMLHttpRequest();
      xhr.open(method, url);

      // Default 60s timeout to prevent hanging on stalled mobile connections
      // (WiFi→cellular transitions, tunnels, serverless cold starts).
      // Callers can still use AbortSignal.timeout() for finer control.
      xhr.timeout = 60_000;

      let headerEntries: [string, string][];
      if (headers instanceof Headers) {
        headerEntries = Array.from(headers.entries());
      } else if (Array.isArray(headers)) {
        headerEntries = headers as [string, string][];
      } else {
        headerEntries = Object.entries(headers as Record<string, string>);
      }
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

      // Promise that resolves/rejects when XHR completes or fails
      let resolveFullText: (text: string) => void;
      let rejectFullText: (error: Error) => void;
      const fullTextPromise = new Promise<string>((res, rej) => {
        resolveFullText = res;
        rejectFullText = rej;
      });
      // Prevent unhandled rejection when error occurs but .text()/.json() is never called
      fullTextPromise.catch(() => {});

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

      /** Centralized error handler — errors the stream, rejects fullTextPromise,
       *  and rejects the outer fetch promise if not yet settled. */
      function fail(err: Error) {
        cleanupAbortListener();
        errorStream(err);
        rejectFullText(err);
        if (!settled) {
          settled = true;
          reject(err);
        }
      }

      const onAbort = () => {
        fail(createAbortError());
        xhr.abort();
      };

      if (signal) {
        signal.addEventListener("abort", onAbort);
      }

      function cleanupAbortListener() {
        if (signal) {
          signal.removeEventListener("abort", onAbort);
        }
      }

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
        },
        cancel() {
          xhr.abort();
          rejectFullText(createAbortError());
        },
      });

      // All XHR callbacks are wrapped with setTimeout(fn, 0) to ensure they
      // run on the JS thread. In React Native, XHR callbacks may fire on a
      // native networking thread; calling streamController.enqueue() there
      // triggers downstream React setState on the wrong thread, which causes
      // iOS to kill the process ("deleted thread with uncommitted CATransaction").
      // setTimeout(fn, 0) defers execution to the JS event loop (main thread
      // in Hermes) with negligible latency — streaming still feels real-time.

      xhr.onprogress = function () {
        setTimeout(() => {
          try {
            flushChunks();
          } catch (err) {
            fail(err instanceof Error ? err : new Error(String(err)));
            xhr.abort();
          }
        }, 0);
      };

      xhr.onload = function () {
        setTimeout(() => {
          cleanupAbortListener();
          try {
            flushChunks();
          } catch (err) {
            fail(err instanceof Error ? err : new Error(String(err)));
            return;
          }
          closeStream();
          resolveFullText(xhr.responseText);
        }, 0);
      };

      xhr.onerror = function () {
        setTimeout(() => {
          fail(new TypeError("Network request failed"));
        }, 0);
      };

      xhr.ontimeout = function () {
        setTimeout(() => {
          fail(new TypeError("Network request timed out"));
        }, 0);
      };

      // Resolve with Response once headers arrive.
      // Guard against status === 0 which XHR produces for CORS failures,
      // DNS errors, and mixed-content blocks — let onerror handle those.
      let resp: StreamingFetchResponse | null = null;
      xhr.onreadystatechange = function () {
        // Capture XHR state synchronously before deferring — XHR properties
        // may change between now and when setTimeout fires.
        const readyState = xhr.readyState;
        const xhrStatus = xhr.status;
        const xhrStatusText = xhr.statusText;
        const rawHeaders = xhr.getAllResponseHeaders() || "";

        setTimeout(() => {
          // Safety net: if XHR completed but we never resolved/rejected, fail explicitly.
          // This can happen when status === 0 and onerror doesn't fire (some RN networking impls).
          if (readyState === 4 && !settled && !resp) {
            fail(
              new TypeError(
                `Network request to ${url} completed with status ${xhrStatus} but no response was produced. ` +
                  `This may indicate a CORS failure, DNS error, or React Native networking issue.`,
              ),
            );
            return;
          }

          if (readyState >= 2 && !resp && xhrStatus !== 0) {
            const respHeaders: Record<string, string> = {};
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

            resp = {
              // Duck-typed Response object (not a native Response instance)
              ok: xhrStatus >= 200 && xhrStatus < 300,
              status: xhrStatus,
              statusText: xhrStatusText,
              url: url,
              type: "basic",
              redirected: false,
              get bodyUsed() {
                return bodyUsed;
              },
              headers: responseHeaders,
              body: stream,
              json: async () => {
                bodyUsed = true;
                const text = await fullTextPromise;
                try {
                  return JSON.parse(text);
                } catch (e) {
                  throw new TypeError(
                    `Failed to parse JSON from ${method} ${url} (status ${xhrStatus}): ${
                      text.length > 200 ? text.slice(0, 200) + "..." : text
                    }`,
                  );
                }
              },
              text: async () => {
                bodyUsed = true;
                return fullTextPromise;
              },
              arrayBuffer: async () => {
                bodyUsed = true;
                return encoder.encode(await fullTextPromise).buffer;
              },
              blob: async () => {
                bodyUsed = true;
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
            // NOTE: abort listener is NOT removed here — the signal must remain
            // wired to xhr.abort() for mid-stream cancellation. Cleanup happens
            // in terminal handlers (onload, onerror, ontimeout) or onAbort itself.
            resolve(resp as unknown as Response);
          }
        }, 0);
      };

      xhr.send(body ?? null);
    });
  };

  // Expose original fetch for opt-out (e.g., third-party libs that need native behavior)
  (streamingFetch as any).__originalFetch = originalFetch;
  global.fetch = streamingFetch;
}
