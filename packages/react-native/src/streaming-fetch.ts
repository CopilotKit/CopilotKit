/**
 * Streaming fetch for React Native.
 *
 * React Native's own fetch (whatwg-fetch over XMLHttpRequest) buffers the whole
 * response, so `response.body.getReader()` is unavailable and AG-UI's SSE
 * transport cannot stream. {@link createStreamingFetch} builds an XHR-based
 * fetch whose `body` is a `ReadableStream` fed chunk by chunk.
 *
 * It never replaces `globalThis.fetch` on its own. `CopilotKitProvider` hands
 * it to Core only when the platform's fetch cannot stream
 * ({@link streamingFetchForPlatform}); on Expo, whose `expo/fetch` already
 * streams, Core uses Expo's fetch and the app keeps its own.
 * {@link installStreamingFetch} is the opt-in global replacement, published as
 * `@copilotkit/react-native/polyfills/fetch`.
 *
 * THREADING NOTE: In React Native, XHR callbacks (onprogress, onload, etc.)
 * may fire on a native networking thread. Pushing data into the ReadableStream
 * from that thread can trigger downstream React setState calls on the wrong
 * thread, causing iOS to kill the process with "deleted thread with uncommitted
 * CATransaction". All stream-mutating operations are therefore deferred via
 * setTimeout(fn, 0) to bounce back to the JS thread (main thread in Hermes).
 */

declare const global: typeof globalThis;

/** Options for {@link createStreamingFetch}. */
export interface StreamingFetchOptions {
  /**
   * Milliseconds a request may go without receiving anything (headers or body
   * data) before it fails with `TypeError("Network request timed out")`. Every
   * chunk restarts the clock, so a long agent run that keeps streaming is never
   * cut off; this only catches a connection that has stalled (a Wi-Fi to
   * cellular handover, a tunnel). CopilotRuntime writes an SSE keep-alive after
   * 15 s of silence, well inside the default.
   *
   * `0` disables it. Cancel a request with `init.signal` either way.
   *
   * @default 60000
   */
  idleTimeoutMs?: number;
}

const DEFAULT_IDLE_TIMEOUT_MS = 60_000;

/** Fetches built here, so detection recognises one installed as the global. */
const streamingFetches = new WeakSet<object>();

type FetchWithMarkers = typeof fetch & {
  /** Set by whatwg-fetch, React Native's own (non-streaming) fetch. */
  polyfill?: unknown;
  /** The fetch {@link installStreamingFetch} replaced. */
  __originalFetch?: typeof fetch;
};

/** Subset of the Response interface implemented by the streaming fetch. */
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
  clone(): StreamingFetchResponse;
  formData(): Promise<never>;
}

function createAbortError(): DOMException {
  return new (global as any).DOMException(
    "The operation was aborted.",
    "AbortError",
  );
}

/** Whether the global `Response` produces bodies with `getReader()`. */
function responseBodiesStream(): boolean {
  if (typeof global.Response !== "function") {
    return false;
  }
  try {
    const body = new Response("").body;
    return body != null && typeof body.getReader === "function";
  } catch (e) {
    if (__DEV__) {
      console.warn(
        "[CopilotKit] Unexpected error probing Response for streaming support; " +
          "treating the platform fetch as non-streaming:",
        e,
      );
    }
    return false;
  }
}

/**
 * Whether the platform's `globalThis.fetch` returns bodies CopilotKit can
 * stream. Decided from the fetch itself, not from the global `Response`:
 *
 * - React Native's own fetch is whatwg-fetch, marked `fetch.polyfill === true`.
 *   It buffers the whole body, so it cannot stream.
 * - Where the global `Response` streams (browsers, Node, react-native-web), the
 *   fetch that returns it does too.
 * - Expo replaces React Native's fetch with `expo/fetch`, which streams, but
 *   leaves React Native's `Response` (no `body`) as the global. Expo marks its
 *   runtime with `globalThis.expo`.
 *
 * Any other fetch on a runtime whose `Response` cannot stream, such as a
 * monitoring wrapper that hides the `polyfill` flag, counts as non-streaming,
 * so CopilotKit falls back to its XHR transport rather than lose streaming.
 */
export function platformFetchStreams(): boolean {
  const platformFetch = global.fetch as FetchWithMarkers | undefined;
  if (typeof platformFetch !== "function") {
    return false;
  }
  if (streamingFetches.has(platformFetch)) {
    return true;
  }
  if (platformFetch.polyfill === true) {
    return false;
  }
  if (responseBodiesStream()) {
    return true;
  }
  const expo = (global as { expo?: unknown }).expo;
  return typeof expo === "object" && expo !== null;
}

/**
 * The fetch `CopilotKitProvider` gives Core when the app passes none:
 * `undefined` when the platform's fetch streams (Core then uses it), else a
 * streaming fetch scoped to CopilotKit's requests. The global is not touched.
 */
export function streamingFetchForPlatform(): typeof fetch | undefined {
  return platformFetchStreams() ? undefined : createStreamingFetch();
}

/**
 * Opt-in: replace `globalThis.fetch` with a streaming fetch when the
 * platform's fetch cannot stream, for apps that call AG-UI agents (or other
 * SSE endpoints) through the global fetch themselves. The replaced fetch stays
 * reachable as `globalThis.fetch.__originalFetch`. Skipped where the platform
 * fetch already streams (Expo, browsers); calling it twice is a no-op.
 *
 * Prefer passing `createStreamingFetch()` to the code that needs it, e.g.
 * `new HttpAgent({ url, fetch: createStreamingFetch() })`: the global
 * replacement applies to every request in the app.
 */
export function installStreamingFetch(options?: StreamingFetchOptions): void {
  if (platformFetchStreams()) {
    return;
  }
  const originalFetch = global.fetch;
  const streamingFetch = createStreamingFetch(options) as FetchWithMarkers;
  streamingFetch.__originalFetch = originalFetch;
  global.fetch = streamingFetch;
}

/**
 * Create an XHR-based `fetch` whose responses stream: `response.body` is a
 * `ReadableStream` that receives each chunk as React Native's networking
 * layer delivers it. It honours `method`, `headers`, `body`, `signal` and
 * `credentials` (`"omit"` sends no cookies; `"include"` and `"same-origin"`
 * keep React Native's default of sending them, as its own fetch does).
 *
 * The request has no total-time limit; see
 * {@link StreamingFetchOptions.idleTimeoutMs} for the stall timeout. Pass the
 * result as `CopilotKitProvider`'s `fetch`, or to your own `HttpAgent`.
 */
export function createStreamingFetch(
  options: StreamingFetchOptions = {},
): typeof fetch {
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  if (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs < 0) {
    throw new RangeError(
      `idleTimeoutMs must be a finite number of milliseconds >= 0 (0 disables it), got ${String(options.idleTimeoutMs)}`,
    );
  }

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
    const credentials = init?.credentials ?? request?.credentials;

    return new Promise((resolve, reject) => {
      // Reject immediately if signal is already aborted (per fetch spec)
      if (signal?.aborted) {
        reject(createAbortError());
        return;
      }

      const xhr = new XMLHttpRequest();
      xhr.open(method, url);

      // No `xhr.timeout`: React Native passes it to OkHttp as a call timeout
      // on Android, which caps the whole request, so any run longer than it
      // was cut off (iOS treats the same value as an idle timeout). The idle
      // timer below gives both platforms the same stall protection instead.

      // React Native's XHR sends cookies unless told otherwise. Map the fetch
      // credentials mode the way its own fetch (whatwg-fetch) does.
      if (credentials === "omit") {
        xhr.withCredentials = false;
      } else if (credentials === "include") {
        xhr.withCredentials = true;
      }

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

      // One controller per response body: the response and each clone()
      // read their own stream, all fed from the same XHR.
      const branches = new Set<ReadableStreamDefaultController<Uint8Array>>();
      let lastIndex = 0;
      let streamClosed = false;
      let streamError: Error | undefined;
      let settled = false;
      let finished = false;
      const encoder = new global.TextEncoder();

      // Promise that resolves/rejects when XHR completes or fails
      let resolveFullText: (text: string) => void;
      let rejectFullText: (error: Error) => void;
      const fullTextPromise = new Promise<string>((res, rej) => {
        resolveFullText = res;
        rejectFullText = rej;
      });
      // Prevent unhandled rejection when error occurs but .text()/.json() is never called
      fullTextPromise.catch(() => {});

      let idleTimer: ReturnType<typeof setTimeout> | undefined;

      function clearIdleTimer() {
        if (idleTimer !== undefined) {
          clearTimeout(idleTimer);
          idleTimer = undefined;
        }
      }

      /** Restart the stall clock. Called on every sign of life from the XHR. */
      function armIdleTimer() {
        if (idleTimeoutMs === 0 || finished) return;
        clearIdleTimer();
        idleTimer = setTimeout(() => {
          idleTimer = undefined;
          fail(new TypeError("Network request timed out"));
          xhr.abort();
        }, idleTimeoutMs);
      }

      /** Stop the stall clock and the abort wiring: the request is over. */
      function finish() {
        finished = true;
        clearIdleTimer();
        cleanupAbortListener();
      }

      function closeStream() {
        if (streamClosed) return;
        streamClosed = true;
        for (const controller of branches) controller.close();
      }

      function errorStream(err: Error) {
        if (streamClosed) return;
        streamClosed = true;
        streamError = err;
        for (const controller of branches) controller.error(err);
      }

      function flushChunks() {
        if (!streamClosed && xhr.responseText.length > lastIndex) {
          const newData = xhr.responseText.slice(lastIndex);
          lastIndex = xhr.responseText.length;
          const chunk = encoder.encode(newData);
          for (const controller of branches) controller.enqueue(chunk);
        }
      }

      /** Centralized error handler — errors the stream, rejects fullTextPromise,
       *  and rejects the outer fetch promise if not yet settled. */
      function fail(err: Error) {
        finish();
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

      /**
       * A body stream for one response. It starts with everything received so
       * far, so a clone made after some chunks arrived still reads the whole
       * body. Cancelling it aborts the XHR only once no other body is reading.
       */
      function createBranch(): ReadableStream<Uint8Array> {
        let branch: ReadableStreamDefaultController<Uint8Array>;
        return new ReadableStream<Uint8Array>({
          start(controller) {
            branch = controller;
            if (lastIndex > 0) {
              controller.enqueue(
                encoder.encode(xhr.responseText.slice(0, lastIndex)),
              );
            }
            if (streamError) {
              controller.error(streamError);
            } else if (streamClosed) {
              controller.close();
            } else {
              branches.add(controller);
            }
          },
          cancel() {
            branches.delete(branch);
            if (branches.size === 0 && !streamClosed) {
              finish();
              streamClosed = true;
              xhr.abort();
              rejectFullText(createAbortError());
            }
          },
        });
      }

      // All XHR callbacks are wrapped with setTimeout(fn, 0) to ensure they
      // run on the JS thread. In React Native, XHR callbacks may fire on a
      // native networking thread; calling enqueue() there triggers downstream
      // React setState on the wrong thread, which causes iOS to kill the
      // process ("deleted thread with uncommitted CATransaction").
      // setTimeout(fn, 0) defers execution to the JS event loop (main thread
      // in Hermes) with negligible latency — streaming still feels real-time.
      // The idle clock is restarted synchronously, before the deferral.

      xhr.onprogress = function () {
        armIdleTimer();
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
        // Synchronously, so the idle timer cannot fire between load and the
        // deferred close below.
        finish();
        setTimeout(() => {
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

      function createResponse(
        status: number,
        statusText: string,
        responseHeaders: Headers,
      ): StreamingFetchResponse {
        const stream = createBranch();
        let bodyUsed = false;
        const response: StreamingFetchResponse = {
          // Duck-typed Response object (not a native Response instance)
          ok: status >= 200 && status < 300,
          status,
          statusText,
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
                `Failed to parse JSON from ${method} ${url} (status ${status}): ${
                  text.length > 200 ? text.slice(0, 200) + "..." : text
                }`,
                { cause: e },
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
            // Per the fetch spec, a used or locked body cannot be cloned.
            if (bodyUsed || stream.locked) {
              throw new TypeError(
                "Response.clone: the response body has already been used",
              );
            }
            return createResponse(
              status,
              statusText,
              new Headers(responseHeaders),
            );
          },
          formData: async () => {
            throw new Error(
              "Response.formData() is not supported by the React Native streaming fetch.",
            );
          },
        };
        return response;
      }

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
        armIdleTimer();

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

          if (readyState >= 2 && !resp && xhrStatus !== 0 && !settled) {
            const respHeaders: Record<string, string> = {};
            for (const line of rawHeaders.trim().split("\r\n")) {
              const idx = line.indexOf(": ");
              if (idx > 0) {
                respHeaders[line.slice(0, idx).toLowerCase()] = line.slice(
                  idx + 2,
                );
              }
            }

            resp = createResponse(
              xhrStatus,
              xhrStatusText,
              new Headers(respHeaders),
            );
            settled = true;
            // NOTE: abort listener is NOT removed here — the signal must remain
            // wired to xhr.abort() for mid-stream cancellation. Cleanup happens
            // in terminal handlers (onload, onerror, ontimeout) or onAbort itself.
            resolve(resp as unknown as Response);
          }
        }, 0);
      };

      armIdleTimer();
      xhr.send(body ?? null);
    });
  };

  streamingFetches.add(streamingFetch);
  return streamingFetch as typeof fetch;
}
