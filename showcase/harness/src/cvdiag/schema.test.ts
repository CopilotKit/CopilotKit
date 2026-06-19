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
import { filterEdgeHeaders, EDGE_HEADER_MAX_LEN } from "./edge-headers.js";
import { CvdiagEmitter } from "./emit.js";
import { scrubSecrets } from "./scrub.js";

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

describe("CVDIAG scrub — hyphenated sk- API-key prefixes (§6)", () => {
  // Modern provider keys carry a hyphenated prefix BEFORE the long entropy
  // tail (OpenAI `sk-proj-…`, Anthropic `sk-ant-api03-…`). The original
  // `/sk-[A-Za-z0-9]{16,}/` stopped at the first hyphen, so `proj`/`ant`
  // (3-4 chars) never satisfied the {16,} quota → the secret leaked.
  it("redacts an OpenAI project key (sk-proj-…)", () => {
    const out = scrubSecrets("key=sk-proj-abc123DEF456ghi789JKL");
    expect(out).not.toContain("sk-proj-abc123DEF456ghi789JKL");
    expect(out).toContain("[REDACTED]");
  });

  it("redacts an Anthropic key (sk-ant-api03-…)", () => {
    const out = scrubSecrets("sk-ant-api03-AbCdEf0123456789xyz");
    expect(out).not.toContain("sk-ant-api03-AbCdEf0123456789xyz");
    expect(out).toContain("[REDACTED]");
  });

  it("still redacts the legacy sk-<16+ alnum> form", () => {
    const out = scrubSecrets("token sk-ABCDEF0123456789XYZ here");
    expect(out).not.toContain("sk-ABCDEF0123456789XYZ");
    expect(out).toContain("[REDACTED]");
  });

  it("does NOT over-redact ordinary hyphenated words", () => {
    const phrase = "please ask-me-later about the task-list";
    expect(scrubSecrets(phrase)).toBe(phrase);
  });
});

describe("CVDIAG scrub — coverage corpus (§6 secret-format matrix)", () => {
  // The DURABLE convergence lever (M1 CR C1): every secret FORMAT the §6 PII
  // guarantee must redact is pinned here as a positive corpus, and a negative
  // corpus pins ordinary prose that MUST survive verbatim. Gaps in this matrix
  // were the repeated CR finding class (base64url keys, multi-@ userinfo).
  it("redacts every secret in the positive corpus", () => {
    const positive = [
      "Bearer abc.def",
      "sk-0123456789abcdef0123", // legacy sk-<16+ alnum>
      "sk-proj-AbCdEf0123456789ghij", // OpenAI project key
      "sk-ant-api03-AbCd_Ef-0123456789xyzAB", // Anthropic base64url key (_ and -)
      "https://user:pass@host/x", // user:pass@ userinfo
      "https://a@b@c.com/x", // multi-@ userinfo (full authority)
    ];
    for (const sample of positive) {
      const out = scrubSecrets(sample);
      expect(out).toContain("[REDACTED]");
    }
    // The userinfo secrets must not leak any authority tail.
    expect(scrubSecrets("https://user:pass@host/x")).toBe(
      "https://[REDACTED]@host/x",
    );
    expect(scrubSecrets("https://a@b@c.com/x")).toBe(
      "https://[REDACTED]@c.com/x",
    );
    // The key bodies must not survive anywhere in the output.
    expect(scrubSecrets("sk-ant-api03-AbCd_Ef-0123456789xyzAB")).not.toContain(
      "0123456789xyzAB",
    );
    expect(scrubSecrets("sk-proj-AbCdEf0123456789ghij")).not.toContain(
      "AbCdEf0123456789ghij",
    );
  });

  it("leaves the negative corpus (ordinary prose) intact", () => {
    const negative = [
      "ask-me-later",
      "task_list_items",
      "please review the file",
    ];
    for (const sample of negative) {
      expect(scrubSecrets(sample)).toBe(sample);
    }
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

describe("CVDIAG edge headers — value length bound (§3.1, §1.6)", () => {
  // Edge-header values are semi-untrusted/unbounded upstream input (cf-ray/via/
  // server can be set by a misbehaving or hostile edge). Bound each captured
  // value to EDGE_HEADER_MAX_LEN to keep envelopes from ballooning.
  it("clamps a value longer than EDGE_HEADER_MAX_LEN, appending an ellipsis marker", () => {
    // A ~100KB `via:` string — far beyond the cap.
    const huge = "x".repeat(100_000);
    const filtered = filterEdgeHeaders({
      via: huge,
      server: "y".repeat(100_000),
    });

    const clampedVia = filtered.via;
    expect(clampedVia).not.toBeNull();
    expect(clampedVia!.length).toBeLessThanOrEqual(EDGE_HEADER_MAX_LEN);
    expect(clampedVia!.endsWith("…")).toBe(true);

    const clampedServer = filtered.server;
    expect(clampedServer).not.toBeNull();
    expect(clampedServer!.length).toBeLessThanOrEqual(EDGE_HEADER_MAX_LEN);
    expect(clampedServer!.endsWith("…")).toBe(true);
  });

  it("leaves a value at or below EDGE_HEADER_MAX_LEN unchanged", () => {
    const atCap = "z".repeat(EDGE_HEADER_MAX_LEN);
    const short = "1.1 cloudflare";
    const filtered = filterEdgeHeaders({
      via: short,
      server: atCap,
    });
    expect(filtered.via).toBe(short);
    expect(filtered.server).toBe(atCap);
  });

  it("leaves null (absent) values null — the clamp never fabricates a string", () => {
    const filtered = filterEdgeHeaders({ via: "1.1 cloudflare" });
    expect(filtered.server).toBeNull();
    expect(filtered["cf-ray"]).toBeNull();
    expect(filtered["retry-after"]).toBeNull();
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

// Deep-freeze a graph so any in-place mutation attempt THROWS (used to prove
// validateMetadata never mutates the caller's object).
function deepFreeze<T>(obj: T): T {
  if (obj !== null && typeof obj === "object") {
    for (const v of Object.values(obj as Record<string, unknown>)) {
      deepFreeze(v);
    }
    Object.freeze(obj);
  }
  return obj;
}

// An UNCLONABLE leaf: `structuredClone` throws on a function, which is what the
// old validateMetadata defensive-copy path tripped over (R5-A4).
const unclonableLeaf = (): number => 42;

describe("CVDIAG validateMetadata — direct scrubDeep, no clone trap (§3.2.5)", () => {
  // validateMetadata calls scrubDeep DIRECTLY on object/array metadata values
  // (no structuredClone defensive copy). scrubDeep BUILDS a fresh scrubbed copy,
  // so the caller's object is never mutated for ANY input shape — including the
  // R5-A4 case where an allow-listed nested value carries an UNCLONABLE leaf
  // (function / class instance). The old structuredClone path THREW on that leaf
  // and fell back to scrubbing the ORIGINAL in place (mutation = RED).

  it("scrubs nested string values inside a surviving object/array metadata value", () => {
    const real = validateMetadata("backend", "backend.error.caught", {
      exception_type: "AuthError",
      message_scrubbed: "top-level",
      stack_brief: [
        { file: "Bearer sk-aaaaaaaaaaaaaaaa", line: 1 },
        { file: "https://alice:s3cr3t@host.com/x", line: 2 },
      ],
    });
    const survivor = real.metadata.stack_brief as Array<{
      file: string;
      line: number;
    }>;
    // Deep string leaves inside the surviving array-of-objects are scrubbed.
    expect(survivor[0].file).not.toContain("sk-aaaaaaaaaaaaaaaa");
    expect(survivor[0].file).toContain("[REDACTED]");
    expect(survivor[1].file).not.toContain("s3cr3t");
    expect(survivor[1].file).toContain("[REDACTED]");
    // Non-string leaves untouched.
    expect(survivor[0].line).toBe(1);
  });

  it("does NOT mutate the caller's metadata object (deep-frozen snapshot unchanged)", () => {
    // A fully deep-frozen caller object: any in-place mutation attempt would
    // THROW in a frozen graph, so survival of the call AND byte-identity of the
    // graph together prove no caller mutation.
    const caller = deepFreeze({
      exception_type: "E",
      message_scrubbed: "ok",
      stack_brief: [{ file: "Bearer sk-aaaaaaaaaaaaaaaa", line: 1 }],
    });
    const snapshot = JSON.parse(JSON.stringify(caller));
    const real = validateMetadata("backend", "backend.error.caught", caller);
    // Caller graph byte-identical (no in-place scrub of the frozen original).
    expect(caller).toEqual(snapshot);
    // Survivor copy is scrubbed (fresh container, not the caller's array).
    const survivor = real.metadata.stack_brief as Array<{ file: string }>;
    expect(survivor[0].file).toContain("[REDACTED]");
    expect(survivor).not.toBe(caller.stack_brief);
  });

  it("does NOT mutate the caller when a nested value carries an UNCLONABLE leaf (R5-A4)", () => {
    // The OLD structuredClone path throws on the function leaf and falls back to
    // scrubbing the ORIGINAL in place → caller's nested string becomes
    // [REDACTED] (RED). The direct scrubDeep path copies the function by
    // reference and leaves the original string untouched (GREEN).
    const stackBrief: Array<{ file: string; line: number; handler: unknown }> =
      [
        {
          file: "Bearer sk-aaaaaaaaaaaaaaaa",
          line: 1,
          handler: unclonableLeaf,
        },
      ];
    const snapshotFile = stackBrief[0].file;
    const real = validateMetadata("backend", "backend.error.caught", {
      exception_type: "E",
      message_scrubbed: "ok",
      stack_brief: stackBrief as never,
    });
    // Caller's original nested string is NOT scrubbed in place.
    expect(stackBrief[0].file).toBe(snapshotFile);
    expect(stackBrief[0].file).toContain("sk-aaaaaaaaaaaaaaaa");
    expect(stackBrief[0].handler).toBe(unclonableLeaf);
    // ...but the survivor copy IS scrubbed, with the function copied by ref.
    const survivor = real.metadata.stack_brief as Array<{
      file: string;
      handler: unknown;
    }>;
    expect(survivor[0].file).toContain("[REDACTED]");
    expect(survivor[0].handler).toBe(unclonableLeaf);
    expect(survivor).not.toBe(stackBrief);
  });
});
