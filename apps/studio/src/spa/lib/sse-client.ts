/**
 * CopilotKit Studio — SSE client.
 *
 * Browser port of the VS Code extension's
 * `.chalk/references/vscode-extension/src/extension/debug-stream.ts`. The
 * VS Code version uses Node's `http.get` directly so it can stream `data:`
 * frames as a plain text body; in the browser we use `EventSource`, which
 * handles framing for us — we just attach a `message` listener and parse the
 * JSON payload that arrives in `event.data`.
 *
 * Same public API as the VS Code version so the surface stays familiar:
 *   - `onEvent(cb)` / `onStatus(cb)` / `onError(cb)` — disposable subscribers
 *   - `connect(runtimeUrl)` / `disconnect()` / `dispose()`
 *   - 1s → 10s exponential-backoff reconnect on stream drop
 *
 * CORS: the user's runtime must send `Access-Control-Allow-Origin: *` on
 * `/cpk-debug-events` for `EventSource` to read the stream cross-origin. The
 * studio assumes this in dev (per web-inspector-v1.md §11 risks). If the
 * runtime drops the header, the browser closes the EventSource silently and
 * we surface a friendly error.
 *
 * **Differences from the VS Code port (documented for future readers):**
 *   - `EventSource` doesn't expose HTTP status codes, so the 404 "is the
 *     runtime running in dev mode?" guard from the VS Code version becomes
 *     a generic connection-error message. The reconnect timer still
 *     back-pressures spam.
 *   - `EventSource.close()` is called instead of `req.destroy()` —
 *     EventSource owns the socket lifecycle itself.
 *   - We capture parse-error messages exactly the same way so existing
 *     consumers behave identically.
 *
 * The class is intentionally framework-free; consumers wrap it in React
 * state in `App.tsx` (M7 integration).
 */

import type {
  DebugEventEnvelope,
  SseConnectionStatus,
} from "../../shared/types.js";

type EventCallback = (envelope: DebugEventEnvelope) => void;
type StatusCallback = (status: SseConnectionStatus) => void;
type ErrorCallback = (error: string) => void;

/**
 * Constructor for the browser's EventSource. Pulled into a factory so tests
 * can inject a mock without monkey-patching `globalThis`.
 */
export type EventSourceCtor = new (
  url: string,
  init?: EventSourceInit,
) => EventSource;

export type DebugStreamOptions = {
  /** Override the EventSource constructor (default: `globalThis.EventSource`). */
  eventSourceCtor?: EventSourceCtor;
  /** Override the reconnect-delay schedule. Pure for tests. */
  initialReconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  /** Override the setTimeout used for reconnect scheduling. Pure for tests. */
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
};

const DEFAULT_INITIAL_RECONNECT_DELAY_MS = 1000;
const DEFAULT_MAX_RECONNECT_DELAY_MS = 10000;

export class DebugStream {
  private eventCallbacks: EventCallback[] = [];
  private statusCallbacks: StatusCallback[] = [];
  private errorCallbacks: ErrorCallback[] = [];
  private source: EventSource | null = null;
  private status: SseConnectionStatus = "disconnected";
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay: number;
  private shouldReconnect = false;
  private currentRuntimeUrl: string | null = null;

  private readonly EventSourceCtor: EventSourceCtor;
  private readonly initialReconnectDelayMs: number;
  private readonly maxReconnectDelayMs: number;
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;

  constructor(options: DebugStreamOptions = {}) {
    // Browser default — `globalThis.EventSource` is always defined in real
    // environments, but JSDOM and Node test runners may not have it. Throw
    // a clear error only when `connect()` is called without a polyfill.
    this.EventSourceCtor =
      options.eventSourceCtor ??
      (globalThis as typeof globalThis & { EventSource?: EventSourceCtor })
        .EventSource ??
      (undefined as unknown as EventSourceCtor);

    this.initialReconnectDelayMs =
      options.initialReconnectDelayMs ?? DEFAULT_INITIAL_RECONNECT_DELAY_MS;
    this.maxReconnectDelayMs =
      options.maxReconnectDelayMs ?? DEFAULT_MAX_RECONNECT_DELAY_MS;
    this.reconnectDelay = this.initialReconnectDelayMs;

    // Bind to the global so calling them through the instance field
    // (`this.setTimeoutFn(...)`) doesn't trip the "Illegal invocation" error
    // browsers throw when `setTimeout`/`clearTimeout` are detached from
    // `window`.
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout.bind(globalThis);
    this.clearTimeoutFn =
      options.clearTimeoutFn ?? clearTimeout.bind(globalThis);
  }

  /** Subscribe to incoming debug-event envelopes. Returns a disposer. */
  onEvent(cb: EventCallback): () => void {
    this.eventCallbacks.push(cb);
    return () => {
      this.eventCallbacks = this.eventCallbacks.filter((c) => c !== cb);
    };
  }

  /** Subscribe to connection-status transitions. Returns a disposer. */
  onStatus(cb: StatusCallback): () => void {
    this.statusCallbacks.push(cb);
    // Replay current status so late subscribers don't miss the initial
    // value. Matches the React state-bridge pattern in `App.tsx`.
    cb(this.status);
    return () => {
      this.statusCallbacks = this.statusCallbacks.filter((c) => c !== cb);
    };
  }

  /** Subscribe to non-fatal stream errors. Returns a disposer. */
  onError(cb: ErrorCallback): () => void {
    this.errorCallbacks.push(cb);
    return () => {
      this.errorCallbacks = this.errorCallbacks.filter((c) => c !== cb);
    };
  }

  /** Current connection status (cheap read; the same value `onStatus` replays). */
  getStatus(): SseConnectionStatus {
    return this.status;
  }

  /**
   * Open a connection to `<runtimeUrl>/cpk-debug-events`. Idempotent —
   * calling `connect()` twice in a row closes the previous EventSource and
   * starts a fresh one (matches the VS Code port's `disconnect() + doConnect()`
   * dance).
   */
  connect(runtimeUrl: string): void {
    this.disconnect();
    this.shouldReconnect = true;
    this.reconnectDelay = this.initialReconnectDelayMs;
    this.currentRuntimeUrl = runtimeUrl;
    this.doConnect(runtimeUrl);
  }

  /**
   * Close the current connection (if any) and cancel any pending reconnect.
   * Safe to call when already disconnected.
   */
  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      this.clearTimeoutFn(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.source) {
      this.source.close();
      this.source = null;
    }
    this.currentRuntimeUrl = null;
    this.setStatus("disconnected");
  }

  /**
   * Tear down the stream and drop every subscriber. Use when the consumer is
   * unmounting permanently (the React effect cleanup path).
   */
  dispose(): void {
    this.disconnect();
    this.eventCallbacks = [];
    this.statusCallbacks = [];
    this.errorCallbacks = [];
  }

  private emitError(error: string): void {
    for (const cb of this.errorCallbacks) {
      cb(error);
    }
  }

  private doConnect(runtimeUrl: string): void {
    if (!this.EventSourceCtor) {
      this.emitError(
        "EventSource is not available in this environment. The SSE timeline needs a browser (or a polyfill) — pass `eventSourceCtor` for tests.",
      );
      this.setStatus("error");
      return;
    }

    this.setStatus("connecting");

    let url: URL;
    try {
      // Tolerate `http://localhost:3000` and `http://localhost:3000/` alike;
      // identical normalization to the VS Code port.
      const base = runtimeUrl.endsWith("/") ? runtimeUrl : runtimeUrl + "/";
      url = new URL("cpk-debug-events", base);
    } catch {
      this.emitError(`Invalid runtime URL: ${runtimeUrl}`);
      // No reconnect — the URL is malformed, retrying won't help.
      this.shouldReconnect = false;
      this.setStatus("error");
      return;
    }

    let source: EventSource;
    try {
      source = new this.EventSourceCtor(url.toString(), {
        // `withCredentials` defaults to `false`, which is what we want in
        // dev — the runtime sends `Access-Control-Allow-Origin: *` and CORS
        // forbids `*` with credentialed requests.
        withCredentials: false,
      });
    } catch (constructErr) {
      const reason =
        constructErr instanceof Error
          ? constructErr.message
          : String(constructErr);
      this.emitError(`Failed to open EventSource: ${reason}`);
      this.handleDisconnect(runtimeUrl);
      return;
    }

    this.source = source;

    source.addEventListener("open", () => {
      this.setStatus("connected");
      // Successful open → reset the backoff so the *next* disconnect starts
      // again from 1s.
      this.reconnectDelay = this.initialReconnectDelayMs;
    });

    source.addEventListener("message", (event: MessageEvent) => {
      // EventSource has already stripped the `data: ` framing for us; the
      // payload is the raw JSON the runtime emitted.
      const data = typeof event.data === "string" ? event.data : "";
      if (!data) return;

      try {
        const envelope = JSON.parse(data) as DebugEventEnvelope;
        for (const cb of this.eventCallbacks) {
          cb(envelope);
        }
      } catch (parseErr) {
        // Include the underlying JSON error verbatim so the user can tell a
        // truncated SSE frame apart from a version-mismatched runtime
        // (different shapes produce different parse errors). Bound the
        // payload preview at 200 chars to match the VS Code port.
        const reason =
          parseErr instanceof Error ? parseErr.message : String(parseErr);
        this.emitError(
          `Failed to parse event (${reason}): ${data.slice(0, 200)}${data.length > 200 ? "..." : ""}`,
        );
      }
    });

    // `error` is fired on both initial connection failure and stream drops.
    // EventSource auto-reconnects on its own, but only when readyState ===
    // CONNECTING; once it transitions to CLOSED we have to mint a fresh one.
    // We close + reconnect manually to keep the back-off curve consistent
    // with the VS Code port (the browser's default reconnect delay is 3s
    // with no jitter and no cap).
    source.addEventListener("error", () => {
      const readyState = source.readyState;
      // readyState 0 = CONNECTING — initial open failed. 2 = CLOSED — the
      // browser gave up. 1 = OPEN means a transient stream blip the browser
      // is already retrying; ignore.
      if (readyState === EventSource.OPEN) return;

      if (readyState === EventSource.CONNECTING) {
        // The browser is still attempting; don't trigger our backoff yet.
        // We surface the status transition for UI but leave the source open.
        if (this.status !== "connecting") {
          this.setStatus("connecting");
        }
        return;
      }

      // CLOSED — surface the error and start *our* reconnect cycle.
      this.emitError("Connection to runtime debug stream lost. Retrying...");
      this.handleDisconnect(runtimeUrl);
    });
  }

  private handleDisconnect(runtimeUrl: string): void {
    if (this.source) {
      this.source.close();
      this.source = null;
    }
    this.setStatus("disconnected");

    if (!this.shouldReconnect) return;
    // Don't pile reconnect timers if one is already pending.
    if (this.reconnectTimer) return;

    this.reconnectTimer = this.setTimeoutFn(() => {
      this.reconnectTimer = null;
      if (!this.shouldReconnect) return;
      this.doConnect(runtimeUrl);
    }, this.reconnectDelay);

    // Double the delay for the *next* drop, capped at the max. Matches the
    // VS Code port (1s → 2s → 4s → 8s → 10s ceiling).
    this.reconnectDelay = Math.min(
      this.reconnectDelay * 2,
      this.maxReconnectDelayMs,
    );
  }

  private setStatus(status: SseConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const cb of this.statusCallbacks) {
      cb(status);
    }
  }

  /**
   * Test-only escape hatch — returns the URL the client is currently
   * connected (or reconnecting) to. Used by the demo's mock EventSource.
   */
  getCurrentRuntimeUrl(): string | null {
    return this.currentRuntimeUrl;
  }
}

/**
 * Tiny adapter that projects a single `DebugEventEnvelope` into the
 * studio-internal `TimelineEvent` shape. Lives here so consumers (the demo,
 * the M7 integration in `App.tsx`) share a single source of truth for the
 * mapping; not exported types-wise because the input/output types come from
 * `shared/types.ts`.
 *
 * Behavior:
 *   - `frontend_tool.invoked` → fresh entry, status `pending`.
 *   - `frontend_tool.result` (with same `invocationId`) → patches the
 *     pending entry to `ok` / `error`.
 *   - Any other event → ignored (returns `null`).
 *
 * The function is pure: takes the prior list + the new envelope, returns
 * the next list. The caller decides storage (React state, an in-memory
 * ring buffer, etc.).
 */
import type { TimelineEvent } from "../../shared/types.js";

export function reduceTimeline(
  prior: TimelineEvent[],
  envelope: DebugEventEnvelope,
  options: { maxEntries?: number } = {},
): TimelineEvent[] {
  const maxEntries = options.maxEntries ?? 500;
  const event = envelope.event;
  const at = envelopeIso(envelope);

  if (event.type === "frontend_tool.invoked") {
    const invoked = event as Extract<
      typeof event,
      { type: "frontend_tool.invoked" }
    >;
    const id = timelineId(envelope, invoked.invocationId);
    const next: TimelineEvent = {
      id,
      at: invoked.at ?? at,
      tool: invoked.name,
      args: invoked.args,
      agent: invoked.agent ?? envelope.agentId,
      thread: invoked.thread ?? envelope.threadId,
      status: "pending",
    };
    return capRing([...prior, next], maxEntries);
  }

  if (event.type === "frontend_tool.result") {
    const result = event as Extract<
      typeof event,
      { type: "frontend_tool.result" }
    >;
    const targetId = timelineId(envelope, result.invocationId);
    let patched = false;
    const next = prior.map((entry) => {
      if (entry.id !== targetId) return entry;
      patched = true;
      const ok = result.error === undefined;
      return {
        ...entry,
        status: ok ? "ok" : "error",
        result: ok ? result.result : entry.result,
        error: ok ? entry.error : (result.error ?? "Unknown error"),
      } satisfies TimelineEvent;
    });
    // If the result arrived before an invoked (out-of-order or runtime
    // restart), append a synthetic entry so the consumer still sees it.
    if (!patched) {
      const synthetic: TimelineEvent = {
        id: targetId,
        at: result.at ?? at,
        tool: result.name,
        args: undefined,
        agent: result.agent ?? envelope.agentId,
        thread: result.thread ?? envelope.threadId,
        status: result.error === undefined ? "ok" : "error",
        result: result.error === undefined ? result.result : undefined,
        error: result.error,
      };
      return capRing([...prior, synthetic], maxEntries);
    }
    return next;
  }

  return prior;
}

function envelopeIso(envelope: DebugEventEnvelope): string {
  // `timestamp` is epoch ms; emit ISO so the timeline UI can render with
  // `new Date(at)` without juggling formats.
  const ts = Number.isFinite(envelope.timestamp)
    ? envelope.timestamp
    : Date.now();
  return new Date(ts).toISOString();
}

function timelineId(
  envelope: DebugEventEnvelope,
  invocationId?: string,
): string {
  // `invocationId` is the join key when the runtime supplies it; otherwise
  // we fall back to `runId` so result events still find their invoked twin
  // in single-invocation runs.
  return `${envelope.runId || "run"}:${invocationId ?? "default"}`;
}

function capRing<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  return items.slice(items.length - max);
}
