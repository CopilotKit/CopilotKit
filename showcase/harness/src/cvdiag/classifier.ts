/**
 * classifier.ts — the full 8-class CVDIAG flap classifier (L2-A). Read-only
 * over a `test_id`'s collected `CvdiagEnvelope[]`, it assigns exactly one of the
 * eight root-cause classes (a)–(h) from the spec §1 taxonomy, or
 * `unclassified` when no rule matches. The classifier has NO side effects: it
 * neither mutates its input nor performs I/O.
 *
 * Spec: 2026-06-18-flap-observability.md §8 Phase-6 "Classifier discriminator
 * rules (complete set)" (verbatim), §1 (8 root-cause classes a–h), §3 Layer-4
 * edge-header signature table (class-(c) single-row + multi-row patterns), §5
 * cross-layer ±50ms clock tolerance. Plan unit: L2-A.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * RULE PRECEDENCE
 *   Rules are evaluated in a fixed, documented order so that an event set
 *   matching more than one rule's preconditions resolves deterministically to
 *   the most specific / highest-priority class. The order mirrors the spec's
 *   discrimination intent:
 *     (f) probe-runner-crash   — terminal runner failure dominates everything
 *                                else (the probe never observed a fair trial).
 *     (c) edge-interference    — an edge mitigation/rate-limit/RST is the
 *                                proximate cause regardless of downstream shape.
 *     (h) provider-empty       — provider returned a structurally-empty 200.
 *     (g) aimock-fixture-mismatch — aimock layer fault (DEGRADES; see below).
 *     (a) slow-first-token     — backend WAS alive past the probe timeout
 *                                (late first_byte / late response / fresh
 *                                heartbeat); only the timeout was too short.
 *     (b) stalled-backend      — LLM call started, never returned, heartbeat
 *                                stale: the backend hung.
 *     (d) strict-harness       — backend completed OK with SSE events and the
 *                                container holds non-text alternate content.
 *     (e) frontend-hydration   — backend completed OK, SSE reached the probe,
 *                                no first token, empty container, console error.
 *   `unclassified` — nothing matched; full evidence dump returned.
 *
 *   (a) is checked before (b) because both key on first-token absence; (a)'s
 *   discriminator is the PRESENCE of a liveness signal (late first_byte, late
 *   call.response, or a heartbeat within 30s of timeout). (a) fires ONLY when
 *   such a signal proves the backend was alive past the probe timeout; absent
 *   any liveness signal control falls through to (b) (the backend hung). Per
 *   spec §8 rule (a): "If neither heartbeat nor late first_byte nor late
 *   call.response is observed, class is (b) not (a)."
 *
 * ──────────────────────────────────────────────────────────────────────────
 * RULE (g) GRACEFUL DEGRADATION (D2 — aimock fast-follow not yet shipped)
 *   Spec rule (g) keys on `aimock.match.decision.fixture_id=null` AND
 *   `aimock.response.complete.total_bytes < 16`. Those `aimock.*` data-plane
 *   boundaries are NOT emitted by any in-repo writer until the aimock
 *   fast-follow (separate repo) ships — they will simply be ABSENT from the
 *   event set today. The classifier degrades gracefully:
 *     - When the required `aimock.*` boundaries are ABSENT, rule (g) does NOT
 *       fire (it never produces a FALSE (g) match from missing data). Control
 *       falls through to the remaining rules, ultimately `unclassified`.
 *     - When the `aimock.*` boundaries ARE present (post-fast-follow) and match
 *       the predicate, rule (g) fires at FULL confidence
 *       (`confidence: "high"`).
 *   A future enhancement may surface a LOWER-confidence (g) heuristic from the
 *   existing harness journal-join signal (503 / `no_fixture_match` /
 *   `header_present=false`); that signal is NOT part of the `CvdiagEnvelope`
 *   stream this classifier consumes, so it is intentionally out of scope here
 *   and noted for the CLI layer (L2-B) which has access to the journal join.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * CROSS-LAYER CLOCK TOLERANCE (spec §5 R3-F4)
 *   `mono_ns` is authoritative for WITHIN-layer ordering. CROSS-layer ordering
 *   uses wall-clock `ts` and is reliable only to ±50ms. Any comparison of a
 *   timestamp emitted in one layer against a timestamp emitted in another layer
 *   (e.g. "did the backend's first_byte arrive after the probe's timeout?")
 *   applies `CROSS_LAYER_TOLERANCE_MS` slack so a sub-50ms wall-clock skew does
 *   not flip a classification.
 */

import type { CvdiagEnvelope, CvdiagBoundary, CvdiagLayer } from "./schema.js";

/**
 * The d4 chat-roundtrip probe DOM-poll timeout (spec §1: "times out after 60s",
 * `d4-chat-roundtrip.ts`). The "slow first token" (a) / "stalled backend" (b)
 * discrimination is anchored on this window. Defined locally (not imported)
 * because it is a classifier-policy constant, not part of the canonical schema
 * foundation (which this module imports types-only and must not edit).
 */
export const PROBE_TIMEOUT_MS = 60_000;

/**
 * Cross-layer wall-clock skew tolerance (spec §5 R3-F4): `mono_ns` is
 * authoritative WITHIN a layer; CROSS-layer ordering via wall-clock `ts` is
 * reliable only to ±50ms. Any cross-layer timestamp comparison applies this
 * slack so a sub-50ms skew never flips a classification.
 */
export const CROSS_LAYER_TOLERANCE_MS = 50;

/** The eight root-cause classes (spec §1 a–h) plus the escape hatch. */
export type FlapClass =
  | "slow-first-token" // (a)
  | "stalled-backend" // (b)
  | "edge-interference" // (c)
  | "strict-harness" // (d)
  | "frontend-hydration" // (e)
  | "probe-runner-crash" // (f)
  | "aimock-fixture-mismatch" // (g)
  | "provider-empty" // (h)
  | "unclassified";

/** Spec §1 letter for each class, for human-readable rendering. */
export const FLAP_CLASS_LETTER: Record<FlapClass, string> = {
  "slow-first-token": "a",
  "stalled-backend": "b",
  "edge-interference": "c",
  "strict-harness": "d",
  "frontend-hydration": "e",
  "probe-runner-crash": "f",
  "aimock-fixture-mismatch": "g",
  "provider-empty": "h",
  unclassified: "-",
};

/**
 * Confidence of the assignment. `high` = a full-data rule matched.
 * `heuristic-journal` is RESERVED for a future lower-confidence rule-(g) path
 * sourced from the harness journal join (see header); this classifier never
 * emits it today because the journal signal is not on the `CvdiagEnvelope`
 * stream.
 */
export type ClassificationConfidence = "high" | "heuristic-journal";

export interface ClassificationResult {
  /** The classified flap class (or `unclassified`). */
  flapClass: FlapClass;
  /** Spec §1 letter (`a`–`h`, or `-` for unclassified). */
  letter: string;
  /** Confidence in the assignment. */
  confidence: ClassificationConfidence;
  /** Human-readable one-line rationale for the assignment. */
  reason: string;
  /**
   * Class-(c) only: the matched edge sub-cause label(s) from the §3 signature
   * table. Empty for every other class.
   */
  edgeSubCauses: string[];
  /**
   * Evidence dump. ALWAYS populated (for `unclassified` it is the full
   * boundary inventory + key derived facts so an analyst can triage by data).
   */
  evidence: ClassificationEvidence;
}

export interface ClassificationEvidence {
  /** The `test_id` classified (echoed from the first event, or `"<none>"`). */
  testId: string;
  /** Count of events seen, by layer. */
  eventCountByLayer: Record<CvdiagLayer, number>;
  /** Every boundary literal observed, with its occurrence count. */
  boundaryHistogram: Partial<Record<CvdiagBoundary, number>>;
  /** Derived facts the rules keyed on (present so `unclassified` is debuggable). */
  facts: {
    probeFirstTokenSeen: boolean;
    probeExitOutcome: string | null;
    probeExitErrorClass: string | null;
    probeSseEventCount: number;
    probeAlternateContentNonEmpty: boolean;
    probeConsoleErrorCount: number;
    backendResponseOutcome: string | null;
    backendResponseSseEventCount: number | null;
    backendSseEventCount: number;
    backendLlmCallStartSeen: boolean;
    backendLlmCallResponseSeen: boolean;
    backendLlmCallResponseTokenCount: number | null;
    backendLlmCallResponseLatencyMs: number | null;
    backendSseFirstByteDeltaMs: number | null;
    lastHeartbeatElapsedMs: number | null;
    aimockBoundariesPresent: boolean;
    aimockFixtureId: string | null | undefined;
    aimockResponseTotalBytes: number | null;
    edgeSingleRowMatches: string[];
    edgeMultiRowMatches: string[];
  };
}

// ── Probe-runner error-class set (spec §8 rule (f)) ─────────────────────────
//
// Errors that indicate the PROBE RUNNER itself crashed / could not complete a
// fair trial (Playwright context crash, navigation race, runner-host
// exhaustion, an uncaught throw inside the poll loop). Matching is
// case-insensitive substring against `probe.exit`'s `error_class` (and the
// `probe.network.error` / probe-side error fields when present).
export const PROBE_RUNNER_ERROR_CLASSES = [
  "browsercontextcrash",
  "browser_context_crash",
  "targetclosed",
  "target_closed",
  "page_crash",
  "pagecrash",
  "navigation",
  "evaluate_throw",
  "evaluatethrow",
  "runner_oom",
  "oom",
  "resource_exhaustion",
  "context_destroyed",
  "contextdestroyed",
  "protocolerror",
  "protocol_error",
  "playwright",
] as const;

// ── Internal: typed metadata accessors (no `as any`) ────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNumber(meta: Record<string, unknown>, key: string): number | null {
  const v = meta[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function readString(meta: Record<string, unknown>, key: string): string | null {
  const v = meta[key];
  return typeof v === "string" ? v : null;
}

function metaOf(event: CvdiagEnvelope): Record<string, unknown> {
  return isRecord(event.metadata) ? event.metadata : {};
}

// ── Internal: event index ───────────────────────────────────────────────────

/**
 * A pre-computed, read-only view of one `test_id`'s events: events grouped by
 * boundary (preserving emit order), plus the derived facts the rules consume.
 * Building this once keeps each rule O(1) over the facts rather than
 * re-scanning the event list.
 */
interface EventIndex {
  testId: string;
  byBoundary: Map<CvdiagBoundary, CvdiagEnvelope[]>;
  eventCountByLayer: Record<CvdiagLayer, number>;
  boundaryHistogram: Partial<Record<CvdiagBoundary, number>>;
}

function buildIndex(events: CvdiagEnvelope[]): EventIndex {
  const byBoundary = new Map<CvdiagBoundary, CvdiagEnvelope[]>();
  const eventCountByLayer: Record<CvdiagLayer, number> = {
    probe: 0,
    backend: 0,
    aimock: 0,
  };
  const boundaryHistogram: Partial<Record<CvdiagBoundary, number>> = {};
  let testId = "<none>";

  for (const ev of events) {
    if (testId === "<none>" && typeof ev.test_id === "string" && ev.test_id) {
      testId = ev.test_id;
    }
    const list = byBoundary.get(ev.boundary);
    if (list) {
      list.push(ev);
    } else {
      byBoundary.set(ev.boundary, [ev]);
    }
    if (ev.layer in eventCountByLayer) {
      eventCountByLayer[ev.layer] += 1;
    }
    boundaryHistogram[ev.boundary] = (boundaryHistogram[ev.boundary] ?? 0) + 1;
  }

  return { testId, byBoundary, eventCountByLayer, boundaryHistogram };
}

/**
 * Return the EARLIEST event for `boundary` by `mono_ns` (within-layer
 * authoritative ordering per the header + spec §5). The grouped lists preserve
 * array-INSERTION order, which can diverge from emit order when rows arrive
 * out-of-order or are duplicated; selecting the mono_ns-minimum keeps timing
 * facts (first_byte delta, call.response latency, etc.) deterministic so a
 * reordered/duplicate row cannot flip (a)↔(b). Falls back to the insertion
 * order only when no row carries a finite `mono_ns`.
 */
function first(
  idx: EventIndex,
  boundary: CvdiagBoundary,
): CvdiagEnvelope | undefined {
  const list = idx.byBoundary.get(boundary);
  if (!list || list.length === 0) return undefined;
  let earliest: CvdiagEnvelope | undefined;
  for (const ev of list) {
    if (typeof ev.mono_ns !== "number" || !Number.isFinite(ev.mono_ns)) {
      continue;
    }
    if (earliest === undefined || ev.mono_ns < earliest.mono_ns) {
      earliest = ev;
    }
  }
  return earliest ?? list[0];
}

function all(idx: EventIndex, boundary: CvdiagBoundary): CvdiagEnvelope[] {
  return idx.byBoundary.get(boundary) ?? [];
}

function has(idx: EventIndex, boundary: CvdiagBoundary): boolean {
  return (idx.byBoundary.get(boundary)?.length ?? 0) > 0;
}

function count(idx: EventIndex, boundary: CvdiagBoundary): number {
  return idx.byBoundary.get(boundary)?.length ?? 0;
}

// ── Edge-header signature scan (class (c), spec §3 Layer-4 table) ───────────

const CF_MITIGATED_CHALLENGE = new Set(["challenge", "jschallenge"]);

/** Single-row edge-interference patterns over one event's `edge_headers`. */
function scanEdgeSingleRow(events: CvdiagEnvelope[]): string[] {
  const matches: string[] = [];
  for (const ev of events) {
    const eh = ev.edge_headers;
    if (!isRecord(eh)) continue;

    const cfMitigated =
      typeof eh["cf-mitigated"] === "string" ? eh["cf-mitigated"] : null;
    const retryAfter =
      typeof eh["retry-after"] === "string" ? eh["retry-after"] : null;
    const via = typeof eh["via"] === "string" ? eh["via"] : null;

    if (cfMitigated && CF_MITIGATED_CHALLENGE.has(cfMitigated.toLowerCase())) {
      matches.push("WAF Managed Challenge (POST→GET transform risk)");
    }
    if (cfMitigated && cfMitigated.toLowerCase() === "block") {
      matches.push("WAF hard block");
    }
    // retry-after present + 4xx/5xx. The HTTP status lives in per-boundary
    // metadata (`http_status` / `status` / `response_status`); a present
    // retry-after on an error-outcome event is the rate-limit signature.
    if (retryAfter) {
      const meta = metaOf(ev);
      const status =
        readNumber(meta, "http_status") ??
        readNumber(meta, "status") ??
        readNumber(meta, "response_status");
      const isErrStatus =
        (status !== null && status >= 400) ||
        ev.outcome === "err" ||
        ev.outcome === "timeout";
      if (isErrStatus) {
        matches.push("Rate limit (retry-after + 4xx/5xx)");
      }
    }
    if (via && /\b(squid|varnish|nginx-proxy|unknown-proxy)\b/i.test(via)) {
      matches.push("Proxy chain anomaly");
    }
  }
  return dedupe(matches);
}

/**
 * Multi-row aggregation (class (c)): `cf-ray` differs across the joined
 * `*.request.ingress` + `*.response.complete` events for the same `test_id` on
 * the same Cloudflare-fronted hop. Predicate:
 * `count(distinct edge_headers.cf-ray) > 1` over that joined boundary set.
 * Grouped per (layer) so the "same Cloudflare-fronted hop" constraint holds —
 * a probe-hop cf-ray differing from a backend-hop cf-ray is EXPECTED (different
 * hops) and must NOT trip the aggregator. (spec §3 multi-row table)
 */
function scanEdgeMultiRow(idx: EventIndex): string[] {
  const matches: string[] = [];
  const joinBoundaries: CvdiagBoundary[] = [
    "probe.network.response",
    "backend.request.ingress",
    "backend.response.complete",
    "aimock.request.ingress",
    "aimock.response.complete",
  ];

  // Group cf-ray values per layer (one layer == one Cloudflare-fronted hop).
  const rayByLayer = new Map<CvdiagLayer, Set<string>>();
  for (const boundary of joinBoundaries) {
    for (const ev of all(idx, boundary)) {
      const eh = ev.edge_headers;
      if (!isRecord(eh)) continue;
      const ray = typeof eh["cf-ray"] === "string" ? eh["cf-ray"] : null;
      if (!ray) continue;
      const set = rayByLayer.get(ev.layer) ?? new Set<string>();
      set.add(ray);
      rayByLayer.set(ev.layer, set);
    }
  }

  for (const [, rays] of rayByLayer) {
    if (rays.size > 1) {
      matches.push("Cross-PoP routing instability (cf-ray mismatch)");
    }
  }
  return dedupe(matches);
}

function dedupe(xs: string[]): string[] {
  return Array.from(new Set(xs));
}

// ── Fact extraction ──────────────────────────────────────────────────────────

interface DerivedFacts {
  probeFirstTokenSeen: boolean;
  probeExitOutcome: string | null;
  probeExitErrorClass: string | null;
  probeSseEventCount: number;
  probeAlternateContentNonEmpty: boolean;
  probeConsoleErrorCount: number;
  backendResponseOutcome: string | null;
  backendResponseSseEventCount: number | null;
  backendSseEventCount: number;
  backendLlmCallStartSeen: boolean;
  backendLlmCallResponseSeen: boolean;
  backendLlmCallResponseTokenCount: number | null;
  backendLlmCallResponseLatencyMs: number | null;
  backendSseFirstByteDeltaMs: number | null;
  lastHeartbeatElapsedMs: number | null;
  aimockBoundariesPresent: boolean;
  aimockFixtureId: string | null | undefined;
  aimockResponseTotalBytes: number | null;
  edgeSingleRowMatches: string[];
  edgeMultiRowMatches: string[];
}

function extractFacts(idx: EventIndex): DerivedFacts {
  // probe
  const probeFirstTokenSeen = has(idx, "probe.dom.firsttoken");
  const probeExit = first(idx, "probe.exit");
  const probeExitMeta = probeExit ? metaOf(probeExit) : {};
  const probeExitOutcome = probeExit
    ? (readString(probeExitMeta, "terminal_outcome") ??
      probeExit.outcome ??
      null)
    : null;
  // Runner error class for rule (f). A probe-runner crash can surface in EITHER
  // signal: a `probe.network.error` carries a typed `error_class`, while a
  // `probe.exit{outcome:err}` may carry one too (best-effort — the canonical
  // schema declares only `terminal_outcome` on probe.exit, but a crashing
  // runner can stamp an additional `error_class` we accept opportunistically).
  // Prefer the network-error class when both are present (it is the
  // schema-declared home of the field); fall back to the probe.exit class.
  const probeNetErr = first(idx, "probe.network.error");
  const probeNetErrorClass = probeNetErr
    ? readString(metaOf(probeNetErr), "error_class")
    : null;
  const probeExitOwnErrorClass = probeExit
    ? readString(probeExitMeta, "error_class")
    : null;
  const probeExitErrorClass = probeNetErrorClass ?? probeExitOwnErrorClass;
  const probeSseEventCount = count(idx, "probe.sse.event");

  let probeAlternateContentNonEmpty = false;
  const altContent = first(idx, "probe.dom.alternate_content");
  if (altContent) {
    const hist = metaOf(altContent)["child_type_histogram"];
    if (isRecord(hist) && Object.keys(hist).length > 0) {
      // non-empty iff at least one bucket has a positive count
      probeAlternateContentNonEmpty = Object.values(hist).some(
        (n) => typeof n === "number" && n > 0,
      );
    }
  }
  const probeConsoleErrorCount = count(idx, "probe.console.error");

  // backend
  const backendResponse = first(idx, "backend.response.complete");
  const backendResponseOutcome = backendResponse
    ? (backendResponse.outcome ?? null)
    : null;
  const backendResponseSseEventCount = backendResponse
    ? readNumber(metaOf(backendResponse), "sse_event_count")
    : null;
  const backendSseEventCount = count(idx, "backend.sse.event");
  const backendLlmCallStartSeen = has(idx, "backend.llm.call.start");
  const llmResponse = first(idx, "backend.llm.call.response");
  const backendLlmCallResponseSeen = llmResponse !== undefined;
  const backendLlmCallResponseTokenCount = llmResponse
    ? readNumber(metaOf(llmResponse), "response_token_count")
    : null;
  const backendLlmCallResponseLatencyMs = llmResponse
    ? readNumber(metaOf(llmResponse), "latency_ms")
    : null;
  const firstByte = first(idx, "backend.sse.first_byte");
  const backendSseFirstByteDeltaMs = firstByte
    ? readNumber(metaOf(firstByte), "delta_ms_from_ingress")
    : null;

  // last heartbeat: max elapsed_ms_since_start across all heartbeats
  let lastHeartbeatElapsedMs: number | null = null;
  for (const hb of all(idx, "backend.llm.call.heartbeat")) {
    const elapsed = readNumber(metaOf(hb), "elapsed_ms_since_start");
    if (elapsed !== null) {
      lastHeartbeatElapsedMs =
        lastHeartbeatElapsedMs === null
          ? elapsed
          : Math.max(lastHeartbeatElapsedMs, elapsed);
    }
  }

  // aimock (DEGRADES — may be entirely absent today)
  const aimockBoundariesPresent =
    has(idx, "aimock.match.decision") ||
    has(idx, "aimock.response.complete") ||
    has(idx, "aimock.request.ingress");
  const aimockDecision = first(idx, "aimock.match.decision");
  // `fixture_id` is explicitly nullable in the schema; distinguish
  // "present-and-null" (undefined-key vs null-value) carefully:
  let aimockFixtureId: string | null | undefined = undefined;
  if (aimockDecision) {
    const meta = metaOf(aimockDecision);
    if ("fixture_id" in meta) {
      const v = meta["fixture_id"];
      aimockFixtureId = typeof v === "string" ? v : null;
    }
  }
  const aimockResponse = first(idx, "aimock.response.complete");
  const aimockResponseTotalBytes = aimockResponse
    ? readNumber(metaOf(aimockResponse), "total_bytes")
    : null;

  // edge scans
  const allEvents: CvdiagEnvelope[] = [];
  for (const list of idx.byBoundary.values()) allEvents.push(...list);
  const edgeSingleRowMatches = scanEdgeSingleRow(allEvents);
  const edgeMultiRowMatches = scanEdgeMultiRow(idx);

  return {
    probeFirstTokenSeen,
    probeExitOutcome,
    probeExitErrorClass,
    probeSseEventCount,
    probeAlternateContentNonEmpty,
    probeConsoleErrorCount,
    backendResponseOutcome,
    backendResponseSseEventCount,
    backendSseEventCount,
    backendLlmCallStartSeen,
    backendLlmCallResponseSeen,
    backendLlmCallResponseTokenCount,
    backendLlmCallResponseLatencyMs,
    backendSseFirstByteDeltaMs,
    lastHeartbeatElapsedMs,
    aimockBoundariesPresent,
    aimockFixtureId,
    aimockResponseTotalBytes,
    edgeSingleRowMatches,
    edgeMultiRowMatches,
  };
}

// ── Rule predicates ──────────────────────────────────────────────────────────

/**
 * (f) probe-runner crash. Highest precedence: a terminal runner failure
 * dominates everything else. Fires when a probe-runner error class is observed
 * on EITHER signal — a `probe.exit{outcome:"err"}` OR a `probe.network.error`
 * carrying a runner `error_class`. We do NOT hard-gate on
 * `probeExitOutcome === "err"`: a crash that emits only a `probe.network.error`
 * (no `probe.exit`, or a `probe.exit` with a null/timeout outcome) still
 * represents a runner that never observed a fair trial. Conversely a
 * `probe.exit{err}` whose own metadata carries a runner error class fires even
 * when no `probe.network.error` row exists (the schema declares no error_class
 * on probe.exit, so this is the only signal in that case).
 */
function ruleF(idx: EventIndex): boolean {
  // Collect every candidate error-class string from both signals.
  const candidates: string[] = [];
  for (const ev of all(idx, "probe.network.error")) {
    const ec = readString(metaOf(ev), "error_class");
    if (ec) candidates.push(ec);
  }
  for (const ev of all(idx, "probe.exit")) {
    const ec = readString(metaOf(ev), "error_class");
    if (ec) candidates.push(ec);
  }
  const runnerCrash = candidates.some((ec) => {
    const norm = ec.toLowerCase();
    return PROBE_RUNNER_ERROR_CLASSES.some((cls) => norm.includes(cls));
  });
  if (runnerCrash) return true;
  // A probe.exit{outcome:err} WITHOUT an error_class but with a matching
  // network-error class is already covered above. No further gate: absent any
  // runner error-class evidence, (f) does not fire (control falls through).
  return false;
}

/** (c) edge interference (single-row OR multi-row). */
function ruleC(f: DerivedFacts): boolean {
  return f.edgeSingleRowMatches.length > 0 || f.edgeMultiRowMatches.length > 0;
}

/**
 * (h) provider-side empty completion. A structurally-empty *200* reports NO
 * tokens, which the wire represents as either `response_token_count: 0` OR
 * `response_token_count: null` (schema type `number | null`). Both mean "the
 * provider produced no content" for this empty-response rule, so treat `null`
 * identically to `0`. Requires a `backend.llm.call.response` to actually be
 * present (a missing response also yields a null token count via the fact
 * accessor, but that is the (b) stalled-backend shape, not (h) — gate on the
 * response being SEEN so an absent response cannot false-fire (h)).
 *
 * Two further guards keep the null-token normalization from OVER-broadening (h)
 * (which precedes (a)) so it cannot steal slow/err cases that belong to (a) or
 * fall through to the appropriate non-empty class:
 *   - SUCCESS-only: the docstring says "structurally-empty *200*". A backend
 *     completion whose outcome is NOT `ok` (an error/timeout response) is not a
 *     200 and must not classify (h). Gate on `backendResponseOutcome === "ok"`.
 *   - NOT the (a) slow shape: a response that is LATE past the probe timeout
 *     (late first_byte / fresh heartbeat / late call.response — the (a) bar)
 *     proves the backend was alive past the timeout; that is (a) slow-first-
 *     token, NOT a structurally-empty 200. Defer to (a) when its predicate
 *     holds so the slow response falls through to (a) rather than (h).
 */
function ruleH(f: DerivedFacts): boolean {
  if (!f.backendLlmCallResponseSeen) return false;
  // A structurally-empty 200 requires a SUCCESS completion: an error/timeout
  // outcome is not a 200 and must fall through (e.g. to unclassified).
  if (f.backendResponseOutcome !== "ok") return false;
  // A LATE response (over the (a) timeout bar) is (a) slow-first-token, not (h):
  // defer to (a) so the slow case is not stolen by the empty-200 rule.
  if (ruleA(f)) return false;
  const noTokens =
    f.backendLlmCallResponseTokenCount === 0 ||
    f.backendLlmCallResponseTokenCount === null;
  return noTokens && f.backendSseEventCount === 0;
}

/**
 * (g) aimock fixture mismatch. DEGRADES: requires the `aimock.*` boundaries to
 * be PRESENT. When they are absent (today), returns false so control falls
 * through to `unclassified` rather than producing a false (g).
 */
function ruleG(f: DerivedFacts): boolean {
  if (!f.aimockBoundariesPresent) return false;
  // "No fixture matched" is signalled by `fixture_id: null` OR a `fixture_id`
  // key OMITTED from the decision metadata (which `extractFacts` reads as
  // `undefined`). Both mean "absent fixture id" per (g)'s intent; treat them
  // identically so a malformed/partial decision row does not silently no-fire.
  const noFixture =
    f.aimockFixtureId === null || f.aimockFixtureId === undefined;
  return (
    noFixture &&
    f.aimockResponseTotalBytes !== null &&
    f.aimockResponseTotalBytes < 16
  );
}

/** (b) stalled backend. */
function ruleB(f: DerivedFacts): boolean {
  if (!f.backendLlmCallStartSeen) return false;
  if (f.backendLlmCallResponseSeen) return false;
  // heartbeat last seen >30s before probe timeout, or never.
  // `elapsed_ms_since_start` is elapsed since the LLM call started; "last
  // heartbeat >30s before timeout" maps to: the most-recent heartbeat's
  // elapsed is more than 30s short of the probe-timeout window. Within-layer
  // (`mono_ns`) authoritative; the 30s gap dwarfs the ±50ms cross-layer skew.
  if (f.lastHeartbeatElapsedMs === null) return true; // never
  return f.lastHeartbeatElapsedMs < PROBE_TIMEOUT_MS - 30_000;
}

/**
 * (a) slow first token. Backend was demonstrably alive past the probe timeout.
 * Cross-layer comparisons apply ±50ms tolerance.
 */
function ruleA(f: DerivedFacts): boolean {
  if (f.probeFirstTokenSeen) return false;

  // (a.1) late first byte: delta_ms_from_ingress > 60000 (canonical). The
  // tolerance TIGHTENS the bar (timeout + slack) so a sub-50ms wall-clock skew
  // cannot flip a first_byte that arrived just BEFORE the timeout into a false
  // (a). (`+`, not `-`: subtracting would LOOSEN the bar to 59950 and misfire.)
  const lateFirstByte =
    f.backendSseFirstByteDeltaMs !== null &&
    f.backendSseFirstByteDeltaMs > PROBE_TIMEOUT_MS + CROSS_LAYER_TOLERANCE_MS;

  // (a.2) heartbeat-presence fallback: first_byte absent BUT a heartbeat fired
  // within ≤30s of the probe timeout (backend alive past timeout, just slow).
  const heartbeatNearTimeout =
    f.backendSseFirstByteDeltaMs === null &&
    f.lastHeartbeatElapsedMs !== null &&
    f.lastHeartbeatElapsedMs >= PROBE_TIMEOUT_MS - 30_000;

  // (a.3) late call.response: arrived AFTER probe timeout with latency>60000.
  // Tolerance TIGHTENS the bar (timeout + slack), matching (a.1): a latency
  // just BELOW the timeout must not flip into a false (a) on sub-50ms skew.
  const lateCallResponse =
    f.backendLlmCallResponseSeen &&
    f.backendLlmCallResponseLatencyMs !== null &&
    f.backendLlmCallResponseLatencyMs >
      PROBE_TIMEOUT_MS + CROSS_LAYER_TOLERANCE_MS;

  return lateFirstByte || heartbeatNearTimeout || lateCallResponse;
}

/** (d) overly strict harness assertion. */
function ruleD(f: DerivedFacts): boolean {
  return (
    f.backendResponseOutcome === "ok" &&
    f.backendResponseSseEventCount !== null &&
    f.backendResponseSseEventCount > 0 &&
    !f.probeFirstTokenSeen &&
    f.probeAlternateContentNonEmpty
  );
}

/** (e) frontend hydration failure. */
function ruleE(f: DerivedFacts): boolean {
  return (
    f.backendResponseOutcome === "ok" &&
    f.probeSseEventCount > 0 &&
    !f.probeFirstTokenSeen &&
    !f.probeAlternateContentNonEmpty &&
    f.probeConsoleErrorCount > 0
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Classify one `test_id`'s collected CVDIAG events into exactly one root-cause
 * class. Pure + read-only: the input is never mutated and no I/O is performed.
 *
 * @param testId The `test_id` under classification (used only for the evidence
 *   echo; the rules key on the events themselves).
 * @param events The full `CvdiagEnvelope[]` collected for that `test_id` across
 *   all layers.
 */
export function classify(
  testId: string,
  events: CvdiagEnvelope[],
): ClassificationResult {
  const idx = buildIndex(events);
  const f = extractFacts(idx);

  const evidence: ClassificationEvidence = {
    testId: testId || idx.testId,
    eventCountByLayer: idx.eventCountByLayer,
    boundaryHistogram: idx.boundaryHistogram,
    facts: { ...f },
  };

  const decide = (
    flapClass: FlapClass,
    reason: string,
    edgeSubCauses: string[] = [],
  ): ClassificationResult => ({
    flapClass,
    letter: FLAP_CLASS_LETTER[flapClass],
    confidence: "high",
    reason,
    edgeSubCauses,
    evidence,
  });

  // Precedence order (see header).
  if (ruleF(idx)) {
    // (f) fires from EITHER signal — a probe.network.error carrying a runner
    // error_class, OR a probe.exit (any outcome) carrying one. Name the signal
    // that actually fired + the actual error_class rather than hardcoding the
    // probe.exit-outcome=err phrasing (which is wrong for a network-error-only
    // crash, or a non-err probe.exit).
    const fSignal = has(idx, "probe.network.error")
      ? "probe.network.error"
      : "probe.exit";
    return decide(
      "probe-runner-crash",
      `${fSignal} carries probe-runner error class (${f.probeExitErrorClass ?? "unknown"})`,
    );
  }
  if (ruleC(f)) {
    const subs = dedupe([...f.edgeSingleRowMatches, ...f.edgeMultiRowMatches]);
    return decide(
      "edge-interference",
      `edge-header signature matched: ${subs.join("; ")}`,
      subs,
    );
  }
  if (ruleH(f)) {
    // Interpolate the ACTUAL matched token value: the null normalization means
    // (h) fires on `0` OR `null`, so the reason must say which (not hardcode
    // "=0"). Render null as "null (absent)" to match its wire/semantic meaning.
    const tokenDesc =
      f.backendLlmCallResponseTokenCount === null
        ? "null (absent)"
        : `${f.backendLlmCallResponseTokenCount}`;
    return decide(
      "provider-empty",
      `backend.llm.call.response token_count=${tokenDesc} AND zero backend.sse.event (provider returned structurally-empty 200)`,
    );
  }
  if (ruleG(f)) {
    // Distinguish the two "no fixture matched" states the fact extraction
    // deliberately preserves: a present `fixture_id` key with value `null`
    // (present-null) vs an OMITTED key (undefined → absent-key). Report which
    // one matched rather than hardcoding "fixture_id=null".
    const fixtureDesc =
      f.aimockFixtureId === undefined
        ? "fixture_id key absent (omitted)"
        : "fixture_id=null (present-null)";
    return decide(
      "aimock-fixture-mismatch",
      `aimock.match.decision ${fixtureDesc} AND aimock.response.complete total_bytes=${f.aimockResponseTotalBytes} (<16)`,
    );
  }
  // (a) is checked BEFORE (b): both key on first-token absence, but (a) fires
  // ONLY when a liveness signal (late first_byte / fresh heartbeat / late
  // call.response) proves the backend was alive past the probe timeout. Per
  // spec §8 rule (a): "If neither heartbeat nor late first_byte nor late
  // call.response is observed, class is (b) not (a)." So we try (a)'s
  // liveness-positive predicate first and fall through to (b) (stalled, no
  // liveness signal) when it does not hold.
  if (ruleA(f)) {
    return decide(
      "slow-first-token",
      "backend alive past probe timeout (late first_byte / fresh heartbeat / late call.response); raise timeout",
    );
  }
  if (ruleB(f)) {
    return decide(
      "stalled-backend",
      `backend.llm.call.start present, response absent, last heartbeat ${
        f.lastHeartbeatElapsedMs === null
          ? "never emitted"
          : `${f.lastHeartbeatElapsedMs}ms (>30s before timeout)`
      }`,
    );
  }
  if (ruleD(f)) {
    return decide(
      "strict-harness",
      "backend completed ok with SSE events; first-token absent but alternate (non-text) content present — probe selector too strict",
    );
  }
  if (ruleE(f)) {
    return decide(
      "frontend-hydration",
      "backend completed ok, SSE reached the probe, first-token absent, container empty, console error present — frontend listener/decoder dropped events",
    );
  }

  // Nothing matched — full evidence dump.
  return {
    flapClass: "unclassified",
    letter: FLAP_CLASS_LETTER["unclassified"],
    confidence: "high",
    reason: f.aimockBoundariesPresent
      ? "no discriminator rule matched"
      : "no discriminator rule matched (aimock.* boundaries absent — rule (g) degraded to unclassified per the aimock fast-follow gap)",
    edgeSubCauses: [],
    evidence,
  };
}
