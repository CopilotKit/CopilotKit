export interface IntelligenceReadRequest {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

export interface IntelligenceRelayOptions {
  readonly target: Window;
  readonly frame: HTMLIFrameElement;
  readonly origin: string;
  readonly request: (
    request: IntelligenceReadRequest,
    signal: AbortSignal,
  ) => Promise<{ readonly status: number; readonly body: unknown }>;
  readonly onAccessLost: () => void;
}

/** Relays bounded iframe reads using the host's authenticated Runtime connection. */
export function attachIntelligenceRelay(
  options: IntelligenceRelayOptions,
): () => void {
  const { target, frame, origin } = options;
  if (new URL(origin).origin !== origin || !/^https?:\/\//u.test(origin))
    throw new Error("Invalid Intelligence origin");
  const pending = new Map<string, AbortController>();
  let disposed = false;
  const reply = (id: string, status: number, body: unknown) => {
    const message = { type: "cpki:response", version: 1, id, status, body };
    if (isRecord(body) && body.content instanceof ArrayBuffer)
      frame.contentWindow?.postMessage(message, origin, [body.content]);
    else frame.contentWindow?.postMessage(message, origin);
  };
  const serve = async (id: string, request: IntelligenceReadRequest) => {
    const controller = new AbortController();
    pending.set(id, controller);
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await options.request(request, controller.signal);
      if (disposed || controller.signal.aborted) return;
      reply(id, response.status, response.body);
      if (response.status === 401 || response.status === 403)
        options.onAccessLost();
    } catch {
      if (!disposed && !controller.signal.aborted)
        reply(id, 503, { error: "Intelligence unavailable" });
    } finally {
      clearTimeout(timeout);
      pending.delete(id);
    }
  };
  const onMessage = (event: MessageEvent<unknown>) => {
    if (
      disposed ||
      !frame.contentWindow ||
      event.source !== frame.contentWindow ||
      event.origin !== origin
    )
      return;
    const message = event.data;
    if (
      !isRecord(message) ||
      message.version !== 1 ||
      typeof message.id !== "string" ||
      message.id.length > 128
    )
      return;
    if (message.type === "cpki:cancel") {
      pending.get(message.id)?.abort();
      pending.delete(message.id);
      return;
    }
    if (message.type !== "cpki:request" || pending.has(message.id)) return;
    if (pending.size >= 16) {
      reply(message.id, 429, { error: "Too many requests" });
      return;
    }
    const request = parseRequest(message.request);
    if (!request) {
      reply(message.id, 400, { error: "Invalid request" });
      return;
    }
    serve(message.id, request).catch(() => undefined);
  };
  target.addEventListener("message", onMessage);
  return () => {
    disposed = true;
    target.removeEventListener("message", onMessage);
    for (const controller of pending.values()) controller.abort();
    pending.clear();
  };
}

/** Narrows untrusted postMessage data without importing any product UI schema. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Checks the bridge envelope; the runtime separately allowlists paths and methods. */
function parseRequest(value: unknown): IntelligenceReadRequest | null {
  if (
    !isRecord(value) ||
    !["GET", "POST"].includes(String(value.method)) ||
    typeof value.path !== "string" ||
    value.path.length > 2048 ||
    Object.keys(value).some(
      (key) => !["method", "path", "query", "body"].includes(key),
    )
  )
    return null;
  const query: Record<string, string> = {};
  if (value.query !== undefined) {
    if (!isRecord(value.query) || Object.keys(value.query).length > 20)
      return null;
    for (const [key, item] of Object.entries(value.query)) {
      if (typeof item !== "string" || item.length > 4096 || key.length > 64)
        return null;
      query[key] = item;
    }
  }
  try {
    if (JSON.stringify(value).length > 65_536) return null;
  } catch {
    return null;
  }
  return {
    method: value.method === "GET" ? "GET" : "POST",
    path: value.path,
    ...(value.query === undefined ? {} : { query }),
    ...(value.body === undefined ? {} : { body: value.body }),
  };
}
