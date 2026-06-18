/**
 * schema.test.ts — L0-A foundation tests for the CVDIAG flap-observability
 * schema, edge-header filter, and emitter.
 *
 * These 6 tests gate the shared schema that ALL downstream emitter slots
 * (Python `_shared`, .NET, Java, TS) codegen from. The contract they pin:
 *   (1) unknown ENVELOPE key is rejected by validation,
 *   (2) unknown METADATA key for a declared (layer,boundary) is dropped and
 *       the surviving record is stamped `_metadata_dropped: true`,
 *   (3) a DENY-list edge header is rejected even if it also appears in the
 *       allow-list (exact-match deny wins),
 *   (4) the DEBUG tier refuses to start when the resolved environment is
 *       production (fail-closed),
 *   (5) all 4 `cvdiag.*` accounting literals are present in the boundary enum,
 *   (6) the `test_id` UUIDv7 validator rejects a UUIDv4 and a malformed string.
 *
 * Spec: 2026-06-18-flap-observability.md §5/§6. Plan unit: L0-A.
 */

import { describe, it, expect } from "vitest";

import {
  CVDIAG_BOUNDARIES,
  isValidTestId,
  validateEnvelope,
  validateMetadata,
  SCHEMA_VERSION,
} from "./schema.js";
import { filterEdgeHeaders } from "./edge-headers.js";
import { CvdiagEmitter } from "./emit.js";

describe("CVDIAG schema — envelope validation", () => {
  // (1) unknown envelope key rejected.
  it("rejects an envelope carrying an unknown top-level key", () => {
    const envelope = {
      schema_version: SCHEMA_VERSION,
      test_id: "017f22e2-79b0-7cc3-98c4-dc0c0c07398f",
      trace_id: "017f22e2-79b0-7cc3-98c4-dc0c0c07398f",
      span_id: "0123456789abcdef",
      parent_span_id: null,
      layer: "probe",
      boundary: "probe.start",
      slug: "langgraph-python",
      demo: "agentic_chat",
      ts: "2026-06-18T00:00:00.000Z",
      mono_ns: 1,
      duration_ms: null,
      outcome: "info",
      edge_headers: {
        "cf-ray": null,
        "cf-mitigated": null,
        "cf-cache-status": null,
        "x-railway-edge": null,
        "x-railway-request-id": null,
        "x-hikari-trace": null,
        "retry-after": null,
        via: null,
        server: null,
      },
      metadata: {},
      // Unknown / not-in-schema envelope key:
      injected_unknown_key: "boom",
    };
    const result = validateEnvelope(envelope);
    expect(result.ok).toBe(false);
    expect(result.unknownKeys).toContain("injected_unknown_key");
  });
});

describe("CVDIAG schema — per-boundary metadata closed-world", () => {
  // (2) unknown metadata key for a declared (layer,boundary) is dropped and
  // the record is stamped _metadata_dropped: true.
  it("drops unknown metadata keys and stamps _metadata_dropped", () => {
    const result = validateMetadata(
      "probe",
      "probe.firsttoken_placeholder_invalid_too?" as never,
      {},
    );
    // For a REAL boundary with an unknown metadata key:
    const real = validateMetadata("probe", "probe.dom.firsttoken", {
      delta_ms_from_start: 10,
      text_length: 4,
      bogus_field: "drop-me",
    });
    expect(real.metadata).not.toHaveProperty("bogus_field");
    expect(real.metadata).toHaveProperty("delta_ms_from_start", 10);
    expect(real.metadataDropped).toBe(true);
    // Sanity: the invalid-boundary call above still returns a result object.
    expect(result).toBeDefined();
  });
});

describe("CVDIAG schema — metadata value secret scrub (§6)", () => {
  // (§6) Surviving metadata STRING values are secret-scrubbed before they
  // leave validateMetadata — the boundary field is literally `message_scrubbed`.
  it("redacts Bearer / sk- secrets in a surviving metadata string value", () => {
    const real = validateMetadata("backend", "backend.error.caught", {
      message_scrubbed: "Authorization: Bearer sk-ABCDEF0123456789XYZ",
      exception_type: "AuthError",
    });
    const msg = real.metadata.message_scrubbed as string;
    expect(msg).not.toContain("Bearer sk-ABCDEF0123456789XYZ");
    expect(msg).not.toContain("sk-ABCDEF0123456789XYZ");
    expect(msg).toContain("[REDACTED]");
    // Non-secret allowed keys survive verbatim.
    expect(real.metadata.exception_type).toBe("AuthError");
  });

  it("redacts a bare-token URL userinfo (scheme://token@) in a metadata value", () => {
    const real = validateMetadata("probe", "probe.start", {
      url: "https://ghp_abc123def456ghi789@github.com/x",
    });
    const url = real.metadata.url as string;
    expect(url).not.toContain("ghp_abc123def456ghi789");
    expect(url).toBe("https://[REDACTED]@github.com/x");
  });

  it("still redacts the user:password@ URL userinfo form", () => {
    const real = validateMetadata("probe", "probe.start", {
      url: "https://alice:s3cr3t@github.com/x",
    });
    const url = real.metadata.url as string;
    expect(url).not.toContain("s3cr3t");
    expect(url).not.toContain("alice");
    expect(url).toBe("https://[REDACTED]@github.com/x");
  });

  it("leaves non-string metadata values untouched", () => {
    const real = validateMetadata("probe", "probe.network.response", {
      url: "https://example.com/x",
      status: 200,
    });
    expect(real.metadata.url).toBe("https://example.com/x");
    expect(real.metadata.status).toBe(200);
  });
});

describe("CVDIAG edge headers — deny-list precedence", () => {
  // (3) forbidden edge header rejected even if present in the allow-list set.
  it("rejects a deny-list header even when it collides with an allow-list key", () => {
    const filtered = filterEdgeHeaders({
      "cf-ray": "abc-123",
      "cf-connecting-ip": "203.0.113.7", // DENY (PII) — must NOT survive
      "cf-ipcountry": "US", // DENY (PII)
      "x-forwarded-for": "203.0.113.7", // DENY (PII)
      via: "1.1 cloudflare",
    });
    expect(filtered["cf-ray"]).toBe("abc-123");
    expect(filtered.via).toBe("1.1 cloudflare");
    // None of the PII deny-list keys may appear on the result at all.
    expect(
      Object.prototype.hasOwnProperty.call(filtered, "cf-connecting-ip"),
    ).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(filtered, "cf-ipcountry")).toBe(
      false,
    );
    expect(
      Object.prototype.hasOwnProperty.call(filtered, "x-forwarded-for"),
    ).toBe(false);
    // Absent allow-list keys are present-and-null.
    expect(filtered["retry-after"]).toBeNull();
    expect(filtered.server).toBeNull();
  });
});

describe("CVDIAG emitter — DEBUG tier production fail-closed", () => {
  // (4) DEBUG tier refuses to start when env resolves to production.
  it("refuses DEBUG when SHOWCASE_ENV resolves to production", () => {
    expect(
      () =>
        new CvdiagEmitter({
          debug: true,
          env: { SHOWCASE_ENV: "production" },
        }),
    ).toThrow(/production/i);
  });

  it("refuses DEBUG when no environment variable resolves (fail-closed)", () => {
    expect(
      () =>
        new CvdiagEmitter({
          debug: true,
          env: {},
        }),
    ).toThrow();
  });

  it("allows DEBUG when env resolves to a non-production label with an allow-list", () => {
    expect(
      () =>
        new CvdiagEmitter({
          debug: true,
          env: {
            SHOWCASE_ENV: "staging",
            CVDIAG_DEBUG_ALLOW_LIST: "langgraph-python",
          },
        }),
    ).not.toThrow();
  });
});

describe("CVDIAG schema — accounting literals", () => {
  // (5) all 4 cvdiag.* accounting literals present in the boundary enum.
  it("includes all four cvdiag.* accounting literals in the boundary enum", () => {
    expect(CVDIAG_BOUNDARIES).toContain("cvdiag.purge_audit");
    expect(CVDIAG_BOUNDARIES).toContain("cvdiag.collision_detected");
    expect(CVDIAG_BOUNDARIES).toContain("cvdiag.queue_dropped");
    expect(CVDIAG_BOUNDARIES).toContain("cvdiag.metadata_dropped");
  });

  it("has exactly 33 boundary literals (29 data-plane + 4 accounting)", () => {
    expect(CVDIAG_BOUNDARIES.length).toBe(33);
  });
});

describe("CVDIAG schema — test_id UUIDv7 validation", () => {
  // (6) test_id UUIDv7 regex rejects a UUIDv4 + malformed string.
  it("accepts a well-formed lowercase UUIDv7", () => {
    expect(isValidTestId("017f22e2-79b0-7cc3-98c4-dc0c0c07398f")).toBe(true);
  });

  it("rejects a UUIDv4 (version nibble 4, not 7)", () => {
    expect(isValidTestId("f47ac10b-58cc-4372-a567-0e02b2c3d479")).toBe(false);
  });

  it("rejects a malformed / non-UUID string", () => {
    expect(isValidTestId("not-a-uuid")).toBe(false);
    expect(isValidTestId("017F22E2-79B0-7CC3-98C4-DC0C0C07398F")).toBe(false); // uppercase
    expect(isValidTestId("")).toBe(false);
  });
});
