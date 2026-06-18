/**
 * raw-byte-capture.test.ts — L2-C: Phase 2.5 DEBUG-tier raw-byte capture
 * pipeline (spec §11.4 T2 / Phase 2.5, R2-NF3 normative pipeline order).
 *
 * The five tests below pin the normative behaviour:
 *   (1) forced empty-200 → a sample is produced and redaction is applied
 *       (no `Bearer …` / `sk-…` survives into the stored head/tail).
 *   (2) GZIPPED body carrying `sk-test-12345…` → decoded BEFORE scrub so the
 *       secret never survives — the critical decode-before-scrub ordering proof.
 *   (3) Cloudflare challenge HTML → html-strip removes `<script>`/`<style>` so
 *       no script source survives into the stored bytes.
 *   (4) body >32KB → head+tail cap keeps ≤16KB head + ≤16KB tail, `elided > 0`.
 *   (5) non-DEBUG tier → `captureRawBytes` returns null immediately.
 */

import { gzipSync } from "node:zlib";
import { describe, it, expect, beforeEach } from "vitest";

import {
  captureRawBytes,
  resetRawByteCaptureStateForTest,
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
