import { toOriginAndRoute } from "./routes";
import type { Emit } from "./types";

type Outcome = "ok" | "error" | "aborted";

interface RequestInfoParts {
  url: string;
  method: string;
  framework: ReturnType<typeof detectFramework>;
}

function toAbsolute(url: string) {
  return new URL(url, location.href).href;
}

/**
 * Marks requests a framework makes on its own (Next.js RSC payloads, prefetches,
 * server actions). Reads header names only, never their values.
 */
function detectFramework(url: string, headers: Headers) {
  if (headers.has("next-action")) return "next-action";
  if (headers.has("next-router-prefetch")) return "next-prefetch";
  const isRsc = headers.has("rsc") || new URL(url).searchParams.has("_rsc");
  return isRsc ? "next-rsc" : null;
}

function readFetchRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
) {
  const isRequest = input instanceof Request;
  const url = toAbsolute(isRequest ? input.url : String(input));
  const method = init?.method ?? (isRequest ? input.method : "GET");
  const headers = new Headers(
    init?.headers ?? (isRequest ? input.headers : undefined),
  );
  const parts: RequestInfoParts = {
    url,
    method: method.toUpperCase(),
    framework: detectFramework(url, headers),
  };
  return parts;
}

// Checks the name, not `instanceof`: a DOMException from another realm is not an `Error` there.
function isAbortError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

/**
 * Records method, status, duration, and a masked route for `fetch` and `XMLHttpRequest`.
 * Never clones or reads a body: a streaming response is returned untouched, and its
 * duration ends when the headers arrive.
 */
export function installNetworkCapture(params: {
  emit: Emit;
  routes?: string[];
  ignoreUrls: (string | RegExp)[];
}) {
  const { emit, routes } = params;
  const ignoreUrls = params.ignoreUrls.map((pattern) =>
    typeof pattern === "string" ? toAbsolute(pattern) : pattern,
  );
  const isIgnored = (url: string) =>
    ignoreUrls.some((pattern) =>
      typeof pattern === "string" ? url.startsWith(pattern) : pattern.test(url),
    );

  const record: RecordFn = (transport, request, startedAt, status, outcome) => {
    try {
      emit("network", {
        transport,
        method: request.method,
        ...toOriginAndRoute(request.url, routes),
        status,
        durationMs: Math.round(performance.now() - startedAt),
        outcome,
        ...(request.framework === null ? {} : { framework: request.framework }),
      });
    } catch {
      // Capture must never break the request.
    }
  };

  const uninstallFetch = patchFetch(isIgnored, record);
  const uninstallXhr = patchXhr(isIgnored, record);
  return () => {
    uninstallFetch();
    uninstallXhr();
  };
}

type RecordFn = (
  transport: "fetch" | "xhr",
  request: RequestInfoParts,
  startedAt: number,
  status: number | null,
  outcome: Outcome,
) => void;

function patchFetch(isIgnored: (url: string) => boolean, record: RecordFn) {
  const originalFetch = globalThis.fetch;
  if (typeof originalFetch !== "function") return () => {};
  let active = true;

  const wrappedFetch: typeof fetch = (input, init) => {
    if (!active) return originalFetch.call(globalThis, input, init);
    let request: RequestInfoParts | null = null;
    try {
      request = readFetchRequest(input, init);
    } catch {
      request = null;
    }
    if (request === null || isIgnored(request.url)) {
      return originalFetch.call(globalThis, input, init);
    }
    const startedAt = performance.now();
    const response = originalFetch.call(globalThis, input, init);
    const observed = request;
    // Observe only. The caller gets the original promise, so the Response and any error are unchanged.
    response.then(
      (res) => record("fetch", observed, startedAt, res.status, "ok"),
      (error: unknown) =>
        record(
          "fetch",
          observed,
          startedAt,
          null,
          isAbortError(error) ? "aborted" : "error",
        ),
    );
    return response;
  };

  globalThis.fetch = wrappedFetch;
  return () => {
    // Restore only if no one wrapped fetch after us; otherwise our wrapper passes straight through.
    if (globalThis.fetch === wrappedFetch) globalThis.fetch = originalFetch;
    active = false;
  };
}

function patchXhr(isIgnored: (url: string) => boolean, record: RecordFn) {
  if (typeof XMLHttpRequest !== "function") return () => {};
  const proto = XMLHttpRequest.prototype;
  const originalOpen = proto.open;
  const originalSend = proto.send;
  const requests = new WeakMap<XMLHttpRequest, RequestInfoParts>();
  let active = true;

  const wrappedOpen = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    try {
      // ponytail: XHR is not marked; Next.js and other modern routers use fetch.
      requests.set(this, {
        url: toAbsolute(String(url)),
        method: method.toUpperCase(),
        framework: null,
      });
    } catch {
      requests.delete(this);
    }
    return Reflect.apply(originalOpen, this, [method, url, ...rest]);
  };

  const wrappedSend = function (
    this: XMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null,
  ) {
    const request = requests.get(this);
    if (active && request !== undefined && !isIgnored(request.url)) {
      const startedAt = performance.now();
      let aborted = false;
      this.addEventListener("abort", () => (aborted = true), { once: true });
      this.addEventListener(
        "loadend",
        () => {
          const outcome: Outcome = aborted
            ? "aborted"
            : this.status === 0
              ? "error"
              : "ok";
          record(
            "xhr",
            request,
            startedAt,
            outcome === "ok" ? this.status : null,
            outcome,
          );
        },
        { once: true },
      );
    }
    return originalSend.call(this, body);
  };

  proto.open = wrappedOpen;
  proto.send = wrappedSend;
  return () => {
    if (proto.open === wrappedOpen) proto.open = originalOpen;
    if (proto.send === wrappedSend) proto.send = originalSend;
    active = false;
  };
}
