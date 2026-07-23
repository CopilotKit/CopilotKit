/**
 * ab-hmac.test.ts — HMAC guard for the CVDIAG Railway-internal routing A/B
 * (flap-observability spec Phase 8). Pins the fail-closed verification contract:
 * the A/B's self-authenticating signature must REJECT a forged / tampered /
 * unsigned request so the PB-writer path never persists a row for an unverified
 * A/B probe.
 *
 * RED→GREEN focus: the reject-invalid path (tampered signature, tampered tuple,
 * missing secret, malformed test_id) must verify to `false`; only an
 * untampered, correctly-signed tuple with the secret present verifies `true`.
 */

import { describe, it, expect } from "vitest";

import {
  CVDIAG_AB_HMAC_SECRET_ENV,
  canonicalAbMessage,
  sanitizeTestId,
  signAbRequest,
  verifyAbRequest,
} from "./ab-hmac.js";
import type { AbSignedTuple } from "./ab-hmac.js";

const VALID_TEST_ID = "017f22e2-79b0-7cc3-98c4-dc0c0c07398f";
const SECRET = "test-shared-secret-do-not-use-in-prod";

function envWith(secret?: string): Record<string, string | undefined> {
  return secret === undefined ? {} : { [CVDIAG_AB_HMAC_SECRET_ENV]: secret };
}

function tuple(overrides: Partial<AbSignedTuple> = {}): AbSignedTuple {
  return {
    testId: VALID_TEST_ID,
    ts: 1_750_000_000_000,
    slug: "langgraph-python",
    ...overrides,
  };
}

describe("ab-hmac — sanitizeTestId", () => {
  it("accepts a valid lowercase UUIDv7 and normalizes case", () => {
    expect(sanitizeTestId(VALID_TEST_ID)).toBe(VALID_TEST_ID);
    expect(sanitizeTestId(VALID_TEST_ID.toUpperCase())).toBe(VALID_TEST_ID);
  });

  it("rejects a non-UUIDv7 / malformed id (fail-closed)", () => {
    expect(sanitizeTestId("not-a-uuid")).toBeNull();
    expect(sanitizeTestId("00000000-0000-4000-8000-000000000000")).toBeNull(); // v4
    expect(sanitizeTestId(123 as unknown)).toBeNull();
    expect(sanitizeTestId(undefined)).toBeNull();
  });
});

describe("ab-hmac — canonicalAbMessage", () => {
  it("joins the tuple as <test_id>|<ts>|<slug>", () => {
    expect(canonicalAbMessage(tuple())).toBe(
      `${VALID_TEST_ID}|1750000000000|langgraph-python`,
    );
  });

  it("fails closed on a delimiter smuggled into the slug", () => {
    expect(canonicalAbMessage(tuple({ slug: "a|b" }))).toBeNull();
  });

  it("fails closed on a non-integer ts", () => {
    expect(canonicalAbMessage(tuple({ ts: 1.5 }))).toBeNull();
  });
});

describe("ab-hmac — sign + verify happy path", () => {
  it("a freshly-signed tuple verifies true with the same secret", () => {
    const sig = signAbRequest(tuple(), envWith(SECRET));
    expect(sig).not.toBeNull();
    expect(verifyAbRequest(tuple(), sig!, envWith(SECRET))).toBe(true);
  });
});

describe("ab-hmac — reject-invalid (fail-closed)", () => {
  it("rejects a TAMPERED signature", () => {
    const sig = signAbRequest(tuple(), envWith(SECRET))!;
    // Flip the last hex nibble to simulate a forged digest.
    const last = sig.slice(-1) === "0" ? "1" : "0";
    const tampered = sig.slice(0, -1) + last;
    expect(verifyAbRequest(tuple(), tampered, envWith(SECRET))).toBe(false);
  });

  it("rejects a signature minted over a DIFFERENT tuple (slug swap)", () => {
    const sig = signAbRequest(
      tuple({ slug: "langgraph-python" }),
      envWith(SECRET),
    )!;
    expect(
      verifyAbRequest(tuple({ slug: "crewai-crews" }), sig, envWith(SECRET)),
    ).toBe(false);
  });

  it("rejects when the secret is MISSING (no silent allow)", () => {
    const sig = signAbRequest(tuple(), envWith(SECRET))!;
    expect(verifyAbRequest(tuple(), sig, envWith(undefined))).toBe(false);
    // And signing with no secret yields null (cannot issue the A/B request).
    expect(signAbRequest(tuple(), envWith(undefined))).toBeNull();
  });

  it("rejects a malformed (wrong-length / non-hex) presented signature", () => {
    expect(verifyAbRequest(tuple(), "deadbeef", envWith(SECRET))).toBe(false);
    expect(verifyAbRequest(tuple(), "zzzz", envWith(SECRET))).toBe(false);
  });

  it("rejects when the tuple's test_id is malformed (fail-closed before verify)", () => {
    const sig = signAbRequest(tuple(), envWith(SECRET))!;
    expect(
      verifyAbRequest(tuple({ testId: "not-a-uuid" }), sig, envWith(SECRET)),
    ).toBe(false);
  });
});
