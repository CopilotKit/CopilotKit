import { describe, it, expect } from "vitest";
import { canonicalPayload, computeSignature, verifyHmac } from "./hmac.js";

const NOW = 1_700_000_000;
const nowSec = (): number => NOW;

function sign(
  secret: string,
  method: string,
  path: string,
  ts: number,
  body: string,
): string {
  return `sha256=${computeSignature(secret, canonicalPayload(method, path, String(ts), body))}`;
}

describe("canonicalPayload", () => {
  it("formats METHOD|path|ts|sha256(body) with uppercase method", () => {
    const c = canonicalPayload("post", "/webhooks/deploy", "123", "hello");
    expect(c.startsWith("POST|/webhooks/deploy|123|")).toBe(true);
    // sha256("hello")
    expect(
      c.endsWith(
        "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      ),
    ).toBe(true);
  });
});

describe("computeSignature", () => {
  it("produces deterministic hex of length 64 for sha256", () => {
    const sig = computeSignature("secret", "POST|/x|1|abc");
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    // Deterministic: same inputs → same output.
    expect(computeSignature("secret", "POST|/x|1|abc")).toBe(sig);
  });

  it("differs across secrets (rotate primary vs secondary)", () => {
    const canonical = canonicalPayload("POST", "/x", "1", "body");
    const primary = computeSignature("primary-key", canonical);
    const rotate = computeSignature("rotate-key", canonical);
    expect(primary).not.toBe(rotate);
    expect(primary).toMatch(/^[0-9a-f]{64}$/);
    expect(rotate).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs when any canonical field changes", () => {
    const a = computeSignature("k", canonicalPayload("POST", "/x", "1", "b"));
    const b = computeSignature("k", canonicalPayload("POST", "/x", "2", "b"));
    const c = computeSignature("k", canonicalPayload("POST", "/y", "1", "b"));
    const d = computeSignature("k", canonicalPayload("GET", "/x", "1", "b"));
    const e = computeSignature("k", canonicalPayload("POST", "/x", "1", "B"));
    expect(new Set([a, b, c, d, e]).size).toBe(5);
  });

  it("handles empty body and empty path (hex, fixed length)", () => {
    const sig = computeSignature("k", canonicalPayload("POST", "", "0", ""));
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("verifyHmac", () => {
  const secret = "primary-key";
  const body = '{"ok":true}';
  const path = "/webhooks/deploy";
  const method = "POST";
  const sig = sign(secret, method, path, NOW, body);

  it("accepts a valid signature within skew", () => {
    const r = verifyHmac({
      method,
      path,
      timestamp: String(NOW),
      body,
      signatureHeader: sig,
      secrets: [secret],
      nowSec,
    });
    expect(r.ok).toBe(true);
  });

  it("accepts signatures with no sha256= prefix", () => {
    const raw = sig.replace(/^sha256=/, "");
    const r = verifyHmac({
      method,
      path,
      timestamp: String(NOW),
      body,
      signatureHeader: raw,
      secrets: [secret],
      nowSec,
    });
    expect(r.ok).toBe(true);
  });

  it("rejects a stale timestamp", () => {
    const r = verifyHmac({
      method,
      path,
      timestamp: String(NOW - 1000),
      body,
      signatureHeader: sig,
      secrets: [secret],
      nowSec,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("stale");
  });

  it("rejects a future timestamp beyond skew", () => {
    const r = verifyHmac({
      method,
      path,
      timestamp: String(NOW + 1000),
      body,
      signatureHeader: sig,
      secrets: [secret],
      nowSec,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("stale");
  });

  it("rejects a non-integer (float) timestamp with invalid-timestamp", () => {
    const r = verifyHmac({
      method,
      path,
      timestamp: "1700000000.5",
      body,
      signatureHeader: sig,
      secrets: [secret],
      nowSec,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("invalid-timestamp");
  });

  it("rejects a non-numeric timestamp with invalid-timestamp", () => {
    const r = verifyHmac({
      method,
      path,
      timestamp: "not-a-number",
      body,
      signatureHeader: sig,
      secrets: [secret],
      nowSec,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("invalid-timestamp");
  });

  it("rejects a wrong signature", () => {
    const r = verifyHmac({
      method,
      path,
      timestamp: String(NOW),
      body,
      signatureHeader: "sha256=deadbeef",
      secrets: [secret],
      nowSec,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("bad-signature");
  });

  it("rejects with missing-timestamp when only timestamp is absent", () => {
    const r = verifyHmac({
      method,
      path,
      timestamp: "",
      body,
      signatureHeader: sig,
      secrets: [secret],
      nowSec,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("missing-timestamp");
  });

  it("rejects with missing-signature when only signature is absent", () => {
    const r = verifyHmac({
      method,
      path,
      timestamp: String(NOW),
      body,
      signatureHeader: "",
      secrets: [secret],
      nowSec,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("missing-signature");
  });

  it("rejects with missing-headers when both are absent (legacy code retained)", () => {
    const r = verifyHmac({
      method,
      path,
      timestamp: "",
      body,
      signatureHeader: "",
      secrets: [secret],
      nowSec,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("missing-headers");
  });

  it("accepts a bare hex signature without the sha256= prefix (lenient by design)", () => {
    const raw = sig.replace(/^sha256=/, "");
    const r = verifyHmac({
      method,
      path,
      timestamp: String(NOW),
      body,
      signatureHeader: raw,
      secrets: [secret],
      nowSec,
    });
    expect(r.ok).toBe(true);
  });

  it("signals timing-safe compare shape check: mismatched-length hex → bad-signature, not invalid-format", () => {
    // Half-length valid hex. The signature-format regex accepts any
    // even-length hex string; the timingSafeEqual shape-check inside
    // the loop returns false (length mismatch) and we fall through
    // with bad-signature rather than surfacing a compare error.
    const r = verifyHmac({
      method,
      path,
      timestamp: String(NOW),
      body,
      signatureHeader: "sha256=abcdef",
      secrets: [secret],
      nowSec,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("bad-signature");
  });

  it("accepts the secondary key during rotation", () => {
    const oldSecret = "old-key";
    const newSecret = "new-key";
    const oldSig = sign(oldSecret, method, path, NOW, body);
    const r = verifyHmac({
      method,
      path,
      timestamp: String(NOW),
      body,
      signatureHeader: oldSig,
      secrets: [newSecret, oldSecret],
      nowSec,
    });
    expect(r.ok).toBe(true);
  });

  it("rejects when neither rotation key matches", () => {
    const r = verifyHmac({
      method,
      path,
      timestamp: String(NOW),
      body,
      signatureHeader: sign("third-key", method, path, NOW, body),
      secrets: ["k1", "k2"],
      nowSec,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("bad-signature");
  });

  it("rejects malformed hex in signature with invalid-signature-format", () => {
    const r = verifyHmac({
      method,
      path,
      timestamp: String(NOW),
      body,
      signatureHeader: "sha256=zzzz",
      secrets: [secret],
      nowSec,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("invalid-signature-format");
  });

  it("rejects odd-length hex in signature with invalid-signature-format", () => {
    const r = verifyHmac({
      method,
      path,
      timestamp: String(NOW),
      body,
      signatureHeader: "sha256=abc",
      secrets: [secret],
      nowSec,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("invalid-signature-format");
  });

  it("trims whitespace from the signature header before verifying", () => {
    // Simulate a sender that accidentally smuggled whitespace into the
    // header (jq `$(...)` trailing newline is a classic offender).
    const r = verifyHmac({
      method,
      path,
      timestamp: String(NOW),
      body,
      signatureHeader: `  ${sig}\n`,
      secrets: [secret],
      nowSec,
    });
    expect(r.ok).toBe(true);
  });

  it("trims whitespace from the timestamp header", () => {
    const r = verifyHmac({
      method,
      path,
      timestamp: ` ${NOW}\n`,
      body,
      signatureHeader: sig,
      secrets: [secret],
      nowSec,
    });
    expect(r.ok).toBe(true);
  });
});
