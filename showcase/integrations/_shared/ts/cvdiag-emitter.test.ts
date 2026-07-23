/**
 * cvdiag-emitter.test.ts — vitest suite for the shared TS integration emitter
 * binding (plan unit L0-F). Asserts the four invariants the §6 PII/tier
 * contract requires of EVERY language emitter:
 *   - schema conformance (re-exported envelope keys + UUIDv7 minters),
 *   - tier gating (default vs verbose vs debug boundary inclusion),
 *   - PII scrub (Bearer / sk- secrets removed from captured values),
 *   - forbidden-header rejection (cf-ipcountry never captured),
 *   - DEBUG-in-production refusal (fail-closed startup guard).
 *
 * These re-exercise the L0-A invariants THROUGH the binding so a regression in
 * the re-export wiring (wrong relative path, dropped symbol) fails here, not
 * silently in a downstream TS integration.
 */

import { describe, expect, it } from "vitest";

import {
  CvdiagEmitter,
  ENVELOPE_KEYS,
  EDGE_HEADER_DENYLIST,
  SCHEMA_VERSION,
  TEST_ID_REGEX,
  filterEdgeHeaders,
  isValidTestId,
  mintSpanId,
  mintTestId,
  scrubSecrets,
  validateEnvelope,
} from "./cvdiag-emitter.js";
import type { CvdiagEnvelope } from "./cvdiag-emitter.js";

describe("L0-F binding: re-exports resolve from the canonical schema", () => {
  it("re-exports SCHEMA_VERSION === 1", () => {
    expect(SCHEMA_VERSION).toBe(1);
  });

  it("re-exports the closed envelope key set and validator", () => {
    expect(ENVELOPE_KEYS).toContain("test_id");
    expect(ENVELOPE_KEYS).toContain("edge_headers");
    // A foreign top-level key is rejected (closed-world).
    const bad = validateEnvelope({ test_id: "x", attacker_key: 1 });
    expect(bad.ok).toBe(false);
    expect(bad.unknownKeys).toContain("attacker_key");
  });

  it("re-exports the UUIDv7 minters + validator", () => {
    const id = mintTestId();
    expect(TEST_ID_REGEX.test(id)).toBe(true);
    expect(isValidTestId(id)).toBe(true);
    // A v4 UUID (version nibble 4) must be rejected.
    expect(isValidTestId("00000000-0000-4000-8000-000000000000")).toBe(false);
    // span_id is 16 lowercase hex chars.
    expect(mintSpanId()).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("L0-F binding: schema conformance of an emitted envelope", () => {
  it("emits a closed-world envelope at the verbose tier", () => {
    const emitter = new CvdiagEmitter({
      verbose: true,
      env: {},
      layer: "backend",
    });
    const env = emitter.emit({
      layer: "backend",
      boundary: "backend.agent.enter",
      slug: "langgraph-typescript",
      demo: "agentic_chat",
      outcome: "ok",
      metadata: { agent_name: "main", model_id: "gpt-4o" },
    }) as CvdiagEnvelope;
    expect(env).not.toBeNull();
    expect(env.schema_version).toBe(SCHEMA_VERSION);
    expect(isValidTestId(env.test_id)).toBe(true);
    expect(env.trace_id).toBe(env.test_id);
    expect(env.boundary).toBe("backend.agent.enter");
    // Every emitted key must be in the closed envelope key set.
    expect(validateEnvelope(env as unknown as Record<string, unknown>).ok).toBe(
      true,
    );
    // All 9 edge-header keys present (absent → null).
    expect(Object.keys(env.edge_headers).sort()).toEqual(
      [
        "cf-cache-status",
        "cf-mitigated",
        "cf-ray",
        "retry-after",
        "server",
        "via",
        "x-hikari-trace",
        "x-railway-edge",
        "x-railway-request-id",
      ].sort(),
    );
  });

  it("drops unknown metadata keys and stamps _metadata_dropped", () => {
    const emitter = new CvdiagEmitter({
      verbose: true,
      env: {},
      layer: "backend",
    });
    const env = emitter.emit({
      layer: "backend",
      boundary: "backend.agent.enter",
      slug: "mastra",
      demo: "agentic_chat",
      outcome: "ok",
      metadata: { agent_name: "main", model_id: "gpt-4o", attacker: "x" },
    }) as CvdiagEnvelope;
    expect(env._metadata_dropped).toBe(true);
    expect(env.metadata).not.toHaveProperty("attacker");
  });
});

describe("L0-F binding: tier gating", () => {
  it("default tier excludes a verbose-only boundary", () => {
    const emitter = new CvdiagEmitter({ env: {}, layer: "backend" });
    expect(emitter.tier).toBe("default");
    // backend.request.ingress is verbose+debug only (default:false).
    expect(emitter.shouldEmit("backend.request.ingress")).toBe(false);
    // backend.agent.enter is default:true.
    expect(emitter.shouldEmit("backend.agent.enter")).toBe(true);
  });

  it("verbose tier includes verbose-only boundaries", () => {
    const emitter = new CvdiagEmitter({
      verbose: true,
      env: {},
      layer: "backend",
    });
    expect(emitter.tier).toBe("verbose");
    expect(emitter.shouldEmit("backend.request.ingress")).toBe(true);
  });

  it("accounting boundaries always emit regardless of tier", () => {
    const emitter = new CvdiagEmitter({ env: {}, layer: "backend" });
    expect(emitter.shouldEmit("cvdiag.queue_dropped")).toBe(true);
  });
});

describe("L0-F binding: PII scrub (re-exported from edge-headers)", () => {
  it("scrubs Bearer tokens", () => {
    expect(scrubSecrets("auth: Bearer abc123def456")).toBe("auth: [REDACTED]");
  });

  it("scrubs sk- provider keys", () => {
    expect(scrubSecrets("key sk-ABCDEFGHIJKLMNOP1234")).toBe("key [REDACTED]");
  });
});

describe("L0-F binding: forbidden edge-header rejection", () => {
  it("never captures cf-ipcountry even when present", () => {
    const filtered = filterEdgeHeaders({
      "cf-ray": "abc-iad",
      "cf-ipcountry": "US",
      "true-client-ip": "1.2.3.4",
    });
    expect(filtered["cf-ray"]).toBe("abc-iad");
    expect(filtered).not.toHaveProperty("cf-ipcountry");
    expect(filtered).not.toHaveProperty("true-client-ip");
  });

  it("the deny list contains the cf-ip* family by exact match", () => {
    expect(EDGE_HEADER_DENYLIST).toContain("cf-ipcountry");
    expect(EDGE_HEADER_DENYLIST).toContain("cf-connecting-ip");
  });
});

describe("L0-F binding: DEBUG fail-closed in production", () => {
  it("refuses DEBUG when env resolves to production", () => {
    expect(
      () =>
        new CvdiagEmitter({
          debug: true,
          env: {
            SHOWCASE_ENV: "production",
            CVDIAG_DEBUG_ALLOW_LIST: "langgraph-typescript",
          },
        }),
    ).toThrow(/production/);
  });

  it("refuses DEBUG when no env label resolves (unknown == prod)", () => {
    expect(
      () =>
        new CvdiagEmitter({
          debug: true,
          env: { CVDIAG_DEBUG_ALLOW_LIST: "langgraph-typescript" },
        }),
    ).toThrow(/unresolved|production/);
  });

  it("allows DEBUG in a non-prod env with an allow-list", () => {
    const emitter = new CvdiagEmitter({
      debug: true,
      env: {
        SHOWCASE_ENV: "staging",
        CVDIAG_DEBUG_ALLOW_LIST: "langgraph-typescript",
      },
    });
    expect(emitter.tier).toBe("debug");
  });
});
