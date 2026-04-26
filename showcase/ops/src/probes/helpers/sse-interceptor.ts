/**
 * D6 — SSE stream interceptor for the parity-vs-reference probe.
 *
 * While a Playwright-driven D5 conversation runs in the browser, this helper
 * captures three orthogonal axes from the runtime → frontend SSE stream:
 *
 *   (a) the ordered list of tool-call names emitted (TOOL_CALL_START events),
 *   (b) the stream timing profile (TTFT, inter-chunk intervals, total chunks,
 *       wall-clock duration),
 *   (c) the JSON contract shape (field path → JS-native type) of every payload
 *       observed.
 *
 * Why CDP, not page.route():
 *   Playwright's `route.fulfill` only accepts a complete `body: string|Buffer`,
 *   and `route.fetch` waits for the full upstream response before returning.
 *   Either path collapses chunk arrival timing to a single point — defeating
 *   D6's stream-cadence axis. Instead we attach a Chrome DevTools Protocol
 *   session and listen to `Network.dataReceived`, which fires per wire-level
 *   chunk with monotonic timestamps. The response itself flows naturally to
 *   the page (no interception, no buffering, no re-injection).
 *
 *   Trade-off: `Network.dataReceived` carries timestamps + byte counts but
 *   not chunk *contents* (the full `data` field requires `Network.enable`
 *   with interception, which is its own can of worms). We retrieve the
 *   complete payload via `Network.getResponseBody` once `loadingFinished`
 *   fires, then parse it as a whole. That gives us authoritative tool-call
 *   ordering and contract shape AND the real per-chunk arrival times — at
 *   the cost of not knowing which event landed in which chunk. For D6's
 *   purposes (parity comparison vs a reference, not per-event auditing) the
 *   timing profile + content is exactly the right granularity.
 *
 * On-wire format (confirmed by reading
 * `packages/runtime/src/v2/runtime/handlers/shared/sse-response.ts` and
 * `@ag-ui/encoder`):
 *   data: <json>\n\n
 *
 * Each event is a single-line JSON object with a `type` discriminator
 * (`RUN_STARTED`, `TEXT_MESSAGE_CHUNK`, `TOOL_CALL_START`, `TOOL_CALL_ARGS`,
 * `TOOL_CALL_END`, `TOOL_CALL_RESULT`, `RUN_FINISHED`, …). Tool-call names
 * live on `TOOL_CALL_START.toolCallName`. The parser also tolerates
 * multi-line `data:` records (per the SSE spec — concatenated with `\n` —
 * required for the malformed-chunk recovery test).
 */

import type { Page } from "playwright";

/* eslint-disable @typescript-eslint/no-explicit-any -- CDP payload typing
   intentionally unconstrained: we narrow at the read-site rather than
   importing the Protocol namespace which would tighten this module to a
   specific Playwright minor version. */

/**
 * Stream-timing summary. All numbers are wall-clock milliseconds.
 *
 * - `ttft_ms`        time from request issue → first chunk arrival.
 * - `inter_chunk_ms` gaps between successive chunk arrivals (length =
 *                    total_chunks - 1; empty when total_chunks ≤ 1).
 * - `p50_chunk_ms`   median of `inter_chunk_ms`. `0` when the array is
 *                    empty so consumers can do arithmetic without
 *                    branching on length.
 * - `total_chunks`   count of `Network.dataReceived` events (real wire
 *                    chunks, not parsed SSE events — usually fewer chunks
 *                    than events because TCP coalesces).
 * - `duration_ms`    last chunk timestamp − request-issue timestamp.
 */
export interface SseStreamProfile {
  ttft_ms: number;
  inter_chunk_ms: number[];
  p50_chunk_ms: number;
  total_chunks: number;
  duration_ms: number;
}

/**
 * Aggregate result the parity-compare engine (B11) consumes.
 *
 * - `toolCalls`        ordered names from `TOOL_CALL_START.toolCallName`.
 * - `streamProfile`    timing axis (see `SseStreamProfile`).
 * - `contractFields`   field-path → JS-native type. Path uses dotted
 *                      segments and `[]` for arrays — e.g.
 *                      `messages[].role` → "string". Null payload values
 *                      record as "null" (distinguishable from missing,
 *                      which simply doesn't appear in the map).
 * - `raw_event_count`  count of successfully parsed SSE records (NOT the
 *                      same as `total_chunks` — events ≥ chunks).
 */
export interface SseCapture {
  toolCalls: string[];
  streamProfile: SseStreamProfile;
  contractFields: Record<string, string>;
  raw_event_count: number;
}

/**
 * Caller-tunable knobs.
 *
 * - `endpointPattern`     URL filter for which response stream to watch.
 *                         Matches against the full URL (string `includes`
 *                         or regex `test`). Defaults to `/api/copilotkit/`
 *                         which covers the runtime SSE endpoints across
 *                         all 17 showcase integrations.
 * - `toolCallEventTypes`  SSE event-type values that signal a new tool-call
 *                         beginning. Defaults to `["TOOL_CALL_START"]`
 *                         which is the canonical ag-ui event; a list lets
 *                         a future custom transport extend without
 *                         forking the helper.
 */
export interface SseInterceptorOptions {
  endpointPattern?: string | RegExp;
  toolCallEventTypes?: string[];
}

/** Public handle returned by `attachSseInterceptor`. */
export interface SseInterceptorHandle {
  stop(): Promise<SseCapture>;
}

const DEFAULT_ENDPOINT_PATTERN = /\/api\/copilotkit\//;
const DEFAULT_TOOL_CALL_EVENT_TYPES = ["TOOL_CALL_START"];

/**
 * Internal record of a single SSE event extracted from the raw payload.
 * Discriminated on `kind` so consumers can branch exhaustively without
 * reaching into a free-form `Record<string, unknown>`.
 */
export type ParsedSseEvent =
  | { kind: "json"; raw: string; payload: Record<string, unknown> }
  | { kind: "non-json"; raw: string };

/**
 * Parse a raw SSE payload (potentially the entire response body) into a
 * list of events.
 *
 * - Tolerates multi-line `data:` records per the SSE spec — concatenated
 *   with `\n` between continuation lines and re-parsed as JSON.
 * - Returns malformed records as `kind: "non-json"` rather than throwing,
 *   so the malformed-chunk recovery test passes.
 * - Ignores SSE comment lines (lines starting with `:`) and `event:` /
 *   `id:` / `retry:` framing — runtime never emits those today, but
 *   skipping them keeps us forward-compatible.
 */
export function parseSseEvents(payload: string): ParsedSseEvent[] {
  const out: ParsedSseEvent[] = [];
  // SSE record separator is a blank line; per spec a record terminates on
  // \n\n or \r\n\r\n. Normalize CRLF first so the split below works on
  // both line endings.
  const normalized = payload.replace(/\r\n/g, "\n");
  const records = normalized.split(/\n\n+/);
  for (const record of records) {
    if (record.length === 0) continue;
    const dataLines: string[] = [];
    for (const line of record.split("\n")) {
      if (line.length === 0) continue;
      if (line.startsWith(":")) continue; // SSE comment
      if (line.startsWith("data:")) {
        // SSE spec: leading single space after the colon is stripped.
        const value = line.slice(5).startsWith(" ")
          ? line.slice(6)
          : line.slice(5);
        dataLines.push(value);
      }
      // Other framing lines (event:, id:, retry:) currently unused by
      // the runtime — skipping is intentional, not an oversight.
    }
    if (dataLines.length === 0) continue;
    const raw = dataLines.join("\n");
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        !Array.isArray(parsed)
      ) {
        out.push({
          kind: "json",
          raw,
          payload: parsed as Record<string, unknown>,
        });
      } else {
        // JSON literal that isn't an object (string, number, array, null).
        // Record as non-json so the contract walker can ignore it; tool
        // extraction also won't match.
        out.push({ kind: "non-json", raw });
      }
    } catch {
      out.push({ kind: "non-json", raw });
    }
  }
  return out;
}

/**
 * Walk the value tree and record every (path, type) pair seen.
 * Mutates `out` to keep the recursive call site allocation-free.
 *
 * Type strings are JS-native: "string" | "number" | "boolean" | "null"
 * | "object" | "array". Arrays use `[]` in the path so multiple elements
 * of differing shapes still all collapse to the same key — a parity
 * regression on field shape (e.g. role flipping from "user" string to
 * `{name:"user"}` object) shows up as a type mismatch on the same path.
 */
export function collectContractShape(
  value: unknown,
  path: string,
  out: Record<string, string>,
): void {
  if (value === null) {
    out[path] = "null";
    return;
  }
  if (Array.isArray(value)) {
    out[path] = "array";
    const childPath = `${path}[]`;
    for (const item of value) {
      collectContractShape(item, childPath, out);
    }
    return;
  }
  if (typeof value === "object") {
    if (path !== "") out[path] = "object";
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const child = path === "" ? k : `${path}.${k}`;
      collectContractShape(v, child, out);
    }
    return;
  }
  // Primitives.
  out[path] = typeof value;
}

/**
 * Extract tool-call names in arrival order from a parsed event list.
 *
 * A "tool-call name" is the string at one of these locations on a JSON
 * payload whose `type` matches one of `toolCallEventTypes`:
 *   - `toolCallName`            — ag-ui canonical (TOOL_CALL_START)
 *   - `name`                    — legacy / alternate transports
 *   - `tool_call.name`          — snake_case variant
 *   - `tool_use.name`           — Anthropic-style passthrough
 *
 * Walking all four is intentional: the spec's reading list flagged
 * uncertainty about the on-wire shape, and the parity-compare engine
 * needs to cope with reference implementations that haven't migrated to
 * ag-ui canonical naming yet. Order: first matching field wins per event.
 */
export function extractToolCallNames(
  events: ParsedSseEvent[],
  toolCallEventTypes: string[],
): string[] {
  const types = new Set(toolCallEventTypes);
  const names: string[] = [];
  for (const ev of events) {
    if (ev.kind !== "json") continue;
    const p = ev.payload;
    const evType = p["type"];
    if (typeof evType !== "string" || !types.has(evType)) continue;
    const name = pickToolCallName(p);
    if (name !== undefined) names.push(name);
  }
  return names;
}

function pickToolCallName(p: Record<string, unknown>): string | undefined {
  if (typeof p["toolCallName"] === "string") return p["toolCallName"];
  if (typeof p["name"] === "string") return p["name"];
  const tc = p["tool_call"];
  if (
    tc !== null &&
    typeof tc === "object" &&
    typeof (tc as Record<string, unknown>)["name"] === "string"
  ) {
    return (tc as Record<string, unknown>)["name"] as string;
  }
  const tu = p["tool_use"];
  if (
    tu !== null &&
    typeof tu === "object" &&
    typeof (tu as Record<string, unknown>)["name"] === "string"
  ) {
    return (tu as Record<string, unknown>)["name"] as string;
  }
  return undefined;
}

/**
 * Build the full `SseCapture` from a raw payload + per-chunk arrival
 * timestamps + the request-issue timestamp.
 *
 * Exported for unit testing the assembly logic in isolation from CDP.
 *
 * `chunkTimestampsMs` are absolute wall-clock ms (e.g. `Date.now()` or
 * `performance.timeOrigin + monotonicTime`); `requestStartMs` likewise.
 * Caller is responsible for supplying both in the same clock domain —
 * the helper does NOT mix monotonic and wall-clock values.
 */
export function assembleCapture(
  payload: string,
  chunkTimestampsMs: number[],
  requestStartMs: number,
  toolCallEventTypes: string[],
): SseCapture {
  const events = parseSseEvents(payload);
  const contractFields: Record<string, string> = {};
  let parsedCount = 0;
  for (const ev of events) {
    if (ev.kind === "json") {
      parsedCount++;
      collectContractShape(ev.payload, "", contractFields);
    }
  }
  const toolCalls = extractToolCallNames(events, toolCallEventTypes);
  const streamProfile = computeStreamProfile(chunkTimestampsMs, requestStartMs);
  return {
    toolCalls,
    streamProfile,
    contractFields,
    raw_event_count: parsedCount,
  };
}

/**
 * Compute the timing profile from a list of chunk arrival timestamps.
 *
 * Defensive guards:
 *   - empty timestamps → all-zeros profile (caller likely intercepted a
 *     stream that produced no data, e.g. an immediate 5xx).
 *   - single chunk → ttft + duration are valid, `inter_chunk_ms` empty,
 *     p50 = 0.
 */
export function computeStreamProfile(
  chunkTimestampsMs: number[],
  requestStartMs: number,
): SseStreamProfile {
  if (chunkTimestampsMs.length === 0) {
    return {
      ttft_ms: 0,
      inter_chunk_ms: [],
      p50_chunk_ms: 0,
      total_chunks: 0,
      duration_ms: 0,
    };
  }
  const sorted = [...chunkTimestampsMs].sort((a, b) => a - b);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const interChunk: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    interChunk.push(sorted[i]! - sorted[i - 1]!);
  }
  return {
    ttft_ms: Math.max(0, first - requestStartMs),
    inter_chunk_ms: interChunk,
    p50_chunk_ms: median(interChunk),
    total_chunks: sorted.length,
    duration_ms: Math.max(0, last - requestStartMs),
  };
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

function matchesEndpoint(url: string, pattern: string | RegExp): boolean {
  if (typeof pattern === "string") return url.includes(pattern);
  return pattern.test(url);
}

/**
 * Attach a CDP-based SSE interceptor to a Playwright page.
 *
 * The handler returned by `stop()` detaches all CDP listeners, fetches
 * the response body for the matched request (if any), and returns the
 * assembled capture. If no matching request was observed, the capture is
 * returned with empty fields and an all-zeros timing profile — the
 * parity engine can distinguish "no stream observed" from "stream with
 * zero tool calls" via `raw_event_count`.
 *
 * Concurrency note: this helper expects exactly one matching SSE request
 * during its lifetime. If multiple match, the first one wins (subsequent
 * matches are ignored). Callers that need to capture more than one
 * stream per page lifecycle should attach + detach around each.
 */
export async function attachSseInterceptor(
  page: Page,
  opts: SseInterceptorOptions = {},
): Promise<SseInterceptorHandle> {
  const endpointPattern = opts.endpointPattern ?? DEFAULT_ENDPOINT_PATTERN;
  const toolCallEventTypes =
    opts.toolCallEventTypes ?? DEFAULT_TOOL_CALL_EVENT_TYPES;

  // Newer Playwright versions expose `page.context().newCDPSession(page)`;
  // older ones only `browserContext.newCDPSession`. Both APIs return the
  // same shape, but the public type surface in playwright@1.59 is
  // `BrowserContext.newCDPSession(page)`.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");

  // The first request whose URL matches the pattern wins the slot; ignore
  // subsequent matches.
  let trackedRequestId: string | null = null;
  let requestStartMs = 0;
  const chunkTimestampsMs: number[] = [];
  let loadingFinished = false;

  const onRequestWillBeSent = (params: any): void => {
    if (trackedRequestId !== null) return;
    const url: string = params?.request?.url ?? "";
    if (!matchesEndpoint(url, endpointPattern)) return;
    trackedRequestId = String(params.requestId);
    // CDP gives `wallTime` (seconds since epoch) on requestWillBeSent —
    // use it directly so we're in the same domain as a Date.now() reading
    // taken later. Fallback to Date.now() if missing.
    const wallTime = typeof params.wallTime === "number" ? params.wallTime : 0;
    requestStartMs = wallTime > 0 ? wallTime * 1000 : Date.now();
  };

  const onDataReceived = (params: any): void => {
    if (trackedRequestId === null) return;
    if (String(params?.requestId) !== trackedRequestId) return;
    // `Network.dataReceived.timestamp` is monotonic seconds since some
    // arbitrary origin, NOT wall-clock. We don't have a direct conversion
    // available without `Network.requestWillBeSent.wallTime` + a paired
    // monotonic — so instead we record `Date.now()` at the moment we
    // observe the chunk. CDP delivery is fast enough that the additional
    // jitter (sub-millisecond on local, single-digit ms over the wire) is
    // dominated by network variance we're trying to measure anyway.
    chunkTimestampsMs.push(Date.now());
  };

  const onLoadingFinished = (params: any): void => {
    if (trackedRequestId === null) return;
    if (String(params?.requestId) !== trackedRequestId) return;
    loadingFinished = true;
  };

  const onLoadingFailed = (params: any): void => {
    if (trackedRequestId === null) return;
    if (String(params?.requestId) !== trackedRequestId) return;
    loadingFinished = true; // treat failed-with-data as "stream done"
  };

  cdp.on("Network.requestWillBeSent", onRequestWillBeSent);
  cdp.on("Network.dataReceived", onDataReceived);
  cdp.on("Network.loadingFinished", onLoadingFinished);
  cdp.on("Network.loadingFailed", onLoadingFailed);

  const stop = async (): Promise<SseCapture> => {
    let payload = "";
    if (trackedRequestId !== null) {
      // Wait briefly for loadingFinished if the caller stopped mid-stream
      // — gives the in-flight tail a chance to land before we request the
      // body. Not a hard sync point: if the stream is still flowing we'd
      // rather return a partial than block forever.
      const waitDeadline = Date.now() + 2_000;
      while (!loadingFinished && Date.now() < waitDeadline) {
        await new Promise((r) => setTimeout(r, 50));
      }
      try {
        const body = (await cdp.send("Network.getResponseBody", {
          requestId: trackedRequestId,
        })) as { body: string; base64Encoded: boolean };
        payload = body.base64Encoded
          ? Buffer.from(body.body, "base64").toString("utf-8")
          : body.body;
      } catch {
        // Body unavailable — most commonly because the request errored
        // before any bytes reached the renderer, OR because the page was
        // navigated/closed and Chromium evicted the body buffer. Return
        // an empty capture rather than throwing; parity engine treats
        // empty payload as "no stream content captured".
        payload = "";
      }
    }

    cdp.off("Network.requestWillBeSent", onRequestWillBeSent);
    cdp.off("Network.dataReceived", onDataReceived);
    cdp.off("Network.loadingFinished", onLoadingFinished);
    cdp.off("Network.loadingFailed", onLoadingFailed);
    try {
      await cdp.detach();
    } catch {
      // Already detached (page closed) — ignore.
    }

    return assembleCapture(
      payload,
      chunkTimestampsMs,
      requestStartMs > 0 ? requestStartMs : Date.now(),
      toolCallEventTypes,
    );
  };

  return { stop };
}
