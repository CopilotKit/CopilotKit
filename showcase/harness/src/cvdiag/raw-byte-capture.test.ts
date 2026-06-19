/**
 * raw-byte-capture.test.ts — L2-C: Phase 2.5 DEBUG-tier raw-byte capture
 * pipeline (spec §11.4 T2 / Phase 2.5, R2-NF3 normative pipeline order).
 *
 * The tests below pin the normative behaviour:
 *   (1) forced empty-200 → a sample is produced and redaction is applied
 *       (no `Bearer …` / `sk-…` survives into the stored head/tail).
 *   (2) GZIPPED body carrying `sk-test-12345…` → decoded BEFORE scrub so the
 *       secret never survives — the critical decode-before-scrub ordering proof.
 *   (3) Cloudflare challenge HTML → html-strip removes `<script>`/`<style>` so
 *       no script source survives into the stored bytes.
 *   (4) body >32KB → head+tail cap keeps ≤16KB head + ≤16KB tail, `elided > 0`.
 *   (4b) body >32KB with a secret in the REAL tail → the captured head AND tail
 *        are the REAL ends of the body, BOTH are scrubbed, and `elided_count`
 *        reflects the real dropped bytes (regression guard: the scan-guard must
 *        not truncate the body before the head+tail cap).
 *   (5) non-DEBUG tier → `captureRawBytes` returns null immediately.
 */

import { gzipSync } from "node:zlib";
import { describe, it, expect, beforeEach } from "vitest";

import {
  captureRawBytes,
  resetRawByteCaptureStateForTest,
  RAW_BYTE_HEAD_CAP,
  RAW_BYTE_TAIL_CAP,
} from "./raw-byte-capture.js";

// Isolate the process-global per-slug 24h window + ≤500/24h ring-buffer so no
// capture-count state leaks between cases.
beforeEach(() => {
  resetRawByteCaptureStateForTest();
});

const DEBUG_OPTS = { tier: "debug" as const, debugEnabled: true };

function baseOpts(overrides: {
  responseBody: Buffer;
  contentEncoding?: string;
  transferEncoding?: string;
  contentType?: string;
  tier?: "default" | "verbose" | "debug";
  debugEnabled?: boolean;
}) {
  return {
    slug: "langgraph-python",
    testId: "0190a0c0-0000-7000-8000-000000000001",
    contentEncoding: "",
    transferEncoding: "",
    contentType: "text/event-stream",
    ...DEBUG_OPTS,
    ...overrides,
  };
}

describe("captureRawBytes — Phase 2.5 DEBUG-tier raw-byte capture", () => {
  it("(1) forced empty-200 → sample produced + secrets redacted", () => {
    const body = Buffer.from(
      'event: error\ndata: {"authorization":"Bearer sk-live-abcd1234efgh5678"}\n\n',
      "utf8",
    );
    const sample = captureRawBytes(baseOpts({ responseBody: body }));
    expect(sample).not.toBeNull();
    const stored = `${sample!.head_bytes}${sample!.tail_bytes}`;
    expect(stored).not.toMatch(/Bearer\s+\S/);
    expect(stored).not.toMatch(/sk-[A-Za-z0-9]{16,}/);
    expect(stored).toContain("[REDACTED]");
    expect(sample!.pipeline_applied).toContain("scrub");
  });

  it("(2) GZIPPED body with sk-test12345… → decode-before-scrub: secret NOT stored", () => {
    // `sk-` + ≥16 alphanumerics — the shape edge-headers.ts SK_KEY_REGEX
    // matches (OpenAI-style). The hyphen-free tail is what makes the
    // decode-before-scrub assertion meaningful: the secret only becomes
    // scrub-visible AFTER the gzip stream is decoded.
    const secret = "sk-test12345abcdefghij67890";
    const plain = `data: {"key":"${secret}"}\n\n`;
    const gz = gzipSync(Buffer.from(plain, "utf8"));
    // Pre-condition: the COMPRESSED bytes do not literally contain the secret,
    // so scrubbing without decoding first would silently leave it intact.
    expect(gz.toString("latin1")).not.toContain(secret);

    const sample = captureRawBytes(
      baseOpts({ responseBody: gz, contentEncoding: "gzip" }),
    );
    expect(sample).not.toBeNull();
    const stored = `${sample!.head_bytes}${sample!.tail_bytes}`;
    // Decoded first → the plaintext secret appeared → scrub removed it.
    expect(stored).not.toContain(secret);
    expect(stored).not.toMatch(/sk-[A-Za-z0-9]{16,}/);
    expect(stored).toContain("[REDACTED]");
    expect(sample!.pipeline_applied).toEqual(
      expect.arrayContaining(["decode", "scrub"]),
    );
  });

  it("(3) CF challenge HTML → html-strip removes <script>/<style> content", () => {
    const html = [
      "<!DOCTYPE html><html><head>",
      "<style>.cf{display:none}</style>",
      '<script>window.__cf$={r:"secretfingerprintpayload"};</script>',
      "</head><body>",
      "<h1>Just a moment...</h1>",
      "<p>Checking your browser before accessing the site.</p>",
      "</body></html>",
    ].join("");
    const sample = captureRawBytes(
      baseOpts({
        responseBody: Buffer.from(html, "utf8"),
        contentType: "text/html; charset=UTF-8",
      }),
    );
    expect(sample).not.toBeNull();
    const stored = `${sample!.head_bytes}${sample!.tail_bytes}`;
    expect(stored).not.toContain("<script");
    expect(stored).not.toContain("</script>");
    expect(stored).not.toContain("secretfingerprintpayload");
    expect(stored).not.toContain("<style");
    // Visible text is retained.
    expect(stored).toContain("Just a moment");
    expect(sample!.pipeline_applied).toContain("html_strip");
  });

  it("(4) body >32KB → head+tail cap, elided_count > 0", () => {
    const big = Buffer.from("A".repeat(80 * 1024), "utf8");
    const sample = captureRawBytes(baseOpts({ responseBody: big }));
    expect(sample).not.toBeNull();
    expect(Buffer.byteLength(sample!.head_bytes, "utf8")).toBeLessThanOrEqual(
      16 * 1024,
    );
    expect(Buffer.byteLength(sample!.tail_bytes, "utf8")).toBeLessThanOrEqual(
      16 * 1024,
    );
    expect(sample!.elided_count).toBeGreaterThan(0);
    expect(sample!.pipeline_applied).toContain("headtail");
  });

  it("(4b) body >32KB with a secret in the REAL tail → real head+tail captured, BOTH scrubbed, elided_count ≈ real dropped bytes", () => {
    // A 50KB body whose HEAD and TAIL each carry a DISTINCT secret, with inert
    // filler in the middle. The defect (scan-guard truncates to 32KB BEFORE the
    // head+tail cap) would (a) lose the real tail — the captured "tail" would be
    // the end of the first 32KB (filler), not these last bytes; (b) never scan
    // the real tail for secrets (leak); (c) report elided_count ≈ marker length
    // (~20), not the real ~dropped bytes. The reordered pipeline captures the
    // REAL ends of the body and scrubs each retained ≤16KB segment.
    const headSecret = "Bearer sk-ant-api03-HEADaaaaaaaaaaaaSECRET";
    const tailSecret = "Bearer sk-ant-api03-REALTAILaaaaaaaaSECRET";
    const headSentinel = "HEAD_SENTINEL_REGION";
    const tailSentinel = "REAL_TAIL_SENTINEL_REGION";
    // 50KB total: head chunk + filler + tail chunk.
    const filler = "x".repeat(50 * 1024);
    const bodyStr = `${headSentinel} ${headSecret}\n${filler}\n${tailSentinel} ${tailSecret}`;
    const body = Buffer.from(bodyStr, "utf8");
    expect(body.length).toBeGreaterThan(32 * 1024);

    const sample = captureRawBytes(baseOpts({ responseBody: body }));
    expect(sample).not.toBeNull();

    // (a) The captured TAIL is the REAL end of the body (the tail-sentinel
    //     region), NOT mid-body filler and NOT a `…[unscanned]` marker, and its
    //     secret is REDACTED.
    expect(sample!.tail_bytes).toContain(tailSentinel);
    expect(sample!.tail_bytes).not.toContain("[unscanned");
    expect(sample!.tail_bytes).toContain("[REDACTED]");
    expect(sample!.tail_bytes).not.toContain(tailSecret);
    expect(sample!.tail_bytes).not.toMatch(/sk-ant-api03-REALTAIL/);

    // (b) The HEAD secret is also redacted (head sentinel retained).
    expect(sample!.head_bytes).toContain(headSentinel);
    expect(sample!.head_bytes).toContain("[REDACTED]");
    expect(sample!.head_bytes).not.toContain(headSecret);
    expect(sample!.head_bytes).not.toMatch(/sk-ant-api03-HEAD/);

    // (c) elided_count reflects the REAL dropped bytes (full body minus the two
    //     retained ≤16KB segments), i.e. tens of KB — NOT the ~20-char marker
    //     length the truncate-before-cap path produced.
    const expectedElided = body.length - RAW_BYTE_HEAD_CAP - RAW_BYTE_TAIL_CAP;
    expect(sample!.elided_count).toBe(expectedElided);
    expect(sample!.elided_count).toBeGreaterThan(10 * 1024);
  });

  it("(6) INVARIANT: across ALL body-size classes the ENTIRE retained head+tail is scrubbed (no …[unscanned] inside the sample, every retained secret REDACTED)", () => {
    // The scrub budget must equal the RETAINED segment length, whatever it is —
    // NOT a fixed 16KB. `headTailCap` returns the WHOLE body as `head` (tail
    // empty) for any body ≤ HEAD_CAP+TAIL_CAP (32KB), so `head` can be up to
    // 32KB. A fixed 16KB scrub budget truncates that head to a `…[unscanned:N]`
    // prefix, dropping the 16-32KB window from the sample AND never scanning it
    // for secrets (leak). This invariant pins every segment-size window so a
    // future budget regression is a RED test.
    //
    //   (a) <16KB           → whole body is head, well under the cap.
    //   (b) 16-32KB (24KB)  → whole body is head, EXCEEDS a fixed 16KB budget
    //                          (the regression window the A2 reorder introduced).
    //   (c) >32KB (50KB)    → real head + real tail, middle elided.
    const cases: Array<{
      label: string;
      bodyLen: number;
      expectTail: boolean;
    }> = [
      { label: "(a) <16KB", bodyLen: 8 * 1024, expectTail: false },
      { label: "(b) 16-32KB", bodyLen: 24 * 1024, expectTail: false },
      { label: "(c) >32KB", bodyLen: 50 * 1024, expectTail: true },
    ];

    for (const { label, bodyLen, expectTail } of cases) {
      resetRawByteCaptureStateForTest();

      // Plant a secret at the END of the retained HEAD region. For (a)/(b) the
      // whole body is the head, so "end of head" is the end of the body. For
      // (c) the retained head is the first HEAD_CAP bytes, so plant the secret
      // just before that boundary.
      const headSecret = "Bearer sk-ant-api03-HEADaaaaaaaaaaaaSECRET";
      const headSentinel = "HEAD_END_SENTINEL";
      const tailSecret = "Bearer sk-ant-api03-TAILaaaaaaaaaaaaSECRET";
      const tailSentinel = "TAIL_END_SENTINEL";

      let bodyStr: string;
      if (expectTail) {
        // >32KB: secret near the END of the retained head (just inside
        // HEAD_CAP) AND a secret in the REAL tail.
        const headTrailer = ` ${headSentinel} ${headSecret}`;
        const headFillLen = RAW_BYTE_HEAD_CAP - headTrailer.length - 64;
        const tailLead = `${tailSentinel} ${tailSecret} `;
        const middleLen =
          bodyLen - headFillLen - headTrailer.length - tailLead.length;
        bodyStr =
          "h".repeat(headFillLen) +
          headTrailer +
          "x".repeat(middleLen) +
          "\n" +
          tailLead;
      } else {
        // ≤32KB: the whole body is the retained head. Plant the secret at the
        // very END so a 16KB-budget truncation (in the 16-32KB case) drops it.
        const trailer = ` ${headSentinel} ${headSecret}`;
        bodyStr = "h".repeat(bodyLen - trailer.length) + trailer;
      }

      const body = Buffer.from(bodyStr, "utf8");
      const sample = captureRawBytes(baseOpts({ responseBody: body }));
      expect(sample, label).not.toBeNull();

      // (i) NO …[unscanned] marker anywhere inside the returned sample — the
      //     entire retained head/tail was scanned.
      expect(sample!.head_bytes, label).not.toContain("[unscanned");
      expect(sample!.tail_bytes, label).not.toContain("[unscanned");

      // (ii) Every planted secret in the RETAINED region is REDACTED, not
      //      present in cleartext.
      expect(sample!.head_bytes, label).toContain(headSentinel);
      expect(sample!.head_bytes, label).toContain("[REDACTED]");
      expect(sample!.head_bytes, label).not.toContain(headSecret);
      expect(sample!.head_bytes, label).not.toMatch(/sk-ant-api03-HEAD/);
      if (expectTail) {
        expect(sample!.tail_bytes, label).toContain(tailSentinel);
        expect(sample!.tail_bytes, label).toContain("[REDACTED]");
        expect(sample!.tail_bytes, label).not.toContain(tailSecret);
        expect(sample!.tail_bytes, label).not.toMatch(/sk-ant-api03-TAIL/);
      }

      // (iii) elided_count reflects ONLY headTailCap elision: 0 for ≤32KB,
      //       (body - HEAD_CAP - TAIL_CAP) for >32KB.
      if (expectTail) {
        const expectedElided =
          body.length - RAW_BYTE_HEAD_CAP - RAW_BYTE_TAIL_CAP;
        expect(sample!.elided_count, label).toBe(expectedElided);
        expect(sample!.elided_count, label).toBeGreaterThan(10 * 1024);
      } else {
        expect(sample!.elided_count, label).toBe(0);
      }
    }
  });

  it("(5) non-DEBUG tier → captureRawBytes returns null immediately", () => {
    const body = Buffer.from("data: {}\n\n", "utf8");
    const defaultTier = captureRawBytes(
      baseOpts({
        responseBody: body,
        tier: "default",
        debugEnabled: false,
      }),
    );
    expect(defaultTier).toBeNull();

    const verboseTier = captureRawBytes(
      baseOpts({
        responseBody: body,
        tier: "verbose",
        debugEnabled: false,
      }),
    );
    expect(verboseTier).toBeNull();
  });
});
