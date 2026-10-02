import { createBodyCapture } from "./network-body";
import type { BodySnapshot } from "./network-body";
import { createRedactor, isCredentialKey } from "./redact";
import type { Redactor } from "./redact";
import { REDACTED } from "./types";
import type { Emit } from "./types";

type Outcome = "ok" | "error" | "aborted";
interface RequestParts {
  url: string;
  method: string;
  headers: Record<string, string>;
}
interface ResponseParts {
  url?: string;
  headers: Record<string, string>;
  body: Promise<BodySnapshot>;
}
const emptyBody = () => Promise.resolve<BodySnapshot>({ status: "empty" });
const unavailableBody = (reason: string) =>
  Promise.resolve<BodySnapshot>({ status: "unavailable", reason });
const toAbsolute = (url: string) => new URL(url, location.href).href;
// Credentials carry no product signal and must never leave the browser, even
// with full capture. The header name stays, so the event still shows it was sent.
// Names the credential-key matcher misses; it covers `authorization`, `cookie`,
// `x-api-key`, `x-csrf-token`, and similar.
const CREDENTIAL_HEADERS = new Set([
  "x-amz-security-token",
  "private-token",
  "x-token",
]);
const headerValue = (name: string, value: string) =>
  CREDENTIAL_HEADERS.has(name.toLowerCase()) || isCredentialKey(name)
    ? REDACTED
    : value;
const headerValues = (headers: Headers) =>
  Object.fromEntries(
    Array.from(headers.entries(), ([name, value]) => [
      name,
      headerValue(name, value),
    ]),
  );

// Checks the name, not instanceof: errors can come from another realm.
function isAbortError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

/** Records browser-visible request/response data without consuming the app's bodies. */
export function installNetworkCapture(params: {
  emit: Emit;
  routes?: string[];
  ignoreUrls: (string | RegExp)[];
  redact?: Redactor;
}) {
  let active = true;
  const { redact = createRedactor() } = params;
  const bodies = createBodyCapture(redact);
  const ignoreUrls = params.ignoreUrls.map((pattern) =>
    typeof pattern === "string"
      ? toAbsolute(pattern)
      : new RegExp(pattern.source, pattern.flags),
  );
  const isIgnored = (url: string) =>
    ignoreUrls.some((pattern) => {
      if (typeof pattern === "string") return url.startsWith(pattern);
      pattern.lastIndex = 0;
      return pattern.test(url);
    });

  const record: RecordFn = (
    transport,
    request,
    requestBody,
    startedAt,
    status,
    outcome,
    response,
  ) => {
    const durationMs = Math.round(performance.now() - startedAt);
    const completedAt = Date.now();
    void Promise.all([
      requestBody,
      response?.body ?? unavailableBody("no-response"),
    ])
      .then(([sent, received]) => {
        if (!active) return;
        const href = redact.url(request.url);
        const url = new URL(href);
        params.emit("network", {
          transport,
          method: request.method,
          url: href,
          origin: url.origin,
          route: url.pathname,
          status,
          durationMs,
          completedAt,
          outcome,
          request: { headers: request.headers, body: sent },
          response: {
            ...(response?.url ? { url: redact.url(response.url) } : {}),
            headers: response?.headers ?? {},
            body: received,
          },
        });
      })
      .catch(() => {
        /* Capture must never affect the host request. */
      });
  };

  const originalFetch = globalThis.fetch;
  const wrappedFetch: typeof fetch = (input, init) => {
    if (!active) return originalFetch.call(globalThis, input, init);
    let request: RequestParts;
    let ignored: boolean;
    try {
      const source =
        typeof Request !== "undefined" && input instanceof Request
          ? input
          : undefined;
      request = {
        url: toAbsolute(source ? source.url : String(input)),
        method: (init?.method ?? source?.method ?? "GET").toUpperCase(),
        headers: headerValues(new Headers(init?.headers ?? source?.headers)),
      };
      ignored = isIgnored(request.url);
    } catch {
      return originalFetch.call(globalThis, input, init);
    }
    if (ignored) return originalFetch.call(globalThis, input, init);
    const startedAt = performance.now();
    let requestBody: Promise<BodySnapshot>;
    try {
      requestBody =
        init?.body != null
          ? bodies.body(init.body, request.headers["content-type"])
          : typeof Request !== "undefined" && input instanceof Request
            ? bodies.read(input.clone().body, request.headers["content-type"])
            : emptyBody();
    } catch {
      requestBody = unavailableBody("request-clone-failed");
    }
    const failed = (error: unknown) =>
      record(
        "fetch",
        request,
        requestBody,
        startedAt,
        null,
        isAbortError(error) ? "aborted" : "error",
      );
    let promise: Promise<Response>;
    try {
      promise = originalFetch.call(globalThis, input, init);
    } catch (error) {
      failed(error);
      throw error;
    }
    void promise
      .then((response) => {
        if (!active) return;
        let responseBody: Promise<BodySnapshot>;
        try {
          responseBody =
            response.type === "opaque" || response.type === "opaqueredirect"
              ? unavailableBody("opaque-response")
              : bodies.read(
                  response.clone().body,
                  response.headers.get("content-type") ?? "",
                );
        } catch {
          responseBody = unavailableBody("response-clone-failed");
        }
        record(
          "fetch",
          request,
          requestBody,
          startedAt,
          response.status,
          "ok",
          {
            url: response.url,
            headers: headerValues(response.headers),
            body: responseBody,
          },
        );
      }, failed)
      .catch(() => {});
    // Return the identical native Promise, Response, and rejection to the caller.
    return promise;
  };
  if (typeof originalFetch === "function") globalThis.fetch = wrappedFetch;
  const uninstallXhr = patchXhr(isIgnored, record, bodies);
  return () => {
    active = false;
    bodies.stop();
    if (globalThis.fetch === wrappedFetch) globalThis.fetch = originalFetch;
    uninstallXhr();
  };
}

type RecordFn = (
  transport: "fetch" | "xhr",
  request: RequestParts,
  requestBody: Promise<BodySnapshot>,
  startedAt: number,
  status: number | null,
  outcome: Outcome,
  response?: ResponseParts,
) => void;

function patchXhr(
  isIgnored: (url: string) => boolean,
  record: RecordFn,
  bodies: ReturnType<typeof createBodyCapture>,
) {
  if (typeof XMLHttpRequest !== "function") return () => {};
  const proto = XMLHttpRequest.prototype;
  const originalOpen = proto.open;
  const originalSend = proto.send;
  const originalSetHeader = proto.setRequestHeader;
  const requests = new WeakMap<XMLHttpRequest, RequestParts>();
  const listeners = new Set<() => void>();
  // open() on an in-flight XHR ends it without `loadend`; its listeners must not
  // report the next request with the old request's details.
  const inFlight = new WeakMap<XMLHttpRequest, () => void>();
  let active = true;
  const wrappedOpen = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    inFlight.get(this)?.();
    const result = Reflect.apply(originalOpen, this, [method, url, ...rest]);
    try {
      requests.set(this, {
        url: toAbsolute(String(url)),
        method: method.toUpperCase(),
        headers: {},
      });
    } catch {
      requests.delete(this);
    }
    return result;
  };
  const wrappedSetHeader = function (
    this: XMLHttpRequest,
    name: string,
    value: string,
  ) {
    const result = originalSetHeader.call(this, name, value);
    const request = requests.get(this);
    if (active && request) {
      try {
        const headers = new Headers(request.headers);
        headers.append(name, value);
        request.headers = headerValues(headers);
      } catch {
        /* Preserve successful native calls even if observation fails. */
      }
    }
    return result;
  };
  const wrappedSend = function (
    this: XMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null,
  ) {
    const request = requests.get(this);
    if (!active || !request || isIgnored(request.url))
      return originalSend.call(this, body);
    const startedAt = performance.now();
    let requestBody: Promise<BodySnapshot>;
    try {
      requestBody =
        typeof Document !== "undefined" && body instanceof Document
          ? Promise.resolve(
              bodies.text(new XMLSerializer().serializeToString(body)),
            )
          : bodies.body(
              body as BodyInit | null | undefined,
              request.headers["content-type"],
            );
    } catch {
      requestBody = unavailableBody("request-body-unavailable");
    }
    let aborted = false;
    const onAbort = () => {
      aborted = true;
    };
    const cleanup = () => {
      this.removeEventListener("abort", onAbort);
      this.removeEventListener("loadend", onEnd);
      listeners.delete(cleanup);
      if (inFlight.get(this) === cleanup) inFlight.delete(this);
    };
    const onEnd = () => {
      cleanup();
      if (!active) return;
      const outcome = aborted ? "aborted" : this.status === 0 ? "error" : "ok";
      const headers: Record<string, string> = {};
      try {
        for (const line of this.getAllResponseHeaders().split(/\r?\n/)) {
          const split = line.indexOf(":");
          if (split > 0) {
            const name = line.slice(0, split).toLowerCase();
            headers[name] = headerValue(name, line.slice(split + 1).trim());
          }
        }
      } catch {
        /* Cross-origin or failed requests can hide response headers. */
      }
      let responseBody: Promise<BodySnapshot>;
      try {
        if (this.responseType === "" || this.responseType === "text") {
          responseBody = Promise.resolve(
            bodies.text(
              this.responseText,
              outcome === "ok" ? "complete" : "interrupted",
              outcome === "ok" ? undefined : `request-${outcome}`,
            ),
          );
        } else if (this.responseType === "json")
          responseBody = Promise.resolve(
            bodies.text(JSON.stringify(this.response)),
          );
        else if (this.responseType === "document")
          responseBody = this.responseXML
            ? Promise.resolve(
                bodies.text(
                  new XMLSerializer().serializeToString(this.responseXML),
                ),
              )
            : unavailableBody("empty-document");
        else
          responseBody = bodies.body(
            this.response as BodyInit,
            headers["content-type"] ?? "application/octet-stream",
          );
      } catch {
        responseBody = unavailableBody("response-body-unavailable");
      }
      record(
        "xhr",
        request,
        requestBody,
        startedAt,
        outcome === "ok" ? this.status : null,
        outcome,
        {
          url: this.responseURL,
          headers,
          body: responseBody,
        },
      );
    };
    this.addEventListener("abort", onAbort);
    this.addEventListener("loadend", onEnd);
    listeners.add(cleanup);
    inFlight.set(this, cleanup);
    try {
      return originalSend.call(this, body);
    } catch (error) {
      cleanup();
      record(
        "xhr",
        request,
        requestBody,
        startedAt,
        null,
        isAbortError(error) ? "aborted" : "error",
      );
      throw error;
    }
  };
  proto.open = wrappedOpen;
  proto.send = wrappedSend;
  proto.setRequestHeader = wrappedSetHeader;
  return () => {
    active = false;
    for (const cleanup of listeners) cleanup();
    if (proto.open === wrappedOpen) proto.open = originalOpen;
    if (proto.send === wrappedSend) proto.send = originalSend;
    if (proto.setRequestHeader === wrappedSetHeader)
      proto.setRequestHeader = originalSetHeader;
  };
}
