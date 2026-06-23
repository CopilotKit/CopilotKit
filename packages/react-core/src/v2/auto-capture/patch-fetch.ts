import type { AutoCaptureBridge } from "./bridge";
import {
  formDataToObject,
  formUrlEncodedToObject,
  parseBodyText,
  toAbsoluteUrl,
} from "./parse";
import type { RawExchange } from "./types";

const FETCH_PATCHED = Symbol.for("copilotkit.autoCapture.fetchPatched");
const FETCH_ORIGINAL = Symbol.for("copilotkit.autoCapture.fetchOriginal");

type PatchableFetch = typeof fetch & {
  [FETCH_PATCHED]?: boolean;
  [FETCH_ORIGINAL]?: typeof fetch;
};

let originalFetch: typeof fetch | null = null;

const now = (): number =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

const headerContentType = (headers: HeadersInit | undefined): string | null => {
  try {
    return new Headers(headers).get("content-type");
  } catch {
    return null;
  }
};

/** Parse a `BodyInit` into a recordable value without consuming the request. */
async function readBodyInit(
  body: BodyInit,
  headers: HeadersInit | undefined,
): Promise<unknown> {
  if (typeof body === "string") {
    return parseBodyText(body, headerContentType(headers));
  }
  if (
    typeof URLSearchParams !== "undefined" &&
    body instanceof URLSearchParams
  ) {
    return formUrlEncodedToObject(body.toString());
  }
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    return formDataToObject(body);
  }
  // Blob / ArrayBuffer / ReadableStream — never read binary payloads.
  return undefined;
}

interface PreparedCapture {
  method: string;
  url: string;
  start: number;
  readRequestBody: () => Promise<unknown>;
}

/** Synchronously capture request metadata so the real request is not delayed. */
function prepareFetchCapture(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): PreparedCapture {
  const isRequest = typeof Request !== "undefined" && input instanceof Request;
  const method =
    init?.method ?? (isRequest ? (input as Request).method : "GET");
  const rawUrl =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as Request).url;

  const readRequestBody = async (): Promise<unknown> => {
    if (init && init.body != null) {
      return readBodyInit(init.body, init.headers);
    }
    if (isRequest) {
      try {
        const clone = (input as Request).clone();
        const text = await clone.text();
        return parseBodyText(text, clone.headers.get("content-type"));
      } catch {
        return undefined;
      }
    }
    return undefined;
  };

  return { method, url: toAbsoluteUrl(rawUrl), start: now(), readRequestBody };
}

async function finishFetchCapture(
  prepared: PreparedCapture,
  responseClone: Response | null,
  dispatch: (raw: RawExchange) => void,
): Promise<void> {
  const requestBody = await prepared.readRequestBody().catch(() => undefined);

  let status = 0;
  let responseBody: unknown;
  if (responseClone) {
    status = responseClone.status;
    try {
      const text = await responseClone.text();
      responseBody = parseBodyText(
        text,
        responseClone.headers.get("content-type"),
      );
    } catch {
      responseBody = undefined;
    }
  }

  dispatch({
    method: prepared.method,
    url: prepared.url,
    requestBody,
    status,
    responseBody,
    durationMs: now() - prepared.start,
  });
}

/**
 * Build a `fetch` wrapper that records captured exchanges through the bridge.
 * The wrapper always delegates to the original and returns its untouched
 * response; capture happens off the response `clone()` and never throws into
 * the caller.
 */
export function createPatchedFetch(
  original: typeof fetch,
  bridge: AutoCaptureBridge,
): typeof fetch {
  return function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    if (!bridge.enabled || !bridge.dispatch) {
      return original(input, init);
    }

    let prepared: PreparedCapture | null = null;
    try {
      prepared = prepareFetchCapture(input, init);
    } catch {
      prepared = null;
    }

    const responsePromise = original(input, init);
    if (!prepared) return responsePromise;

    const dispatch = bridge.dispatch;
    const captured = prepared;
    responsePromise
      .then((response) => {
        let clone: Response | null = null;
        try {
          clone = response.clone();
        } catch {
          clone = null;
        }
        void finishFetchCapture(captured, clone, dispatch).catch(() => {});
      })
      .catch(() => {
        // Network failure — nothing to capture.
      });

    return responsePromise;
  };
}

/** Install the global `fetch` patch (idempotent, browser-only). */
export function patchFetch(bridge: AutoCaptureBridge): void {
  if (typeof window === "undefined" || typeof globalThis.fetch !== "function") {
    return;
  }
  const current = globalThis.fetch as PatchableFetch;
  if (current[FETCH_PATCHED]) {
    // Already patched (e.g. by a prior module instance / HMR); recover the
    // original from the patched artifact so a later restore still works.
    originalFetch = current[FETCH_ORIGINAL] ?? originalFetch;
    return;
  }
  // Keep the original reference for an exact restore, but call a bound copy
  // internally — in real browsers an unbound `fetch` throws "Illegal invocation".
  originalFetch = globalThis.fetch;
  const bound = originalFetch.bind(globalThis);
  const patched = createPatchedFetch(bound, bridge) as PatchableFetch;
  patched[FETCH_PATCHED] = true;
  patched[FETCH_ORIGINAL] = originalFetch;
  globalThis.fetch = patched;
}

/**
 * Restore the original global `fetch`. Recovers the original from the patched
 * artifact when the module-level reference was lost, so restore is reliable
 * across module re-instantiation.
 */
export function restoreFetch(): void {
  const current = globalThis.fetch as PatchableFetch;
  const original = originalFetch ?? current[FETCH_ORIGINAL] ?? null;
  if (original) {
    globalThis.fetch = original;
  }
  originalFetch = null;
}
