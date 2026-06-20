/**
 * classifier.test.ts — SYNTHETIC GROUND-TRUTH SUITE for the L2-A flap
 * classifier. A `buildSyntheticEvents(classLabel, overrides?)` factory
 * manufactures the exact `CvdiagEnvelope[]` set characteristic of each
 * root-cause class (a)–(h) + `unclassified`. The suite runs ≥10 synthetic
 * cases per class, then computes per-class precision/recall and ASSERTS ≥0.90
 * on both.
 *
 * The ≥90% precision/recall gate (spec §8 Phase-6 DoD / R4-F6) applies to the
 * classes whose boundaries exist in-repo today: a, b, c, d, e, f, h, and
 * unclassified. Class (g) (aimock-fixture-mismatch) is tested for the
 * GRACEFUL-DEGRADATION contract: with the `aimock.*` boundaries ABSENT (the
 * state until the aimock fast-follow ships) a (g)-shaped flap must classify as
 * `unclassified` (NEVER a false (g)); with the boundaries PRESENT it must
 * classify as (g) at full confidence. Both directions are asserted.
 *
 * Class (c) carries BOTH single-row (cf-mitigated / retry-after) AND multi-row
 * (cf-ray mismatch across same-hop joined events) subtests per the plan.
 *
 * Spec: 2026-06-18-flap-observability.md §8 Phase-6 classifier rules. Plan
 * unit: L2-A.
 */

import { describe, it, expect } from "vitest";

import { classify, PROBE_TIMEOUT_MS } from "./classifier.js";
import type { FlapClass, ClassificationResult } from "./classifier.js";
import type {
  CvdiagEnvelope,
  CvdiagBoundary,
  CvdiagLayer,
  CvdiagOutcome,
  EdgeHeaders,
} from "./schema.js";

// ── Envelope builder ─────────────────────────────────────────────────────────

const TEST_ID = "017f22e2-79b0-7cc3-98c4-dc0c0c07398f";

function emptyEdgeHeaders(): EdgeHeaders {
  return {
    "cf-ray": null,
    "cf-mitigated": null,
    "cf-cache-status": null,
    "x-railway-edge": null,
    "x-railway-request-id": null,
    "x-hikari-trace": null,
    "retry-after": null,
    via: null,
    server: null,
  };
}

/** Merge a partial edge-header override into a full closed-key EdgeHeaders. */
function mergeEdgeHeaders(over?: Partial<EdgeHeaders>): EdgeHeaders {
  const base = emptyEdgeHeaders();
  if (!over) return base;
  return { ...base, ...over };
}

let monoCounter = 0;
let spanCounter = 0;

interface EventOpts {
  layer: CvdiagLayer;
  boundary: CvdiagBoundary;
  outcome?: CvdiagOutcome;
  metadata?: Record<string, unknown>;
  edgeHeaders?: Partial<EdgeHeaders>;
  testId?: string;
  tsMs?: number;
}

function ev(opts: EventOpts): CvdiagEnvelope {
  monoCounter += 1;
  spanCounter += 1;
  const edge = mergeEdgeHeaders(opts.edgeHeaders);
  const tsMs = opts.tsMs ?? Date.now() + monoCounter;
  return {
    schema_version: 1,
    test_id: opts.testId ?? TEST_ID,
    trace_id: opts.testId ?? TEST_ID,
    span_id: spanCounter.toString(16).padStart(16, "0"),
    parent_span_id: null,
    layer: opts.layer,
    boundary: opts.boundary,
    slug: "langgraph-python",
    demo: "agentic_chat",
    ts: new Date(tsMs).toISOString(),
    mono_ns: monoCounter * 1_000_000,
    duration_ms: null,
    outcome: opts.outcome ?? "info",
    edge_headers: edge,
    metadata: opts.metadata ?? {},
  };
}

// ── Reusable building blocks ─────────────────────────────────────────────────

/** A healthy probe lead-in (no first token; the flap surface). */
function probeLeadIn(): CvdiagEnvelope[] {
  return [
    ev({
      layer: "probe",
      boundary: "probe.start",
      metadata: { url: "http://x", viewport: { width: 1, height: 1 } },
    }),
    ev({
      layer: "probe",
      boundary: "probe.navigate.complete",
      metadata: { url: "http://x", nav_ms: 10, http_status: 200 },
    }),
    ev({
      layer: "probe",
      boundary: "probe.message.send",
      metadata: { message_index: 0, char_count: 5, demo: "agentic_chat" },
    }),
    ev({
      layer: "probe",
      boundary: "probe.dom.container.mount",
      metadata: { delta_ms_from_start: 50 },
    }),
  ];
}

function probeExitTimeout(): CvdiagEnvelope {
  return ev({
    layer: "probe",
    boundary: "probe.exit",
    outcome: "timeout",
    metadata: {
      terminal_outcome: "timeout",
      total_duration_ms: PROBE_TIMEOUT_MS,
      sse_event_count: 0,
      first_token_delta_ms: null,
    },
  });
}

function backendIngress(edge?: Partial<EdgeHeaders>): CvdiagEnvelope {
  return ev({
    layer: "backend",
    boundary: "backend.request.ingress",
    metadata: { method: "POST", path: "/agent", content_length: 100 },
    edgeHeaders: edge,
  });
}

function backendComplete(
  sseEventCount: number,
  outcome: CvdiagOutcome,
  edge?: Partial<EdgeHeaders>,
): CvdiagEnvelope {
  return ev({
    layer: "backend",
    boundary: "backend.response.complete",
    outcome,
    metadata: {
      http_status: outcome === "ok" ? 200 : 500,
      content_length: 100,
      total_duration_ms: 1000,
      sse_event_count: sseEventCount,
    },
    edgeHeaders: edge,
  });
}

// ── The synthetic factory ────────────────────────────────────────────────────

type SyntheticLabel = FlapClass | "edge-multirow";

/**
 * Manufacture the exact event set characteristic of a class. `variant` selects
 * one of several in-class shapes so the ≥10 cases/class are not identical
 * clones; `overrides` is a free-form mutator for edge cases.
 */
function buildSyntheticEvents(
  label: SyntheticLabel,
  variant = 0,
  overrides?: (events: CvdiagEnvelope[]) => CvdiagEnvelope[],
): CvdiagEnvelope[] {
  let events: CvdiagEnvelope[];

  switch (label) {
    // (a) slow first token — backend alive past timeout.
    case "slow-first-token": {
      const base = [
        ...probeLeadIn(),
        backendIngress(),
        ev({
          layer: "backend",
          boundary: "backend.llm.call.start",
          metadata: {
            provider: "anthropic",
            model: "m",
            prompt_token_count_estimate: 10,
          },
        }),
      ];
      if (variant % 3 === 0) {
        // a.1 late first byte
        base.push(
          ev({
            layer: "backend",
            boundary: "backend.sse.first_byte",
            metadata: {
              delta_ms_from_ingress: PROBE_TIMEOUT_MS + 5000 + variant * 100,
            },
          }),
        );
      } else if (variant % 3 === 1) {
        // a.2 heartbeat near timeout, no first byte
        base.push(
          ev({
            layer: "backend",
            boundary: "backend.llm.call.heartbeat",
            metadata: { elapsed_ms_since_start: PROBE_TIMEOUT_MS - 5000 },
          }),
        );
      } else {
        // a.3 late call.response
        base.push(
          ev({
            layer: "backend",
            boundary: "backend.llm.call.response",
            metadata: {
              provider: "anthropic",
              model: "m",
              response_token_count: 50,
              latency_ms: PROBE_TIMEOUT_MS + 2000 + variant * 50,
              error_class: null,
            },
          }),
        );
      }
      base.push(probeExitTimeout());
      events = base;
      break;
    }

    // (b) stalled backend — call started, never returned, heartbeat stale/never.
    case "stalled-backend": {
      const base = [
        ...probeLeadIn(),
        backendIngress(),
        ev({
          layer: "backend",
          boundary: "backend.llm.call.start",
          metadata: {
            provider: "anthropic",
            model: "m",
            prompt_token_count_estimate: 10,
          },
        }),
      ];
      if (variant % 2 === 0) {
        // stale heartbeat (>30s before timeout)
        base.push(
          ev({
            layer: "backend",
            boundary: "backend.llm.call.heartbeat",
            metadata: {
              elapsed_ms_since_start: PROBE_TIMEOUT_MS - 40_000 - variant * 100,
            },
          }),
        );
      }
      // variant%2===1 → no heartbeat at all (never)
      base.push(probeExitTimeout());
      events = base;
      break;
    }

    // (c) edge interference — single-row.
    case "edge-interference": {
      const base = [...probeLeadIn()];
      const pick = variant % 3;
      if (pick === 0) {
        base.push(
          ev({
            layer: "probe",
            boundary: "probe.network.response",
            outcome: "ok",
            metadata: {
              url: "http://x",
              status: 200,
              content_length: 0,
              duration_ms: 10,
            },
            edgeHeaders: {
              "cf-mitigated": variant % 2 === 0 ? "challenge" : "jschallenge",
            },
          }),
        );
      } else if (pick === 1) {
        base.push(
          ev({
            layer: "probe",
            boundary: "probe.network.response",
            outcome: "ok",
            metadata: {
              url: "http://x",
              status: 200,
              content_length: 0,
              duration_ms: 10,
            },
            edgeHeaders: { "cf-mitigated": "block" },
          }),
        );
      } else {
        base.push(
          ev({
            layer: "probe",
            boundary: "probe.network.response",
            outcome: "err",
            metadata: {
              url: "http://x",
              status: 429,
              content_length: 0,
              duration_ms: 10,
            },
            edgeHeaders: { "retry-after": "30" },
          }),
        );
      }
      base.push(probeExitTimeout());
      events = base;
      break;
    }

    // (c) edge interference — multi-row (cf-ray mismatch on same hop).
    case "edge-multirow": {
      const base = [...probeLeadIn()];
      base.push(
        ev({
          layer: "backend",
          boundary: "backend.request.ingress",
          metadata: { method: "POST", path: "/agent", content_length: 100 },
          edgeHeaders: { "cf-ray": `ray-A-${variant}` },
        }),
      );
      base.push(backendComplete(2, "ok", { "cf-ray": `ray-B-${variant}` }));
      base.push(probeExitTimeout());
      events = base;
      break;
    }

    // (d) strict harness — backend ok + sse>0 + no firsttoken + alt content.
    case "strict-harness": {
      const base = [
        ...probeLeadIn(),
        backendIngress(),
        backendComplete(3 + variant, "ok"),
      ];
      base.push(
        ev({
          layer: "probe",
          boundary: "probe.sse.event",
          metadata: {
            event_type: "TEXT_MESSAGE_CONTENT",
            payload_size_bytes: 20,
            sequence_num: 0,
          },
        }),
      );
      base.push(
        ev({
          layer: "probe",
          boundary: "probe.dom.alternate_content",
          metadata: {
            child_type_histogram: {
              "markdown-widget": 1,
              "code-block": variant % 2,
            },
          },
        }),
      );
      base.push(probeExitTimeout());
      events = base;
      break;
    }

    // (e) frontend hydration — backend ok + probe sse>0 + no firsttoken + EMPTY alt + console error.
    case "frontend-hydration": {
      const base = [
        ...probeLeadIn(),
        backendIngress(),
        backendComplete(3, "ok"),
      ];
      base.push(
        ev({
          layer: "probe",
          boundary: "probe.sse.event",
          metadata: {
            event_type: "TEXT_MESSAGE_CONTENT",
            payload_size_bytes: 20,
            sequence_num: 0,
          },
        }),
      );
      base.push(
        ev({
          layer: "probe",
          boundary: "probe.sse.event",
          metadata: {
            event_type: "TEXT_MESSAGE_CONTENT",
            payload_size_bytes: 20,
            sequence_num: 1,
          },
        }),
      );
      base.push(
        ev({
          layer: "probe",
          boundary: "probe.dom.alternate_content",
          metadata: { child_type_histogram: {} },
        }),
      );
      base.push(
        ev({
          layer: "probe",
          boundary: "probe.console.error",
          metadata: {
            level: "error",
            message_scrubbed: `hydration failed #${variant}`,
            source_file: "app.js",
            line_col: "1:1",
          },
        }),
      );
      base.push(probeExitTimeout());
      events = base;
      break;
    }

    // (f) probe-runner crash — probe.exit err with runner error class.
    case "probe-runner-crash": {
      const errClasses = [
        "BrowserContextCrash",
        "TargetClosed",
        "page_crash",
        "evaluate_throw",
        "ProtocolError",
        "navigation_race",
        "runner_oom",
        "context_destroyed",
        "Playwright timeout",
        "PROTOCOL_ERROR",
      ];
      const base = [...probeLeadIn()];
      base.push(
        ev({
          layer: "probe",
          boundary: "probe.network.error",
          outcome: "err",
          metadata: {
            url: "http://x",
            error_class: errClasses[variant % errClasses.length],
            response_status: null,
          },
        }),
      );
      base.push(
        ev({
          layer: "probe",
          boundary: "probe.exit",
          outcome: "err",
          metadata: {
            terminal_outcome: "err",
            total_duration_ms: 1000,
            sse_event_count: 0,
            first_token_delta_ms: null,
          },
        }),
      );
      events = base;
      break;
    }

    // (g) aimock fixture mismatch — REQUIRES aimock.* boundaries present.
    case "aimock-fixture-mismatch": {
      const base = [...probeLeadIn(), backendIngress()];
      base.push(
        ev({
          layer: "aimock",
          boundary: "aimock.request.ingress",
          metadata: {
            path: "/v1/messages",
            content_length: 100,
            match_keys: [],
          },
        }),
      );
      base.push(
        ev({
          layer: "aimock",
          boundary: "aimock.match.decision",
          metadata: {
            fixture_id: null,
            match_score: 0.1,
            reject_reasons: [
              { key: "userMessage", expected: "x", actual: "y" },
            ],
          },
        }),
      );
      base.push(
        ev({
          layer: "aimock",
          boundary: "aimock.response.complete",
          metadata: {
            http_status: 200,
            total_bytes: variant % 16,
            total_duration_ms: 5,
            chunk_count: 0,
          },
        }),
      );
      base.push(probeExitTimeout());
      events = base;
      break;
    }

    // (h) provider-side empty — token_count=0 AND zero backend.sse.event.
    case "provider-empty": {
      const base = [
        ...probeLeadIn(),
        backendIngress(),
        ev({
          layer: "backend",
          boundary: "backend.llm.call.start",
          metadata: {
            provider: "anthropic",
            model: "m",
            prompt_token_count_estimate: 10,
          },
        }),
      ];
      base.push(
        ev({
          layer: "backend",
          boundary: "backend.llm.call.response",
          metadata: {
            provider: "anthropic",
            model: "m",
            response_token_count: 0,
            latency_ms: 1200 + variant * 10,
            error_class: null,
          },
        }),
      );
      base.push(backendComplete(0, "ok"));
      base.push(probeExitTimeout());
      events = base;
      break;
    }

    // unclassified — a flap with no discriminating signal at all.
    case "unclassified": {
      // Backend completed ok, some sse events, but NO alternate content and NO
      // console error and NO first token: matches neither (d) (no alt content)
      // nor (e) (no console error) nor anything else.
      const base = [
        ...probeLeadIn(),
        backendIngress(),
        backendComplete(2, "ok"),
      ];
      if (variant % 2 === 0) {
        base.push(
          ev({
            layer: "probe",
            boundary: "probe.sse.event",
            metadata: {
              event_type: "X",
              payload_size_bytes: 10,
              sequence_num: 0,
            },
          }),
        );
      }
      base.push(probeExitTimeout());
      events = base;
      break;
    }

    default: {
      events = [...probeLeadIn(), probeExitTimeout()];
    }
  }

  return overrides ? overrides(events) : events;
}

// ── Precision / recall machinery ─────────────────────────────────────────────

interface PrCounts {
  tp: number;
  fp: number;
  fn: number;
}

function newCounts(): PrCounts {
  return { tp: 0, fp: 0, fn: 0 };
}

function precision(c: PrCounts): number {
  const denom = c.tp + c.fp;
  return denom === 0 ? 1 : c.tp / denom;
}

function recall(c: PrCounts): number {
  const denom = c.tp + c.fn;
  return denom === 0 ? 1 : c.tp / denom;
}

// ── The ground-truth suite ───────────────────────────────────────────────────

/**
 * Classes whose boundaries exist in-repo and are gated at ≥90% precision/recall
 * (spec §8 DoD). (g) is excluded from this gate and tested separately for the
 * graceful-degradation contract.
 */
const GATED_CLASSES: FlapClass[] = [
  "slow-first-token",
  "stalled-backend",
  "edge-interference",
  "strict-harness",
  "frontend-hydration",
  "probe-runner-crash",
  "provider-empty",
  "unclassified",
];

const CASES_PER_CLASS = 12; // ≥10 per the gate.

describe("CVDIAG flap classifier — synthetic ground-truth gate (≥90% P/R)", () => {
  // Per-class precision/recall over the full synthetic ground-truth corpus.
  const counts: Record<FlapClass, PrCounts> = {
    "slow-first-token": newCounts(),
    "stalled-backend": newCounts(),
    "edge-interference": newCounts(),
    "strict-harness": newCounts(),
    "frontend-hydration": newCounts(),
    "probe-runner-crash": newCounts(),
    "aimock-fixture-mismatch": newCounts(),
    "provider-empty": newCounts(),
    unclassified: newCounts(),
  };

  // Build the corpus: ground-truth label → predicted label.
  const corpus: Array<{ truth: FlapClass; events: CvdiagEnvelope[] }> = [];

  for (const cls of GATED_CLASSES) {
    for (let v = 0; v < CASES_PER_CLASS; v += 1) {
      // class (c) gets half single-row, half multi-row to cover both kinds.
      if (cls === "edge-interference" && v >= CASES_PER_CLASS / 2) {
        corpus.push({
          truth: cls,
          events: buildSyntheticEvents("edge-multirow", v),
        });
      } else {
        corpus.push({ truth: cls, events: buildSyntheticEvents(cls, v) });
      }
    }
  }

  // Score the corpus once.
  for (const { truth, events } of corpus) {
    const result = classify(TEST_ID, events);
    const predicted = result.flapClass;
    if (predicted === truth) {
      counts[truth].tp += 1;
    } else {
      counts[truth].fn += 1; // missed the truth class
      counts[predicted].fp += 1; // wrongly assigned the predicted class
    }
  }

  for (const cls of GATED_CLASSES) {
    it(`class ${cls}: precision ≥ 0.90`, () => {
      const p = precision(counts[cls]);
      expect(
        p,
        `precision for ${cls} (tp=${counts[cls].tp} fp=${counts[cls].fp} fn=${counts[cls].fn})`,
      ).toBeGreaterThanOrEqual(0.9);
    });
    it(`class ${cls}: recall ≥ 0.90`, () => {
      const r = recall(counts[cls]);
      expect(
        r,
        `recall for ${cls} (tp=${counts[cls].tp} fp=${counts[cls].fp} fn=${counts[cls].fn})`,
      ).toBeGreaterThanOrEqual(0.9);
    });
  }
});

// ── Per-class direct assertions (sharper than the aggregate gate) ────────────

describe("CVDIAG flap classifier — per-class direct assertions", () => {
  function classifyVariant(
    label: SyntheticLabel,
    variant: number,
  ): ClassificationResult {
    return classify(TEST_ID, buildSyntheticEvents(label, variant));
  }

  it("(a) slow-first-token: late first byte", () => {
    expect(classifyVariant("slow-first-token", 0).flapClass).toBe(
      "slow-first-token",
    );
  });
  it("(a) slow-first-token: heartbeat near timeout, no first byte", () => {
    expect(classifyVariant("slow-first-token", 1).flapClass).toBe(
      "slow-first-token",
    );
  });
  it("(a) slow-first-token: late call.response", () => {
    expect(classifyVariant("slow-first-token", 2).flapClass).toBe(
      "slow-first-token",
    );
  });

  it("(b) stalled-backend: stale heartbeat", () => {
    expect(classifyVariant("stalled-backend", 0).flapClass).toBe(
      "stalled-backend",
    );
  });
  it("(b) stalled-backend: heartbeat never emitted", () => {
    expect(classifyVariant("stalled-backend", 1).flapClass).toBe(
      "stalled-backend",
    );
  });

  it("(c) edge-interference SINGLE-ROW: cf-mitigated=challenge", () => {
    const r = classifyVariant("edge-interference", 0);
    expect(r.flapClass).toBe("edge-interference");
    expect(r.edgeSubCauses.length).toBeGreaterThan(0);
  });
  it("(c) edge-interference SINGLE-ROW: cf-mitigated=block", () => {
    expect(classifyVariant("edge-interference", 1).flapClass).toBe(
      "edge-interference",
    );
  });
  it("(c) edge-interference SINGLE-ROW: retry-after + 429", () => {
    expect(classifyVariant("edge-interference", 2).flapClass).toBe(
      "edge-interference",
    );
  });
  it("(c) edge-interference MULTI-ROW: cf-ray mismatch on same hop", () => {
    const r = classifyVariant("edge-multirow", 0);
    expect(r.flapClass).toBe("edge-interference");
    expect(r.edgeSubCauses.join(" ")).toMatch(/cf-ray|Cross-PoP/i);
  });
  it("(c) edge MULTI-ROW: matching cf-ray across hops does NOT trip aggregator", () => {
    // Different LAYERS (different hops) with different cf-ray is EXPECTED and
    // must not classify as edge-interference. Build probe-hop + backend-hop
    // each with a single consistent cf-ray; no within-layer mismatch.
    const events = [
      ...probeLeadInForExternal(),
      ev({
        layer: "probe",
        boundary: "probe.network.response",
        outcome: "ok",
        metadata: {
          url: "http://x",
          status: 200,
          content_length: 0,
          duration_ms: 10,
        },
        edgeHeaders: { "cf-ray": "ray-probe" },
      }),
      ev({
        layer: "backend",
        boundary: "backend.request.ingress",
        metadata: { method: "POST", path: "/a", content_length: 1 },
        edgeHeaders: { "cf-ray": "ray-backend" },
      }),
      ev({
        layer: "backend",
        boundary: "backend.response.complete",
        outcome: "ok",
        metadata: {
          http_status: 200,
          content_length: 1,
          total_duration_ms: 10,
          sse_event_count: 2,
        },
        edgeHeaders: { "cf-ray": "ray-backend" },
      }),
      ev({
        layer: "probe",
        boundary: "probe.dom.firsttoken",
        metadata: { delta_ms_from_start: 100, text_length: 5 },
      }),
      ev({
        layer: "probe",
        boundary: "probe.exit",
        outcome: "ok",
        metadata: {
          terminal_outcome: "ok",
          total_duration_ms: 200,
          sse_event_count: 2,
          first_token_delta_ms: 100,
        },
      }),
    ];
    expect(classify(TEST_ID, events).flapClass).not.toBe("edge-interference");
  });

  it("(d) strict-harness: alt content present", () => {
    expect(classifyVariant("strict-harness", 0).flapClass).toBe(
      "strict-harness",
    );
  });

  it("(e) frontend-hydration: empty alt + console error", () => {
    expect(classifyVariant("frontend-hydration", 0).flapClass).toBe(
      "frontend-hydration",
    );
  });

  it("(f) probe-runner-crash: runner error class", () => {
    expect(classifyVariant("probe-runner-crash", 0).flapClass).toBe(
      "probe-runner-crash",
    );
  });

  it("(h) provider-empty: token_count=0 + zero sse", () => {
    expect(classifyVariant("provider-empty", 0).flapClass).toBe(
      "provider-empty",
    );
  });

  it("unclassified: no discriminator", () => {
    expect(classifyVariant("unclassified", 0).flapClass).toBe("unclassified");
  });

  it("classify is pure: does not mutate the input events", () => {
    const events = buildSyntheticEvents("slow-first-token", 0);
    const snapshot = JSON.stringify(events);
    classify(TEST_ID, events);
    expect(JSON.stringify(events)).toBe(snapshot);
  });

  it("evidence is always populated, including for unclassified", () => {
    const r = classifyVariant("unclassified", 0);
    expect(r.evidence.testId).toBe(TEST_ID);
    expect(Object.keys(r.evidence.boundaryHistogram).length).toBeGreaterThan(0);
    expect(r.evidence.eventCountByLayer.probe).toBeGreaterThan(0);
  });
});

// ── Rule (g) graceful-degradation contract ───────────────────────────────────

describe("CVDIAG flap classifier — rule (g) graceful degradation", () => {
  it("(g) FULL confidence when aimock.* boundaries are PRESENT", () => {
    const r = classify(
      TEST_ID,
      buildSyntheticEvents("aimock-fixture-mismatch", 0),
    );
    expect(r.flapClass).toBe("aimock-fixture-mismatch");
    expect(r.confidence).toBe("high");
  });

  it("(g) DEGRADES to unclassified (NOT a false (g)) when aimock.* boundaries are ABSENT", () => {
    // A (g)-shaped flap as it looks TODAY (aimock fast-follow not shipped): the
    // aimock.* boundaries simply do not exist in the event set. The backend
    // forwarded an empty stream but no aimock match-decision row was emitted.
    const events = [
      ...probeLeadIn(),
      backendIngress(),
      backendComplete(0, "ok"),
      probeExitTimeout(),
    ];
    const r = classify(TEST_ID, events);
    expect(r.flapClass).not.toBe("aimock-fixture-mismatch");
    expect(r.flapClass).toBe("unclassified");
    expect(r.reason).toMatch(/aimock\.\* boundaries absent/i);
  });

  it("(g) absent aimock with a present non-null fixture does NOT false-positive", () => {
    // aimock present but fixture matched and bytes large → NOT (g).
    const events = [
      ...probeLeadIn(),
      backendIngress(),
      ev({
        layer: "aimock",
        boundary: "aimock.match.decision",
        metadata: {
          fixture_id: "good-fixture",
          match_score: 0.99,
          reject_reasons: [],
        },
      }),
      ev({
        layer: "aimock",
        boundary: "aimock.response.complete",
        metadata: {
          http_status: 200,
          total_bytes: 4096,
          total_duration_ms: 50,
          chunk_count: 10,
        },
      }),
      ev({
        layer: "probe",
        boundary: "probe.dom.firsttoken",
        metadata: { delta_ms_from_start: 100, text_length: 20 },
      }),
      ev({
        layer: "probe",
        boundary: "probe.exit",
        outcome: "ok",
        metadata: {
          terminal_outcome: "ok",
          total_duration_ms: 200,
          sse_event_count: 5,
          first_token_delta_ms: 100,
        },
      }),
    ];
    expect(classify(TEST_ID, events).flapClass).not.toBe(
      "aimock-fixture-mismatch",
    );
  });
});

// Probe lead-in for the external-content (non-flap) case where a first token
// arrives — kept local to avoid coupling the shared lead-in to firsttoken.
function probeLeadInForExternal(): CvdiagEnvelope[] {
  return probeLeadIn();
}

// ── M4 CR R1 synthetic regression cases (one per accuracy bug) ───────────────
//
// Each case hand-builds the exact event set that exercises a specific
// misclassification bug. Comments record the RED (pre-fix) behavior and the
// GREEN (post-fix) expectation so the red-green proof is legible.

describe("CVDIAG classifier — M4 accuracy regressions", () => {
  // (1) Cross-layer tolerance WRONG SIGN. A first_byte delta of 59,951ms is
  // 49ms BEFORE the 60s probe timeout — the backend did NOT survive past the
  // timeout. RED: the loosened bar (>59950) wrongly fires (a). GREEN: with the
  // tightened bar (>60050) (a) does not fire; with no other liveness signal
  // control falls through to (b) (call.start present, response absent).
  it("(1) first_byte 49ms BEFORE timeout is NOT slow-first-token", () => {
    const events = [
      ...probeLeadIn(),
      backendIngress(),
      ev({
        layer: "backend",
        boundary: "backend.llm.call.start",
        metadata: {
          provider: "anthropic",
          model: "m",
          prompt_token_count_estimate: 10,
        },
      }),
      ev({
        layer: "backend",
        boundary: "backend.sse.first_byte",
        // 59,951ms < 60,000ms timeout → backend NOT alive past timeout.
        metadata: { delta_ms_from_ingress: PROBE_TIMEOUT_MS - 49 },
      }),
      probeExitTimeout(),
    ];
    expect(classify(TEST_ID, events).flapClass).not.toBe("slow-first-token");
  });

  // (1b) Symmetric: a late call.response 49ms BELOW the timeout must also not
  // fire (a) via the latency_ms path.
  it("(1b) call.response latency 49ms BELOW timeout is NOT slow-first-token", () => {
    const events = [
      ...probeLeadIn(),
      backendIngress(),
      ev({
        layer: "backend",
        boundary: "backend.llm.call.start",
        metadata: {
          provider: "anthropic",
          model: "m",
          prompt_token_count_estimate: 10,
        },
      }),
      ev({
        layer: "backend",
        boundary: "backend.llm.call.response",
        metadata: {
          provider: "anthropic",
          model: "m",
          response_token_count: 50,
          latency_ms: PROBE_TIMEOUT_MS - 49,
          error_class: null,
        },
      }),
      probeExitTimeout(),
    ];
    expect(classify(TEST_ID, events).flapClass).not.toBe("slow-first-token");
  });

  // (1c) Guard: a genuinely-late first_byte (well past timeout + tolerance)
  // STILL fires (a). Prevents over-tightening.
  it("(1c) first_byte well past timeout STILL fires slow-first-token", () => {
    const events = [
      ...probeLeadIn(),
      backendIngress(),
      ev({
        layer: "backend",
        boundary: "backend.llm.call.start",
        metadata: {
          provider: "anthropic",
          model: "m",
          prompt_token_count_estimate: 10,
        },
      }),
      ev({
        layer: "backend",
        boundary: "backend.sse.first_byte",
        metadata: { delta_ms_from_ingress: PROBE_TIMEOUT_MS + 5000 },
      }),
      probeExitTimeout(),
    ];
    expect(classify(TEST_ID, events).flapClass).toBe("slow-first-token");
  });

  // (2a) Runner crash that emits ONLY probe.exit{outcome:err} (no
  // probe.network.error). The schema has no error_class on probe.exit, so the
  // OLD code could not source an error class and never fired (f) → RED
  // unclassified. GREEN: (f) fires on probe.exit outcome=err carrying a runner
  // error class (sourced from probe.exit metadata).
  it("(2a) crash with only probe.exit{err}+runner error_class fires (f)", () => {
    const events = [
      ...probeLeadIn(),
      ev({
        layer: "probe",
        boundary: "probe.exit",
        outcome: "err",
        metadata: {
          terminal_outcome: "err",
          total_duration_ms: 1000,
          sse_event_count: 0,
          first_token_delta_ms: null,
          error_class: "BrowserContextCrash",
        },
      }),
    ];
    expect(classify(TEST_ID, events).flapClass).toBe("probe-runner-crash");
  });

  // (2b) Runner crash that emits ONLY probe.network.error (no probe.exit, or
  // probe.exit absent). OLD code hard-gated on probeExitOutcome==="err" so (f)
  // never fired → RED not-(f). GREEN: (f) fires from the network error_class.
  it("(2b) crash with only probe.network.error (no probe.exit) fires (f)", () => {
    const events = [
      ...probeLeadIn(),
      ev({
        layer: "probe",
        boundary: "probe.network.error",
        outcome: "err",
        metadata: {
          url: "http://x",
          error_class: "TargetClosed",
          response_status: null,
        },
      }),
    ];
    expect(classify(TEST_ID, events).flapClass).toBe("probe-runner-crash");
  });

  // (2c) Guard: a non-runner network error (ordinary connection reset) must NOT
  // be classified (f). Prevents over-firing.
  it("(2c) non-runner probe.network.error does NOT fire (f)", () => {
    const events = [
      ...probeLeadIn(),
      ev({
        layer: "probe",
        boundary: "probe.network.error",
        outcome: "err",
        metadata: {
          url: "http://x",
          error_class: "ECONNRESET",
          response_status: null,
        },
      }),
      probeExitTimeout(),
    ];
    expect(classify(TEST_ID, events).flapClass).not.toBe("probe-runner-crash");
  });

  // (3g) aimock.match.decision that OMITS the fixture_id key → undefined. OLD
  // code required === null so (g) silently no-fired → RED not-(g). GREEN:
  // undefined treated as missing fixture id, (g) fires.
  it("(3g) aimock decision missing fixture_id key fires (g)", () => {
    const events = [
      ...probeLeadIn(),
      backendIngress(),
      ev({
        layer: "aimock",
        boundary: "aimock.match.decision",
        // fixture_id key intentionally OMITTED → reads as undefined.
        metadata: {
          match_score: 0.1,
          reject_reasons: [{ key: "userMessage", expected: "x", actual: "y" }],
        },
      }),
      ev({
        layer: "aimock",
        boundary: "aimock.response.complete",
        metadata: {
          http_status: 200,
          total_bytes: 4,
          total_duration_ms: 5,
          chunk_count: 0,
        },
      }),
      probeExitTimeout(),
    ];
    expect(classify(TEST_ID, events).flapClass).toBe("aimock-fixture-mismatch");
  });

  // (3h) provider-empty 200 reporting response_token_count: null (not 0). OLD
  // code required === 0 → RED not-(h). GREEN: null treated as "no tokens" so
  // (h) fires.
  it("(3h) provider-empty with response_token_count:null fires (h)", () => {
    const events = [
      ...probeLeadIn(),
      backendIngress(),
      ev({
        layer: "backend",
        boundary: "backend.llm.call.start",
        metadata: {
          provider: "anthropic",
          model: "m",
          prompt_token_count_estimate: 10,
        },
      }),
      ev({
        layer: "backend",
        boundary: "backend.llm.call.response",
        metadata: {
          provider: "anthropic",
          model: "m",
          response_token_count: null,
          latency_ms: 1200,
          error_class: null,
        },
      }),
      backendComplete(0, "ok"),
      probeExitTimeout(),
    ];
    expect(classify(TEST_ID, events).flapClass).toBe("provider-empty");
  });

  // (4) Out-of-order / duplicate backend.sse.first_byte rows: an early-inserted
  // row with a LATE delta (>timeout) followed by a later-mono_ns row with an
  // EARLY delta (<timeout). mono_ns is authoritative: the TRUE first_byte is
  // the early-delta row, so the backend was NOT alive past timeout → not (a).
  // OLD code took array-insertion-order [0] (the late-delta row) → RED (a).
  // GREEN: mono_ns-min selection picks the early-delta row → not (a).
  it("(4) out-of-order duplicate first_byte uses mono_ns-earliest", () => {
    const lead = probeLeadIn();
    const ingress = backendIngress();
    const callStart = ev({
      layer: "backend",
      boundary: "backend.llm.call.start",
      metadata: {
        provider: "anthropic",
        model: "m",
        prompt_token_count_estimate: 10,
      },
    });
    // Build two first_byte rows, then SWAP their mono_ns so insertion-order
    // first (the late-delta row) is NOT the mono_ns-earliest.
    const lateDelta = ev({
      layer: "backend",
      boundary: "backend.sse.first_byte",
      metadata: { delta_ms_from_ingress: PROBE_TIMEOUT_MS + 5000 },
    });
    const earlyDelta = ev({
      layer: "backend",
      boundary: "backend.sse.first_byte",
      metadata: { delta_ms_from_ingress: 50 },
    });
    // Make earlyDelta the mono_ns-earliest despite being inserted second.
    const tmp = lateDelta.mono_ns;
    lateDelta.mono_ns = earlyDelta.mono_ns;
    earlyDelta.mono_ns = tmp - 1;
    const events = [
      ...lead,
      ingress,
      callStart,
      lateDelta, // inserted first, but LARGER mono_ns
      earlyDelta, // inserted second, but SMALLEST mono_ns (true first byte)
      probeExitTimeout(),
    ];
    // True first_byte delta = 50ms (well before timeout) → backend NOT alive
    // past timeout → must NOT be slow-first-token.
    expect(classify(TEST_ID, events).flapClass).not.toBe("slow-first-token");
  });
});

// ── M4 CR R2 synthetic regression cases ──────────────────────────────────────
//
// The R1 null-token normalization let rule (h) fire (before rule (a)) for any
// response carrying token_count null/0 + zero backend.sse.event — even a SLOW
// response (over the (a) timeout bar) or an ERR backend completion. (h) means
// "provider returned a structurally-empty 200", so it must be guarded to a
// GENUINE empty-200 (success outcome AND not in the (a) slow shape). The reason
// strings for (f)/(g)/(h) also went stale after the R1 rule broadening and must
// reflect the actual firing values.

describe("CVDIAG classifier — M4 CR R2 rule-h guard + truthful reasons", () => {
  // (1a) A SLOW response: late call.response (latency > timeout + tolerance)
  // that ALSO carries response_token_count: null and zero backend.sse.event.
  // RED (pre-fix): rule (h) steals it before (a) → provider-empty. GREEN: (h)
  // is guarded out of the (a) slow shape so it falls through to (a)
  // slow-first-token (raise the timeout, not a provider-empty).
  it("(1a) SLOW null-token response classifies (a) not (h)", () => {
    const events = [
      ...probeLeadIn(),
      backendIngress(),
      ev({
        layer: "backend",
        boundary: "backend.llm.call.start",
        metadata: {
          provider: "anthropic",
          model: "m",
          prompt_token_count_estimate: 10,
        },
      }),
      ev({
        layer: "backend",
        boundary: "backend.llm.call.response",
        metadata: {
          provider: "anthropic",
          model: "m",
          // null token + LATE latency (over the (a) bar).
          response_token_count: null,
          latency_ms: PROBE_TIMEOUT_MS + 5000,
          error_class: null,
        },
      }),
      // success completion, but zero backend.sse.event (the (h) bait).
      backendComplete(0, "ok"),
      probeExitTimeout(),
    ];
    expect(classify(TEST_ID, events).flapClass).toBe("slow-first-token");
  });

  // (1b) An ERR backend completion carrying null token + zero backend.sse.event.
  // RED (pre-fix): rule (h) fires (it ignores outcome) → provider-empty, which
  // is wrong — an error is not a "structurally-empty 200". GREEN: (h) requires
  // a SUCCESS outcome so this falls through to the appropriate non-(h) class.
  it("(1b) ERR null-token completion is NOT provider-empty", () => {
    const events = [
      ...probeLeadIn(),
      backendIngress(),
      ev({
        layer: "backend",
        boundary: "backend.llm.call.start",
        metadata: {
          provider: "anthropic",
          model: "m",
          prompt_token_count_estimate: 10,
        },
      }),
      ev({
        layer: "backend",
        boundary: "backend.llm.call.response",
        metadata: {
          provider: "anthropic",
          model: "m",
          response_token_count: null,
          // on-time latency (NOT the (a) shape) so only the outcome guard
          // keeps (h) from firing.
          latency_ms: 1200,
          error_class: "upstream_500",
        },
      }),
      // ERROR completion.
      backendComplete(0, "err"),
      probeExitTimeout(),
    ];
    expect(classify(TEST_ID, events).flapClass).not.toBe("provider-empty");
  });

  // (1c) Guard against over-correction: a GENUINE empty-200 (success outcome,
  // on-time latency, null/0 token, zero backend.sse.event) STILL classifies
  // (h). Confirms the new outcome + (a)-shape guards do not suppress real (h).
  it("(1c) genuine empty-200 STILL classifies (h)", () => {
    const events = [
      ...probeLeadIn(),
      backendIngress(),
      ev({
        layer: "backend",
        boundary: "backend.llm.call.start",
        metadata: {
          provider: "anthropic",
          model: "m",
          prompt_token_count_estimate: 10,
        },
      }),
      ev({
        layer: "backend",
        boundary: "backend.llm.call.response",
        metadata: {
          provider: "anthropic",
          model: "m",
          response_token_count: null,
          latency_ms: 1200, // on-time, NOT the (a) shape.
          error_class: null,
        },
      }),
      backendComplete(0, "ok"), // SUCCESS empty completion.
      probeExitTimeout(),
    ];
    expect(classify(TEST_ID, events).flapClass).toBe("provider-empty");
  });

  // (2f) Reason truthfulness: a runner crash that fires (f) from a
  // probe.network.error ALONE (no probe.exit) must name the network error_class
  // in the reason, not the stale "probe.exit outcome=err".
  it("(2f) network-error-only (f) reason names the network error_class", () => {
    const events = [
      ...probeLeadIn(),
      ev({
        layer: "probe",
        boundary: "probe.network.error",
        outcome: "err",
        metadata: {
          url: "http://x",
          error_class: "TargetClosed",
          response_status: null,
        },
      }),
    ];
    const r = classify(TEST_ID, events);
    expect(r.flapClass).toBe("probe-runner-crash");
    expect(r.reason).toContain("TargetClosed");
    // must NOT hardcode the probe.exit phrasing when no probe.exit fired.
    expect(r.reason).not.toContain("probe.exit outcome=err");
  });

  // (2h) Reason truthfulness: when (h) matches response_token_count === null the
  // reason must say null/absent, not the stale "token_count=0".
  it("(2h) null-token (h) reason states null, not =0", () => {
    const events = [
      ...probeLeadIn(),
      backendIngress(),
      ev({
        layer: "backend",
        boundary: "backend.llm.call.start",
        metadata: {
          provider: "anthropic",
          model: "m",
          prompt_token_count_estimate: 10,
        },
      }),
      ev({
        layer: "backend",
        boundary: "backend.llm.call.response",
        metadata: {
          provider: "anthropic",
          model: "m",
          response_token_count: null,
          latency_ms: 1200,
          error_class: null,
        },
      }),
      backendComplete(0, "ok"),
      probeExitTimeout(),
    ];
    const r = classify(TEST_ID, events);
    expect(r.flapClass).toBe("provider-empty");
    expect(r.reason).toMatch(/null|absent/i);
    expect(r.reason).not.toContain("token_count=0");
  });

  // (2g) Reason truthfulness: when (g) matches an OMITTED fixture_id key the
  // reason must distinguish absent-key from present-null, not hardcode
  // "fixture_id=null".
  it("(2g) absent-key (g) reason distinguishes absent from present-null", () => {
    const events = [
      ...probeLeadIn(),
      backendIngress(),
      ev({
        layer: "aimock",
        boundary: "aimock.match.decision",
        // fixture_id key OMITTED → reads as undefined (absent key).
        metadata: {
          match_score: 0.1,
          reject_reasons: [{ key: "userMessage", expected: "x", actual: "y" }],
        },
      }),
      ev({
        layer: "aimock",
        boundary: "aimock.response.complete",
        metadata: {
          http_status: 200,
          total_bytes: 4,
          total_duration_ms: 5,
          chunk_count: 0,
        },
      }),
      probeExitTimeout(),
    ];
    const r = classify(TEST_ID, events);
    expect(r.flapClass).toBe("aimock-fixture-mismatch");
    expect(r.reason).toMatch(/absent|omitted|missing/i);
    expect(r.reason).not.toContain("fixture_id=null");
  });
});
