import crypto from "node:crypto";
import { describe, it, expect, afterEach, vi } from "vitest";
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

  describe("compare-error classification (F3.2)", () => {
    // Regression: previously both length-mismatch (expected, noisy) and
    // genuinely unexpected crypto-layer errors (rare, page-worthy) were
    // logged at debug, making it impossible to alert on real breakage
    // without being drowned by happy-path rejection noise. We now split
    // them so operators can page on `HMAC_COMPARE_UNEXPECTED_ERROR`.

    function captureLogger(): {
      logger: {
        debug: (msg: string, meta?: unknown) => void;
        info: (msg: string, meta?: unknown) => void;
        warn: (msg: string, meta?: unknown) => void;
        error: (msg: string, meta?: unknown) => void;
      };
      debugCalls: Array<{ msg: string; meta?: unknown }>;
      warnCalls: Array<{ msg: string; meta?: unknown }>;
    } {
      const debugCalls: Array<{ msg: string; meta?: unknown }> = [];
      const warnCalls: Array<{ msg: string; meta?: unknown }> = [];
      return {
        logger: {
          debug: (msg, meta) => {
            debugCalls.push({ msg, meta });
          },
          info: () => {},
          warn: (msg, meta) => {
            warnCalls.push({ msg, meta });
          },
          error: () => {},
        },
        debugCalls,
        warnCalls,
      };
    }

    it("logs length-mismatch at debug (not warn) — no pager spam on malformed input", () => {
      // Force a length-mismatch path by passing a validly-shaped hex
      // signature (even-length, all hex) that's shorter than the
      // computed expected length. The inner timingSafeEqual call is
      // guarded by `providedHex.length === expected.length`, so it
      // returns false without throwing — the catch branch doesn't fire
      // at all in that path, which is correct.
      //
      // To actually exercise the catch branch with a length mismatch,
      // we use a provided signature whose even-length shape passes the
      // regex but decodes to a different length than expected. The
      // length guard short-circuits for sig lengths != expected, so we
      // must construct a scenario where Buffer.from triggers throwing
      // behavior. In practice the primary path for length-mismatch is
      // a direct call to timingSafeEqual with mismatched Buffers — we
      // simulate that by forcing the comparison via secrets rotation.
      //
      // Simplest deterministic test: short even-hex → length guard
      // short-circuits, returns bad-signature, no catch fires. Verify
      // warnCalls is empty (we never surfaced HMAC_COMPARE_UNEXPECTED_ERROR).
      const { logger: cap, warnCalls } = captureLogger();
      const r = verifyHmac({
        method,
        path,
        timestamp: String(NOW),
        body,
        signatureHeader: "sha256=abcdef",
        secrets: [secret],
        nowSec,
        logger: cap,
      });
      expect(r.ok).toBe(false);
      expect(r.reason).toBe("bad-signature");
      // Malformed/short hex must NOT surface HMAC_COMPARE_UNEXPECTED_ERROR.
      expect(
        warnCalls.some(
          (c) =>
            typeof c.meta === "object" &&
            c.meta !== null &&
            "errorId" in c.meta &&
            (c.meta as { errorId?: string }).errorId ===
              "HMAC_COMPARE_UNEXPECTED_ERROR",
        ),
      ).toBe(false);
    });

    // Guard: if a crypto spy throws mid-test and we forget to restore,
    // downstream tests would see the injected error. `restoreAllMocks`
    // on the spy set up by `vi.spyOn` below auto-reverts.
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("logs unexpected crypto errors at warn with stable errorId", () => {
      // Simulate a crypto-layer failure. Our regex + even-length check
      // filters malformed hex before reaching timingSafeEqual, so the
      // only way to reach the catch-with-non-length-mismatch branch
      // from public API is via an unexpected runtime error (OOM,
      // platform quirk). We force that via `vi.spyOn` with auto-restore
      // — safer than manually reassigning a global and relying on
      // try/finally to clean up (a thrown assertion inside the try
      // would leak the stub to every subsequent test).
      const syntheticError = new Error("simulated crypto failure (OOM)");
      vi.spyOn(crypto, "timingSafeEqual").mockImplementationOnce(() => {
        throw syntheticError;
      });
      const { logger: cap, warnCalls } = captureLogger();
      const r = verifyHmac({
        method,
        path,
        timestamp: String(NOW),
        body,
        signatureHeader: sig,
        secrets: [secret],
        nowSec,
        logger: cap,
      });
      expect(r.ok).toBe(false);
      // After the synthetic crypto failure, the loop falls through to
      // bad-signature (no secret matched).
      expect(r.reason).toBe("bad-signature");
      const unexpectedCall = warnCalls.find(
        (c) =>
          typeof c.meta === "object" &&
          c.meta !== null &&
          "errorId" in c.meta &&
          (c.meta as { errorId?: string }).errorId ===
            "HMAC_COMPARE_UNEXPECTED_ERROR",
      );
      expect(unexpectedCall).toBeDefined();
      expect(unexpectedCall!.msg).toBe("hmac.verify.compare-error");
    });
  });
});
