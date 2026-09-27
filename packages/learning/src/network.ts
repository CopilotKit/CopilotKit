interface RequestCompletion {
  status?: number;
  outcome: "success" | "error" | "aborted";
}

export type RequestListener = (
  url: string,
  method: string,
) => ((completion: RequestCompletion) => void) | undefined;

interface Hub {
  listeners: Set<RequestListener>;
  restore: () => void;
}

// One active patch per window, independent of the number of capture providers.
// A retired patch can remain underneath another library's wrapper, but is inert.
const hubs = new WeakMap<Window, Hub>();

type BrowserWindow = Window & typeof globalThis;

function requestMethod(
  init: RequestInit | undefined,
): { value?: string } | undefined {
  let object: object | null = init ?? null;
  while (object) {
    const descriptor = Object.getOwnPropertyDescriptor(object, "method");
    if (descriptor) {
      // Native fetch must be the only caller of an accessor or value coercion.
      if (
        !("value" in descriptor) ||
        (descriptor.value !== undefined && typeof descriptor.value !== "string")
      )
        return;
      return { value: descriptor.value };
    }
    object = Object.getPrototypeOf(object);
  }
  return {};
}

function install(win: BrowserWindow, hub: Hub): () => void {
  let active = true;
  let inFlight = 0;
  const start = (url: string, method: string) => {
    if (!active || inFlight >= 100) return;
    const completions = active
      ? [...hub.listeners].flatMap((listener) => {
          try {
            const done = listener(url, method);
            return done ? [{ listener, done }] : [];
          } catch {
            return [];
          }
        })
      : [];
    if (completions.length === 0) return;
    inFlight += 1;
    let completed = false;
    return (result: RequestCompletion) => {
      if (completed) return;
      completed = true;
      inFlight -= 1;
      for (const { listener, done } of completions) {
        if (active && hub.listeners.has(listener)) {
          try {
            done(result);
          } catch {
            /* Capture must never break a request. */
          }
        }
      }
    };
  };

  const originalFetch = win.fetch;
  const urlGetter = Object.getOwnPropertyDescriptor(URL.prototype, "href")?.get;
  const requestUrlGetter =
    typeof Request !== "undefined"
      ? Object.getOwnPropertyDescriptor(Request.prototype, "url")?.get
      : undefined;
  const requestMethodGetter =
    typeof Request !== "undefined"
      ? Object.getOwnPropertyDescriptor(Request.prototype, "method")?.get
      : undefined;
  const patchedFetch: typeof fetch = function (this: unknown, input, init) {
    if (!active) return originalFetch.call(this, input, init);
    let done: ReturnType<typeof start>;
    // Avoid coercing arbitrary objects: doing so could change fetch semantics.
    try {
      const rawUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? urlGetter?.call(input)
            : typeof Request !== "undefined" && input instanceof Request
              ? requestUrlGetter?.call(input)
              : undefined;
      const configuredMethod = requestMethod(init);
      if (configuredMethod && rawUrl !== undefined) {
        const method =
          configuredMethod.value ??
          (typeof Request !== "undefined" && input instanceof Request
            ? requestMethodGetter?.call(input)
            : "GET");
        if (typeof method === "string") done = start(rawUrl, method);
      }
    } catch {
      /* Unsupported request metadata is skipped. */
    }
    let promise: ReturnType<typeof fetch>;
    try {
      promise = originalFetch.call(this, input, init);
    } catch (error) {
      done?.({ outcome: "error" });
      throw error;
    }
    if (done) {
      // Return the original promise and response without consuming/cloning bodies.
      void promise
        .then(
          (response) =>
            done?.({
              status: response.status,
              outcome: response.ok ? "success" : "error",
            }),
          (error: unknown) =>
            done?.({
              outcome:
                typeof error === "object" &&
                error !== null &&
                "name" in error &&
                error.name === "AbortError"
                  ? "aborted"
                  : "error",
            }),
        )
        .catch(() => {
          /* Observer failures cannot become unhandled rejections. */
        });
    }
    return promise;
  };
  if (typeof originalFetch === "function") win.fetch = patchedFetch;

  const xhrPrototype = win.XMLHttpRequest.prototype;
  const originalOpen = xhrPrototype.open;
  const originalSend = xhrPrototype.send;
  const metadata = new WeakMap<
    XMLHttpRequest,
    { url: string; method: string }
  >();
  const pending = new Map<XMLHttpRequest, () => void>();
  const patchedOpen: typeof originalOpen = function (
    this: XMLHttpRequest,
    ...args: [
      method: string,
      url: string | URL,
      async?: boolean,
      username?: string | null,
      password?: string | null,
    ]
  ) {
    // Preserve native overloads, receiver validation and synchronous exceptions.
    const result = Reflect.apply(originalOpen, this, args);
    const previous = pending.get(this);
    previous?.();
    metadata.delete(this);
    const [method, url] = args;
    if (
      typeof method === "string" &&
      (typeof url === "string" || url instanceof URL)
    ) {
      metadata.set(this, {
        method,
        url: typeof url === "string" ? url : urlGetter!.call(url),
      });
    }
    return result;
  };
  const patchedSend: typeof originalSend = function (
    this: XMLHttpRequest,
    body,
  ) {
    // A repeated send on an active XHR should throw natively without replacing
    // the first request's cleanup entry.
    if (pending.has(this)) return originalSend.call(this, body);
    const request = metadata.get(this);
    const done = request ? start(request.url, request.method) : undefined;
    let aborted = false;
    const onAbort = () => {
      aborted = true;
    };
    const removeListeners = () => {
      pending.delete(this);
      this.removeEventListener("loadend", onLoadEnd);
      this.removeEventListener("abort", onAbort);
    };
    const onLoadEnd = () => {
      removeListeners();
      done?.({
        status: this.status,
        outcome: aborted
          ? "aborted"
          : this.status >= 200 && this.status < 400
            ? "success"
            : "error",
      });
    };
    if (done) {
      pending.set(this, () => {
        removeListeners();
        done({ outcome: "aborted" });
      });
      this.addEventListener("abort", onAbort, { once: true });
      this.addEventListener("loadend", onLoadEnd, { once: true });
    }
    try {
      return originalSend.call(this, body);
    } catch (error) {
      removeListeners();
      done?.({ outcome: "error" });
      throw error;
    }
  };
  xhrPrototype.open = patchedOpen;
  xhrPrototype.send = patchedSend;

  return () => {
    active = false;
    if (win.fetch === patchedFetch) win.fetch = originalFetch;
    if (xhrPrototype.open === patchedOpen) xhrPrototype.open = originalOpen;
    if (xhrPrototype.send === patchedSend) xhrPrototype.send = originalSend;
    for (const remove of pending.values()) remove();
    pending.clear();
  };
}

export function subscribeToRequests(
  win: BrowserWindow,
  listener: RequestListener,
): () => void {
  let hub = hubs.get(win);
  if (!hub) {
    hub = { listeners: new Set(), restore: () => {} };
    hub.restore = install(win, hub);
    hubs.set(win, hub);
  }
  hub.listeners.add(listener);
  return () => {
    hub.listeners.delete(listener);
    if (hub.listeners.size === 0) {
      hub.restore();
      if (hubs.get(win) === hub) hubs.delete(win);
    }
  };
}
