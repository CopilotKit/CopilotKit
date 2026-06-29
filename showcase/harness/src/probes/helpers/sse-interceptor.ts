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

import type { Frame, Page } from "playwright";

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
 *                         or regex `test`). Defaults to
 *                         `/\/api\/copilotkit(\/|-|$|\?)/` so that all
 *                         five runtime URL shapes the v2 client emits
 *                         match (see `DEFAULT_ENDPOINT_PATTERN` for the
 *                         full enumeration); covers every showcase
 *                         integration without per-demo configuration.
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
  /**
   * Internal flag flipped to `true` once `doStop`'s teardown completes —
   * the CDP session is detached, listeners removed, payload assembled
   * and resolved. `attachSseInterceptor`'s cache-check treats a cached
   * handle with `consumed === true` as a cache MISS and creates a fresh
   * handle.
   *
   * Defense-in-depth alongside the `delete pageHandleCache.__hk_sse_attached`
   * in `doStop`: if the cache delete fails (e.g., the page object has been
   * collected, or another reference holds the same shape and re-publishes
   * the stale handle), the consumed flag still prevents
   * `attachSseInterceptor` from handing the dead handle back to a caller
   * that started a brand-new SSE stream on the same page lifecycle.
   */
  consumed?: boolean;
}

/**
 * Default URL filter for the SSE runtime endpoint.
 *
 * Must match every URL CopilotKit's v2 client actually hits — the
 * shapes that flow are:
 *
 *   (a) `/api/copilotkit`                            — v2 single-route
 *       transport (the showcase's default; runtimeUrl is hit verbatim
 *       with NO trailing slash and NO `/agent/<id>/run` suffix).
 *       `ProxiedCopilotRuntimeAgent` strips a trailing `/` from
 *       `runtimeUrl` and uses that exact string as the run URL when
 *       `transport === "single"` (`packages/core/src/agent.ts:117-125`).
 *   (b) `/api/copilotkit/agent/<id>/run`              — v2 REST
 *       transport (the URL `ProxiedCopilotRuntimeAgent` constructs in
 *       non-single mode at the same call site).
 *   (c) `/api/copilotkit/info`                        — v2 REST runtime
 *       info GET; not an SSE stream but kept under one filter so
 *       future probes don't have to re-derive what "the runtime URL"
 *       means.
 *   (d) `/api/copilotkit-<demo>` and
 *       `/api/copilotkit-<demo>/...`                  — per-demo
 *       dedicated runtime endpoints (declarative-hashbrown, ogui,
 *       multimodal, mcp-apps, auth, voice, beautiful-chat, …). Each
 *       has its own Next.js route handler; the v2 client still hits
 *       `<runtimeUrl>` in single mode and `<runtimeUrl>/agent/<id>/run`
 *       in REST mode.
 *
 * The previous filter `/\/api\/copilotkit\//` required a TRAILING
 * SLASH after `copilotkit` and so failed (a) entirely — the s7
 * mechanism-GREEN test used a `page.route` fake that served from
 * `…/api/copilotkit/agent/runtime` (an `/agent/…` URL that matches the
 * old filter), masking the production mismatch. Against the real
 * showcase runtime the wrapper saw a `/api/copilotkit` POST, ignored
 * it, and `__hk_runsFinished` stayed at 0 even though the assistant
 * rendered text. `waitForTurnComplete`'s SSE conjunct then never
 * fired and the turn timed out with reason=sse-missing.
 *
 * The new filter accepts `/api/copilotkit` followed by `/`, `-`,
 * end-of-string, or `?` so all five shapes above match while
 * `/api/copilotkit_underscore_suffix` or `/api/copilotkitfoo` still
 * fall through.
 */
const DEFAULT_ENDPOINT_PATTERN = /\/api\/copilotkit(\/|-|$|\?)/;
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
 *   - `tool_call.name`          — snake_case variant
 *   - `tool_use.name`           — Anthropic-style passthrough
 *   - `name`                    — legacy / alternate transports
 *
 * Walking all four is intentional: the spec's reading list flagged
 * uncertainty about the on-wire shape, and the parity-compare engine
 * needs to cope with reference implementations that haven't migrated to
 * ag-ui canonical naming yet.
 *
 * Order is load-bearing. `pickToolCallName` checks fields in this exact
 * precedence (first match wins per event):
 *
 *   1. `toolCallName` — PREFERRED. This is the canonical ag-ui
 *      event-level field; when present it is unambiguously the
 *      tool-call name (no risk of conflation with a step/event label).
 *   2. `tool_call.name` / `tool_use.name` — FALLBACK for transports
 *      that surface tool descriptors as nested objects rather than the
 *      ag-ui canonical top-level field. A `tool_call` / `tool_use`
 *      container is a strong (though not perfect) tool-call indicator,
 *      so it's moderately unambiguous.
 *   3. bare top-level `name` — LAST RESORT. This is the sharp edge:
 *      some transports include a top-level `name` for an event/step
 *      label alongside a structured tool descriptor, so picking `name`
 *      ahead of the structured variants would harvest the label
 *      instead of the actual tool name and poison the parity
 *      comparison's tool-call list. Only consult it after the
 *      structured variants have been exhausted.
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
  // 1) `toolCallName` — ag-ui canonical event-level field; preferred
  // when present. See the docstring above `extractToolCallNames` for
  // the full precedence rationale.
  if (typeof p["toolCallName"] === "string") return p["toolCallName"];
  // 2) Structured variants (`tool_call.name` / `tool_use.name`) —
  // fallback for transports that surface tool descriptors as nested
  // objects. Checked BEFORE bare `name` because some transports use
  // top-level `name` for an event/step label alongside a structured
  // tool descriptor; picking that label up before the structured
  // field would poison the parity comparison's tool-call list.
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
  // 3) Bare top-level `name` — last resort; could be a step/event
  // label rather than a tool name, so only consult after the
  // structured variants above.
  if (typeof p["name"] === "string") return p["name"];
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
 * Build the page-side init script source that:
 *
 *   (a) seeds `window.__hk_runsFinished = 0` so a `page.evaluate`
 *       read at any later point returns a defined number (never
 *       `undefined`), and
 *   (b) wraps `window.fetch` so that any matched SSE response has
 *       its body teed and parsed inline for `RUN_FINISHED` records,
 *       incrementing `window.__hk_runsFinished` per event observed.
 *
 * Implementation notes:
 *   - Passed to `page.addInitScript` as a STRING (not a function).
 *     Identical rationale to `init-scripts.ts`: tsx's TypeScript
 *     transform can inject helper symbols (`__name`, `_a`, …) into
 *     a function-form `addInitScript` payload that the page context
 *     cannot resolve, causing the script to register but silently
 *     no-op at document_start. A self-contained ES5-shape IIFE
 *     sidesteps the issue and matches the pattern s4 established in
 *     `installPrePaintFromEnv`.
 *   - The fetch wrapper tees the response body via
 *     `response.clone().body.getReader()` (the original stream still
 *     flows to the caller untouched — no buffering, no re-injection,
 *     same chunk timing the parity-compare engine measures). The
 *     clone path is parsed in a background async loop; counter
 *     updates land best-effort.
 *   - The page-side counter is independent of the Node-side CDP
 *     capture. `assembleCapture` (Node) still counts events at
 *     `stop()` time for `SseCapture.raw_event_count`; the page-side
 *     counter exists only to serve `waitForTurnComplete`'s
 *     `page.evaluate(() => __hk_runsFinished)` real-time conjunct.
 */
function buildPageSideCounterScript(endpointPattern: string | RegExp): string {
  // Serialize the pattern into a value the page-side script can
  // rebuild. We pass either a literal string or a RegExp-source +
  // flags pair so the page side can re-construct the RegExp.
  const patternLiteral =
    typeof endpointPattern === "string"
      ? JSON.stringify({ kind: "string", value: endpointPattern })
      : JSON.stringify({
          kind: "regex",
          source: endpointPattern.source,
          flags: endpointPattern.flags,
        });
  return `
    (function(patternSpec) {
      var g = globalThis;
      if (typeof g.__hk_runsFinished !== 'number') {
        g.__hk_runsFinished = 0;
      }
      // Already wrapped (e.g. multiple attachSseInterceptor calls in
      // one page lifecycle) — leave the existing wrapper in place.
      if (g.__hk_fetchWrapped === true) return;
      g.__hk_fetchWrapped = true;
      var pattern;
      try {
        if (patternSpec.kind === 'regex') {
          pattern = new RegExp(patternSpec.source, patternSpec.flags);
        } else {
          pattern = patternSpec.value;
        }
      } catch (_) {
        pattern = '/api/copilotkit/';
      }
      function matches(url) {
        if (!url) return false;
        if (typeof pattern === 'string') return url.indexOf(pattern) !== -1;
        try { return pattern.test(url); } catch (_) { return false; }
      }
      function urlOf(input) {
        if (typeof input === 'string') return input;
        if (input && typeof input === 'object') {
          if (typeof input.url === 'string') return input.url;
          try { return String(input); } catch (_) { return ''; }
        }
        return '';
      }
      function processChunk(buf, leftover) {
        // Concatenate any prior leftover, normalize CRLF, split on
        // blank-line record separators, increment for each
        // RUN_FINISHED-typed JSON payload observed. Returns the new
        // leftover (incomplete trailing record).
        var text = leftover + buf;
        text = text.split('\\r\\n').join('\\n');
        var idx = text.lastIndexOf('\\n\\n');
        var complete;
        var newLeftover;
        if (idx === -1) {
          complete = '';
          newLeftover = text;
        } else {
          complete = text.slice(0, idx);
          newLeftover = text.slice(idx + 2);
        }
        if (complete.length > 0) {
          var records = complete.split(/\\n\\n+/);
          for (var i = 0; i < records.length; i++) {
            var record = records[i];
            if (!record) continue;
            var lines = record.split('\\n');
            var dataParts = [];
            for (var j = 0; j < lines.length; j++) {
              var line = lines[j];
              if (!line) continue;
              if (line.charAt(0) === ':') continue;
              if (line.indexOf('data:') === 0) {
                var v = line.substring(5);
                if (v.charAt(0) === ' ') v = v.substring(1);
                dataParts.push(v);
              }
            }
            if (dataParts.length === 0) continue;
            var raw = dataParts.join('\\n');
            try {
              var parsed = JSON.parse(raw);
              if (parsed && typeof parsed === 'object' && parsed.type === 'RUN_FINISHED') {
                g.__hk_runsFinished = (g.__hk_runsFinished | 0) + 1;
              }
            } catch (_) {
              // Malformed record — skip silently. The Node-side
              // capture surfaces parse errors via raw_event_count.
            }
          }
        }
        return newLeftover;
      }
      var originalFetch = g.fetch;
      if (typeof originalFetch !== 'function') return;
      g.fetch = function(input, init) {
        var url = urlOf(input);
        var p = originalFetch.call(this, input, init);
        if (!matches(url)) return p;
        return p.then(function(response) {
          try {
            var cloned = response.clone();
            var body = cloned.body;
            if (!body || typeof body.getReader !== 'function') return response;
            var reader = body.getReader();
            var decoder = new TextDecoder();
            var leftover = '';
            function pump() {
              return reader.read().then(function(step) {
                if (step.done) {
                  // Flush any trailing complete record.
                  if (leftover.length > 0) {
                    leftover = processChunk('\\n\\n', leftover);
                  }
                  return;
                }
                var chunk = decoder.decode(step.value, { stream: true });
                leftover = processChunk(chunk, leftover);
                return pump();
              }).catch(function() { /* swallow — best-effort */ });
            }
            pump();
          } catch (_) {
            // Cloning failed (body already consumed, etc.) — leave
            // the response untouched; counter simply doesn't update
            // for this stream.
          }
          return response;
        });
      };
    })(${patternLiteral});
  `;
}

/**
 * Build the page-side init script that observes CopilotKit v2's
 * `data-copilot-running` attribute and latches the run lifecycle into
 * `window.__hk_copilotRunning` for `waitForTurnComplete`'s PRIMARY
 * done-signal.
 *
 * Why a page-side MutationObserver rather than a per-poll
 * `getAttribute` read: CopilotKit v2 renders
 * `data-copilot-running="true|false"` on `[data-testid="copilot-chat"]`
 * driven by the agent run lifecycle (RUN_STARTED → true, RUN_FINISHED →
 * false). On fast aimock replays the `true` window can be shorter than
 * `waitForTurnComplete`'s 100ms poll cadence, so a sampling read could
 * miss the `true` entirely and never observe the true→false transition.
 * A MutationObserver installed at document_start latches every
 * transition the moment it happens, so the SUT reads an
 * EDGE-ACCURATE summary regardless of poll timing:
 *
 *   - `attrPresent`     — true once the `[data-testid="copilot-chat"]`
 *                         element bearing `data-copilot-running` has been
 *                         seen in the DOM. Distinguishes the v2-chat case
 *                         (attribute present → DOM signal is trustworthy)
 *                         from the HEADLESS case (bring-your-own-UI demos
 *                         like `headless-simple` never render
 *                         `CopilotChatView`, so the attribute is absent
 *                         and the gate must fall back to the SSE counter).
 *   - `runningNow`      — the LIVE value of the attribute (true while a
 *                         run is in flight). `null` when never observed.
 *   - `sawRunningTrue`  — latched once the attribute has EVER gone "true".
 *                         The PRIMARY done-signal gates on the TRANSITION
 *                         (saw-true-then-stopped), NOT on a bare
 *                         `=== "false"` — because "false" is also the
 *                         never-started baseline state, which must not be
 *                         mistaken for a completed turn.
 *   - `runStartCount`   — count of false→true edges (RUN_STARTED). A
 *                         multi-step turn toggles false→true→false→true→…
 *                         between sub-runs, so the gate uses this to
 *                         reject completion on an INTERMEDIATE false (a
 *                         new run started after the last stop).
 *   - `lastStoppedAtMs` — wall-clock ms of the most recent true→false
 *                         edge (RUN_FINISHED). `0` when never stopped.
 *                         The gate requires the stop to have STAYED
 *                         stopped (no newer start) for the settle window.
 *
 * Idempotent (sentinel `__hk_runObserverInstalled`) and self-contained —
 * same string-IIFE rationale as `buildPageSideCounterScript`: a
 * function-form `addInitScript` payload can pick up tsx-injected helper
 * symbols the page context cannot resolve, silently no-op'ing at
 * document_start.
 */
function buildCopilotRunningObserverScript(): string {
  return `
    (function() {
      var g = globalThis;
      if (g.__hk_runObserverInstalled === true) return;
      g.__hk_runObserverInstalled = true;
      if (!g.__hk_copilotRunning) {
        g.__hk_copilotRunning = {
          attrPresent: false,
          runningNow: null,
          sawRunningTrue: false,
          runStartCount: 0,
          lastStoppedAtMs: 0
        };
      }
      var SEL = '[data-testid="copilot-chat"]';
      var ATTR = 'data-copilot-running';
      function readAttr() {
        try {
          var doc = g.document;
          if (!doc || typeof doc.querySelector !== 'function') return undefined;
          var el = doc.querySelector(SEL);
          if (!el || typeof el.getAttribute !== 'function') return undefined;
          var raw = el.getAttribute(ATTR);
          if (raw === null) return undefined;
          return raw === 'true';
        } catch (_) {
          return undefined;
        }
      }
      function record(val) {
        // val: true | false | undefined (attribute absent)
        var st = g.__hk_copilotRunning;
        if (val === undefined) return; // attribute not present on this read
        st.attrPresent = true;
        var prev = st.runningNow;
        if (val === true) {
          // false/null -> true edge = a (sub-)run started.
          if (prev !== true) {
            st.runStartCount = (st.runStartCount | 0) + 1;
          }
          st.sawRunningTrue = true;
          st.runningNow = true;
        } else {
          // -> false. Record a stop edge only when we were running (or
          // had ever run) so the never-started baseline 'false' does not
          // stamp a bogus lastStoppedAtMs.
          if (prev === true) {
            st.lastStoppedAtMs = Date.now();
          }
          st.runningNow = false;
        }
      }
      function scan() {
        record(readAttr());
      }
      // Prime once in case the element + attribute already exist at
      // observer-install time (e.g. addInitScript ran but the chat view
      // hydrated before our first mutation callback).
      scan();
      try {
        var mo = new MutationObserver(function() { scan(); });
        // Observe the whole subtree: the chat element may not exist yet
        // at document_start (React mounts it later), and once it does we
        // need attribute mutations on it. Observing document with
        // subtree + attribute filter catches both the initial mount and
        // every subsequent data-copilot-running flip.
        var target = g.document && g.document.documentElement
          ? g.document.documentElement
          : g.document;
        if (target && mo && typeof mo.observe === 'function') {
          mo.observe(target, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: [ATTR]
          });
        }
      } catch (_) {
        // MutationObserver unavailable (ancient/headless shell) — the
        // primed scan above still seeds whatever was present at install,
        // and waitForTurnComplete's per-poll read falls back gracefully.
      }
    })();
  `;
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

  // Page-level idempotency. `d6-all-pills.ts` calls
  // `attachSseInterceptor` on every `page.goto(...)` to re-seed the
  // page-side counter and Node-side CDP capture for the new run.
  // Without a guard each call would:
  //   (a) re-register the addInitScript (page-side counter script
  //       accumulates registrations, even though the `__hk_fetchWrapped`
  //       IIFE-internal sentinel prevents the wrapper from double-
  //       installing on the live page),
  //   (b) open a fresh CDP session, register Network.enable, and attach
  //       four listeners — and the returned handle from the prior call
  //       is dropped at the call site, leaking the session.
  // Cache the handle on the page object and return it on subsequent
  // calls so we install everything exactly once per page lifecycle.
  //
  // Post-stop cache invalidation (r6f1): once a handle's `stop()` has
  // run, the CDP session is detached and `stopPromise` is permanently
  // resolved. If a caller later attaches a NEW SSE stream on the same
  // page lifecycle (e.g., re-uses a page across separate captures),
  // returning the cached, already-stopped handle would silently hand
  // them the FIRST stream's capture (cached resolved promise) AND
  // never instrument the second stream (CDP already detached). Two
  // layers of defense:
  //   (a) `doStop` deletes `pageHandleCache.__hk_sse_attached` after
  //       teardown completes, so the next attach call sees no cache;
  //   (b) the handle carries a `consumed` flag flipped by `doStop`;
  //       this check treats a cached-but-consumed handle as a cache
  //       MISS, in case (a) fails to clear the cache (e.g., the page
  //       object has been collected or another reference holds the
  //       same shape).
  const pageHandleCache = page as unknown as {
    __hk_sse_attached?: SseInterceptorHandle;
  };
  const cached = pageHandleCache.__hk_sse_attached;
  if (cached !== undefined && cached.consumed !== true) {
    return cached;
  }

  // Page-side counter: seed `window.__hk_runsFinished = 0` at
  // document_start and wrap `fetch` so any matched SSE response's
  // body is teed and parsed inline. This is what
  // `waitForTurnComplete` reads via
  // `page.evaluate(() => __hk_runsFinished)`. Independent of the
  // Node-side CDP capture below — that path still produces
  // `SseCapture.raw_event_count` at `stop()`-time for the parity
  // engine, and stays the authoritative end-of-run count.
  await page.addInitScript(buildPageSideCounterScript(endpointPattern));

  // Page-side run-lifecycle observer: latch CopilotKit v2's
  // `data-copilot-running` attribute transitions into
  // `window.__hk_copilotRunning` so `waitForTurnComplete` has a
  // TRANSPORT-INDEPENDENT (no fetch-monkeypatch) PRIMARY done-signal.
  // Rides the SAME page lifecycle as the SSE counter above so the two
  // signals are always co-present (the gate prefers the DOM signal when
  // `attrPresent` and falls back to the fetch counter when absent —
  // headless bring-your-own-UI demos). Idempotent on the page side via
  // its own `__hk_runObserverInstalled` sentinel.
  await page.addInitScript(buildCopilotRunningObserverScript());

  // Newer Playwright versions expose `page.context().newCDPSession(page)`;
  // older ones only `browserContext.newCDPSession`. Both APIs return the
  // same shape, but the public type surface in playwright@1.59 is
  // `BrowserContext.newCDPSession(page)`.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");

  // The first request whose URL matches the pattern wins the slot; ignore
  // subsequent matches.
  //
  // These five vars (incl. `payload` declared below) are the per-stream
  // tracking state that the `framenavigated` listener resets on a
  // cold-start retry / reload — see `onFrameNavigated` further down for
  // the why.
  let trackedRequestId: string | null = null;
  let requestStartMs = 0;
  const chunkTimestampsMs: number[] = [];
  let loadingFinished = false;
  // `payload` is hoisted into the closure so the framenavigated reset
  // can clear it. `doStop` assigns into the same variable when it
  // fetches the final response body from CDP.
  let payload = "";

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

  // Cold-start retry recovery: `runConversation` will `page.reload()`
  // when turn 1 fails to stream, but the CDP session and the
  // surrounding closure persist across the reload. Without resetting
  // the per-stream tracking vars, `trackedRequestId` stays pinned to
  // the pre-reload (now-defunct) request — the first matching
  // post-reload request is silently ignored, AND `getResponseBody`
  // for the dead request ID will fail because Chromium evicts the
  // response body buffer after main-frame navigation. Net effect:
  // D6 capture for the retried turn is empty/incorrect with no
  // operator-visible signal.
  //
  // Reset on every main-frame `framenavigated`. Subframe navigations
  // (iframes, sandboxed widgets) do NOT touch the SSE stream and
  // must NOT trigger a reset, so we gate on `frame === page.mainFrame()`.
  const onFrameNavigated = (frame: Frame): void => {
    if (frame !== page.mainFrame()) return;
    // Emit a structured signal so the operator can correlate a
    // retry/reload with the tracking-state reset. `console.debug`
    // matches the surrounding helper's preference for low-volume
    // diagnostic lines; the same prefix is used at log-grep time
    // by the parity engine's debug pipeline.
    // eslint-disable-next-line no-console
    console.debug(
      "[sse-interceptor] mainFrame framenavigated — resetting per-stream tracking state",
      { url: frame.url(), hadTrackedRequest: trackedRequestId !== null },
    );
    trackedRequestId = null;
    requestStartMs = 0;
    chunkTimestampsMs.length = 0;
    loadingFinished = false;
    payload = "";
  };
  page.on("framenavigated", onFrameNavigated);

  // `stop()` may be invoked twice in practice: once explicitly by the
  // caller (to read the capture) and once by the page-close listener
  // installed below (belt-and-suspenders cleanup if the caller drops
  // the handle, as `d6-all-pills.ts` does). Cache the first invocation's
  // promise so re-entry returns the same capture and the CDP detach +
  // listener-off calls run exactly once.
  let stopPromise: Promise<SseCapture> | null = null;
  const stop = (): Promise<SseCapture> => {
    if (stopPromise !== null) return stopPromise;
    stopPromise = doStop();
    return stopPromise;
  };
  const doStop = async (): Promise<SseCapture> => {
    // Detached FIRST so a navigation between here and getResponseBody can't wipe payload mid-flight (r4f4).
    try {
      page.off("framenavigated", onFrameNavigated);
    } catch {
      // Page already closed — `off` may throw on a torn-down Page; ignore.
    }

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

    // Post-stop cache invalidation (r6f1). Two complementary signals so
    // a subsequent `attachSseInterceptor(page)` doesn't hand the
    // already-detached handle back to a caller starting a NEW SSE
    // stream on the same page lifecycle:
    //   (1) flip the handle's `consumed` flag, so even if our cache
    //       delete below silently fails the attach-side check still
    //       sees the consumed handle and treats it as a cache miss;
    //   (2) delete the page-side cache entry so the next attach call
    //       creates a fresh handle from scratch. Wrap in try/catch
    //       because the page object may have been GC'd (close
    //       handler ran the same `stop()`).
    handle.consumed = true;
    try {
      delete pageHandleCache.__hk_sse_attached;
    } catch {
      // Page object collected or property non-configurable — the
      // `consumed` flag above is the load-bearing path; this delete
      // is defense in depth.
    }

    return assembleCapture(
      payload,
      chunkTimestampsMs,
      requestStartMs > 0 ? requestStartMs : Date.now(),
      toolCallEventTypes,
    );
  };

  const handle: SseInterceptorHandle = { stop, consumed: false };
  pageHandleCache.__hk_sse_attached = handle;

  // End-of-page cleanup. The idempotency guard above keeps the CDP
  // session from accumulating across same-page re-attaches, but on
  // page close we still want the session detached and the listeners
  // released. `stop()` is internally idempotent (see `stopPromise`
  // above) so an explicit caller `stop()` followed by this close-fired
  // `stop()` is a no-op on the second call.
  page.on("close", () => {
    void stop().catch(() => {
      // Page already gone — CDP detach + getResponseBody will reject;
      // swallow so we don't surface an unhandled rejection during
      // test teardown.
    });
  });

  return handle;
}
