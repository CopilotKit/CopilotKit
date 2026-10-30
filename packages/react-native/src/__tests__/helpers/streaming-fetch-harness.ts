import { vi } from "vitest";

/**
 * Test harness for the streaming-fetch capability check.
 *
 * It fakes three things and measures what reaches them:
 *  - the installed (native) fetch, whose probe behaviour each test scripts;
 *  - XMLHttpRequest, which the XHR shim sends through;
 *  - the clock (vitest fake timers), so every wait is measured in exact
 *    virtual milliseconds.
 *
 * Application requests carry a unique body marker, so the harness can count
 * how many times each request reached the native fetch or the shim.
 */

export const DATA_PROBE = "data:text/plain,copilotkit";
export const FILE_PROBE = "file:///__copilotkit_streaming_fetch_probe__";
const APP_URL = "https://api.test/run";

export type ProbeAnswer = (url: string, init?: RequestInit) => Promise<Response>;

export function streamingResponse(status = 200): Response {
  return {
    status,
    body: new ReadableStream({ start: (controller) => controller.close() }),
  } as Response;
}

export function bufferedResponse(): Response {
  return { status: 200, body: null } as unknown as Response;
}

/** Answers after `ms` of (virtual) time; 0 answers on the next microtask. */
export function answerAfter(ms: number, response: () => Response): ProbeAnswer {
  return () =>
    ms === 0
      ? Promise.resolve(response())
      : new Promise((resolve) => setTimeout(() => resolve(response()), ms));
}

/** A probe that never settles, whatever the abort signal does. */
export const neverAnswers: ProbeAnswer = () => new Promise<Response>(() => {});

/**
 * The Android dev-build case: the data: probe rejects after `rejectAfterMs`,
 * then the file: probe returns a readable 404 after `fileAfterMs`.
 */
export function androidLike(
  rejectAfterMs = 1_584,
  fileAfterMs = 16,
): ProbeAnswer {
  return (url) =>
    url === DATA_PROBE
      ? new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("Unsupported URL scheme: data")),
            rejectAfterMs,
          ),
        )
      : new Promise((resolve) =>
          setTimeout(() => resolve(streamingResponse(404)), fileAfterMs),
        );
}

export class MockXhr {
  open = vi.fn();
  send = vi.fn((_body?: unknown) => {
    this.sentAt = Date.now();
  });
  abort = vi.fn();
  setRequestHeader = vi.fn();
  getAllResponseHeaders = vi.fn(() => "");
  readyState = 0;
  status = 0;
  statusText = "";
  responseText = "";
  responseType = "";
  sentAt = -1;
  onreadystatechange: (() => void) | null = null;
  onprogress: (() => void) | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
}

export type FetchKind = "native" | "pending" | "shim" | "app";

export interface Issued {
  marker: string;
  issuedAt: number;
  response: Promise<Response>;
}

/**
 * Sets up the fakes, installs streaming fetch and returns the probes.
 *
 * `busyMs` models a busy JS thread at app start: the clock moves on
 * synchronously after the install and before the probe (queued as a
 * microtask) is issued, so timers armed at install fire first.
 */
export async function setupEnvironment(
  probe: ProbeAnswer,
  options: { busyMs?: number } = {},
) {
  const probeCalls: {
    url: string;
    signal?: AbortSignal;
    settled: boolean;
  }[] = [];
  const nativeAppCalls: {
    marker: string;
    at: number;
    input: RequestInfo | URL;
    init?: RequestInit;
    thisArg: unknown;
  }[] = [];
  const nativeResponse = streamingResponse();

  const originalFetch = vi.fn(function (
    this: unknown,
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const url = typeof input === "string" ? input : String(input);
    if (url === DATA_PROBE || url === FILE_PROBE) {
      const call = { url, signal: init?.signal ?? undefined, settled: false };
      probeCalls.push(call);
      const answer = probe(url, init);
      answer.then(
        () => (call.settled = true),
        () => (call.settled = true),
      );
      return answer;
    }
    nativeAppCalls.push({
      marker: String(init?.body),
      at: Date.now(),
      input,
      init,
      thisArg: this,
    });
    return Promise.resolve(nativeResponse);
  });

  const xhrs: MockXhr[] = [];
  vi.stubGlobal(
    "XMLHttpRequest",
    vi.fn(function () {
      const xhr = new MockXhr();
      xhrs.push(xhr);
      return xhr;
    }),
  );
  vi.stubGlobal("fetch", originalFetch);

  const { installStreamingFetch } = await import("../../streaming-fetch");
  const ready = installStreamingFetch();
  const pending = globalThis.fetch;
  if (options.busyMs) vi.advanceTimersByTime(options.busyMs);

  const fetchKind = (): FetchKind => {
    const current = globalThis.fetch;
    if (current === originalFetch) return "native";
    if (current === pending) return "pending";
    return (current as any).__originalFetch === originalFetch ? "shim" : "app";
  };

  let counter = 0;
  /** Issues an application request through whatever global.fetch is now. */
  const issue = (init: RequestInit = {}): Issued => {
    const marker = `req-${++counter}`;
    return {
      marker,
      issuedAt: Date.now(),
      response: globalThis.fetch(APP_URL, {
        method: "POST",
        body: marker,
        ...init,
      }),
    };
  };

  /** How many times a marked request reached the native fetch or the shim. */
  const deliveries = (marker: string) => ({
    native: nativeAppCalls.filter((call) => call.marker === marker).length,
    shim: xhrs.filter((xhr) => xhr.send.mock.calls[0]?.[0] === marker).length,
  });
  const deliveryTime = (marker: string): number | undefined =>
    nativeAppCalls.find((call) => call.marker === marker)?.at ??
    xhrs.find((xhr) => xhr.send.mock.calls[0]?.[0] === marker)?.sentAt;

  /**
   * Advances the virtual clock one millisecond at a time and returns every
   * change of the global fetch, with the virtual time of the change.
   */
  const trace = async (untilMs: number) => {
    const start = Date.now();
    const transitions = [{ t: 0, kind: fetchKind() }];
    for (let t = 1; t <= untilMs; t++) {
      await vi.advanceTimersByTimeAsync(1);
      const kind = fetchKind();
      if (kind !== transitions[transitions.length - 1].kind) {
        transitions.push({ t: Date.now() - start, kind });
      }
    }
    return transitions;
  };

  /** Completes a shim request: headers, then the end of the body. */
  const completeXhr = async (xhr: MockXhr, status = 200) => {
    xhr.readyState = 2;
    xhr.status = status;
    xhr.onreadystatechange?.();
    xhr.readyState = 4;
    xhr.onload?.();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
  };

  /** Pending timers plus probe requests that neither settled nor aborted. */
  const leaks = () => ({
    timers: vi.getTimerCount(),
    liveProbes: probeCalls.filter(
      (call) => !call.settled && !call.signal?.aborted,
    ).length,
  });

  return {
    originalFetch,
    nativeAppCalls,
    nativeResponse,
    probeCalls,
    xhrs,
    ready,
    pending,
    fetchKind,
    issue,
    deliveries,
    deliveryTime,
    trace,
    completeXhr,
    leaks,
    installStreamingFetch,
  };
}
