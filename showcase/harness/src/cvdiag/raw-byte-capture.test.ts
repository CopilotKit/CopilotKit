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
  parseDebugAllowList,
  resetRawByteCaptureStateForTest,
  RAW_BYTE_HEAD_CAP,
  RAW_BYTE_TAIL_CAP,
  RAW_BYTE_MAX_CAPTURES_PER_24H,
  RAW_BYTE_MAX_CAPTURES_PER_SLUG_24H,
} from "./raw-byte-capture.js";

// Isolate the process-global per-slug 24h window + ≤500/24h ring-buffer so no
// capture-count state leaks between cases.
beforeEach(() => {
  resetRawByteCaptureStateForTest();
});

const DEBUG_OPTS = { tier: "debug" as const, debugEnabled: true };

function baseOpts(overrides: {
  responseBody: Buffer;
  slug?: string;
  contentEncoding?: string;
  transferEncoding?: string;
  contentType?: string;
  tier?: "default" | "verbose" | "debug";
  debugEnabled?: boolean;
  allowedSlugs?: ReadonlySet<string>;
}) {
  const slug = overrides.slug ?? "langgraph-python";
  return {
    slug,
    testId: "0190a0c0-0000-7000-8000-000000000001",
    contentEncoding: "",
    transferEncoding: "",
    contentType: "text/event-stream",
    // Default to an allow-list that admits the chosen slug so the existing
    // pipeline cases stay green; per-slug-scoping cases override this.
    allowedSlugs: new Set([slug]),
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
    // NOT a fixed 16KB. The retained head is now ALWAYS ≤ HEAD_CAP (16KB) and
    // the tail ≤ TAIL_CAP (16KB) for every body size (the cap never returns a
    // >16KB whole-body head). The invariant: every retained byte is scanned (no
    // `…[unscanned:N]` marker) and every secret in a retained segment is
    // REDACTED, across all body-size windows.
    //
    //   (a) <16KB           → whole body is head, no tail (under HEAD_CAP).
    //   (b) 16-32KB (24KB)  → head = first ≤16KB, tail = remainder ≤16KB,
    //                          elided 0 (head+tail still cover the whole body).
    //   (c) >32KB (50KB)    → real head + real tail, middle elided.
    const cases: Array<{
      label: string;
      bodyLen: number;
      expectTail: boolean;
    }> = [
      { label: "(a) <16KB", bodyLen: 8 * 1024, expectTail: false },
      { label: "(b) 16-32KB", bodyLen: 24 * 1024, expectTail: true },
      { label: "(c) >32KB", bodyLen: 50 * 1024, expectTail: true },
    ];

    for (const { label, bodyLen, expectTail } of cases) {
      resetRawByteCaptureStateForTest();

      // Plant a head-region secret near the START of the body (lands in the
      // retained head for every case) and, when the body splits, a tail-region
      // secret at the very END of the body (lands in the retained tail). Each
      // retained segment must be fully scanned + scrubbed regardless of size.
      const headSecret = "Bearer sk-ant-api03-HEADaaaaaaaaaaaaSECRET";
      const headSentinel = "HEAD_END_SENTINEL";
      const tailSecret = "Bearer sk-ant-api03-TAILaaaaaaaaaaaaSECRET";
      const tailSentinel = "TAIL_END_SENTINEL";

      let bodyStr: string;
      if (expectTail) {
        // Body splits: head-region secret right after the start (inside the
        // first ≤16KB head) AND a tail-region secret at the very end (inside
        // the retained tail). Filler in the middle.
        const headLead = `${headSentinel} ${headSecret} `;
        const tailTrailer = ` ${tailSentinel} ${tailSecret}`;
        const middleLen = bodyLen - headLead.length - tailTrailer.length;
        bodyStr = headLead + "x".repeat(middleLen) + tailTrailer;
      } else {
        // ≤16KB: the whole body is the retained head, tail empty. Plant the
        // secret at the very end (still inside the single retained head).
        const trailer = ` ${headSentinel} ${headSecret}`;
        bodyStr = "h".repeat(bodyLen - trailer.length) + trailer;
      }

      const body = Buffer.from(bodyStr, "utf8");
      const sample = captureRawBytes(baseOpts({ responseBody: body }));
      expect(sample, label).not.toBeNull();

      // Head is ALWAYS ≤ HEAD_CAP and tail ≤ TAIL_CAP (the ≤16KB head cap).
      expect(
        Buffer.byteLength(sample!.head_bytes, "utf8"),
        label,
      ).toBeLessThanOrEqual(RAW_BYTE_HEAD_CAP);
      expect(
        Buffer.byteLength(sample!.tail_bytes, "utf8"),
        label,
      ).toBeLessThanOrEqual(RAW_BYTE_TAIL_CAP);

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

      // (iii) elided_count reflects ONLY headTailCap elision: 0 when head+tail
      //       cover the whole body (≤32KB), (body - HEAD_CAP - TAIL_CAP) for
      //       >32KB.
      if (bodyLen > RAW_BYTE_HEAD_CAP + RAW_BYTE_TAIL_CAP) {
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

  it("(6) allow-list scopes capture per slug: a non-listed slug gets NO capture even at DEBUG", () => {
    const body = Buffer.from("data: {}\n\n", "utf8");
    // Allow-list scopes DEBUG raw-byte capture to ONLY `allowed-slug`.
    const allowedSlugs = parseDebugAllowList("allowed-slug");

    // An allow-listed slug at DEBUG → capture proceeds.
    const allowed = captureRawBytes(
      baseOpts({
        slug: "allowed-slug",
        responseBody: body,
        allowedSlugs,
      }),
    );
    expect(allowed).not.toBeNull();

    // A slug NOT in the allow-list → NO capture, even though DEBUG is armed.
    // RED on the unfixed code: the slug list is never matched, so `other-slug`
    // is wrongly armed for raw-byte (PII-sensitive) capture.
    const other = captureRawBytes(
      baseOpts({
        slug: "other-slug",
        responseBody: body,
        allowedSlugs,
      }),
    );
    expect(other).toBeNull();
  });

  it("(7) parseDebugAllowList trims entries, drops empties, and is exact-match (no wildcard)", () => {
    const set = parseDebugAllowList("  a-slug , b-slug ,, ");
    expect(set.has("a-slug")).toBe(true);
    expect(set.has("b-slug")).toBe(true);
    expect(set.has("")).toBe(false);
    // No `*` wildcard semantics — the spec defines exact slug match only.
    const star = parseDebugAllowList("*");
    expect(star.has("anything")).toBe(false);
    expect(star.has("*")).toBe(true);
  });

  it("(M3-1) head+tail cap slices on code-point boundaries → no U+FFFD from a split multibyte char, and head ≤16KB", () => {
    // A body whose HEAD_CAP boundary lands in the MIDDLE of a multibyte UTF-8
    // char (emoji = 4 bytes). The raw-byte slice would split that char and emit
    // a U+FFFD (�) replacement char at the cut; a code-point-aligned cap
    // backs off to the last whole char so no U+FFFD appears. ALSO asserts the
    // ≤16KB head cap (the old code returned up to 32KB as head).
    //
    // RED (raw-byte slice): head_bytes contains "�" at the cap boundary,
    //   and for a 24KB body head_bytes byteLength is the full 24KB (>16KB).
    // GREEN (code-point slice + ≤16KB cap): no "�", head byteLength ≤16KB.
    const emoji = "😀"; // U+1F600, 4 UTF-8 bytes.
    // Fill exactly up to 2 bytes before HEAD_CAP, then an emoji straddles the
    // boundary (2 bytes before the cap, 2 bytes after).
    const fillLen = RAW_BYTE_HEAD_CAP - 2;
    const bodyStr = "a".repeat(fillLen) + emoji + "b".repeat(20 * 1024);
    const body = Buffer.from(bodyStr, "utf8");
    // Sanity: the cap boundary is mid-emoji.
    expect(body.length).toBeGreaterThan(RAW_BYTE_HEAD_CAP + RAW_BYTE_TAIL_CAP);

    const sample = captureRawBytes(baseOpts({ responseBody: body }));
    expect(sample).not.toBeNull();
    // No replacement char from a split multibyte sequence in either segment.
    expect(sample!.head_bytes).not.toContain("�");
    expect(sample!.tail_bytes).not.toContain("�");
    // Head is ≤16KB (NOT the up-to-32KB whole body the old cap returned).
    expect(Buffer.byteLength(sample!.head_bytes, "utf8")).toBeLessThanOrEqual(
      RAW_BYTE_HEAD_CAP,
    );
  });

  it("(M3-1b) 16-32KB body splits into ≤16KB head + ≤16KB tail (no >16KB head)", () => {
    // The old cap returned a body ≤32KB as a single whole-body head (up to
    // 32KB) — violating the documented head_bytes ≤16KB contract and risking PB
    // column truncation/reject. RED: a 24KB body → head_bytes byteLength 24KB.
    // GREEN: head ≤16KB, tail ≤16KB, head+tail cover the whole body (elided 0).
    const body = Buffer.from("Z".repeat(24 * 1024), "utf8");
    const sample = captureRawBytes(baseOpts({ responseBody: body }));
    expect(sample).not.toBeNull();
    expect(Buffer.byteLength(sample!.head_bytes, "utf8")).toBeLessThanOrEqual(
      RAW_BYTE_HEAD_CAP,
    );
    expect(Buffer.byteLength(sample!.tail_bytes, "utf8")).toBeLessThanOrEqual(
      RAW_BYTE_TAIL_CAP,
    );
    // head+tail cover the whole 24KB body, so nothing is elided.
    expect(sample!.elided_count).toBe(0);
    expect(
      Buffer.byteLength(sample!.head_bytes, "utf8") +
        Buffer.byteLength(sample!.tail_bytes, "utf8"),
    ).toBe(body.length);
  });

  it("(M3-2) dechunk fails closed (null → raw fallback) on malformed chunk framing", () => {
    // The decode contract: malformed `Transfer-Encoding: chunked` framing must
    // yield the CONTRACTED fallback (decodeBody returns the RAW bytes, decode
    // NOT applied), never a corrupted non-null dechunked Buffer. We observe the
    // contract through captureRawBytes: on a malformed frame the pipeline must
    // NOT report "decode" applied (dechunk returned null → raw fallback).
    //
    // RED (no validation): parseInt accepts garbage/negative hex and the CRLF
    //   after the chunk data is skipped blindly, so dechunk returns a corrupt
    //   non-null Buffer → "decode" wrongly appears in pipeline_applied.
    // GREEN: dechunk returns null → raw fallback → "decode" NOT applied.
    const allowed = new Set(["langgraph-python"]);

    // (a) Bad hex chunk size ("zz" is not hex).
    const badHex = Buffer.from("zz\r\nhello\r\n0\r\n\r\n", "latin1");
    const sa = captureRawBytes(
      baseOpts({
        responseBody: badHex,
        transferEncoding: "chunked",
        allowedSlugs: allowed,
      }),
    );
    expect(sa).not.toBeNull();
    expect(sa!.pipeline_applied).not.toContain("decode");

    // (b) Negative chunk size ("-5").
    resetRawByteCaptureStateForTest();
    const negSize = Buffer.from("-5\r\nhello\r\n0\r\n\r\n", "latin1");
    const sb = captureRawBytes(
      baseOpts({
        responseBody: negSize,
        transferEncoding: "chunked",
        allowedSlugs: allowed,
      }),
    );
    expect(sb).not.toBeNull();
    expect(sb!.pipeline_applied).not.toContain("decode");

    // (c) Missing/garbled CRLF after the chunk data (5 bytes then NO CRLF, just
    //     more data) — the old code blindly did `offset += 2`, skipping into the
    //     payload and corrupting the result.
    resetRawByteCaptureStateForTest();
    const badCrlf = Buffer.from("5\r\nhelloXX0\r\n\r\n", "latin1");
    const sc = captureRawBytes(
      baseOpts({
        responseBody: badCrlf,
        transferEncoding: "chunked",
        allowedSlugs: allowed,
      }),
    );
    expect(sc).not.toBeNull();
    expect(sc!.pipeline_applied).not.toContain("decode");

    // POSITIVE control: a WELL-FORMED chunked body still decodes (decode
    // applied, payload concatenated) — the validation is fail-closed, not
    // fail-everything.
    resetRawByteCaptureStateForTest();
    const wellFormed = Buffer.from("5\r\nhello\r\n0\r\n\r\n", "latin1");
    const sd = captureRawBytes(
      baseOpts({
        responseBody: wellFormed,
        transferEncoding: "chunked",
        allowedSlugs: allowed,
      }),
    );
    expect(sd).not.toBeNull();
    expect(sd!.pipeline_applied).toContain("decode");
    expect(`${sd!.head_bytes}${sd!.tail_bytes}`).toContain("hello");
  });

  it("(M3-3) stripHtml does NOT set metadata_dropped on mere whitespace collapse", () => {
    // An HTML-detected body that carries NO tags and NO sensitive markup — only
    // visible text with collapsible whitespace (extra newlines/spaces). The
    // strip stage collapses whitespace but removes NO actual content, so the
    // `metadata_dropped` flag (which signals sensitive content was removed)
    // MUST stay false.
    //
    // RED (length compare): `stripped.length < before` trips on the whitespace
    //   collapse → metadata_dropped wrongly true.
    // GREEN (non-whitespace compare): no non-ws content removed →
    //   metadata_dropped false.
    //
    // The body is forced down the html-strip path by an explicit text/html
    // content-type even though it contains no tags.
    const body = Buffer.from(
      "Just a moment...\n\n\n   please   wait   \n\n",
      "utf8",
    );
    const sample = captureRawBytes(
      baseOpts({
        responseBody: body,
        contentType: "text/html; charset=UTF-8",
      }),
    );
    expect(sample).not.toBeNull();
    expect(sample!.pipeline_applied).toContain("html_strip");
    // The visible text survives.
    expect(`${sample!.head_bytes}${sample!.tail_bytes}`).toContain(
      "Just a moment",
    );
    // No NON-whitespace content was removed → the dropped flag stays false.
    expect(sample!.metadata_dropped).toBe(false);
  });

  it("(M3-3b) stripHtml DOES set metadata_dropped when real content is removed (regression control)", () => {
    // Positive control: a `<script>` body carries real (sensitive) content that
    // IS removed → metadata_dropped MUST be true. Guards against the fix
    // over-correcting to never flag.
    const body = Buffer.from(
      "<html><body>visible<script>secretpayload123</script>text</body></html>",
      "utf8",
    );
    const sample = captureRawBytes(
      baseOpts({
        responseBody: body,
        contentType: "text/html",
      }),
    );
    expect(sample).not.toBeNull();
    expect(sample!.metadata_dropped).toBe(true);
    expect(`${sample!.head_bytes}${sample!.tail_bytes}`).not.toContain(
      "secretpayload123",
    );
  });

  it("(M3-4) per-slug 24h cap is SMALLER than the global cap so one noisy slug cannot drain the whole budget", () => {
    // The per-slug starvation guard must trip at its OWN (smaller) constant, not
    // reuse the global 500. With the per-slug cap < global cap, a single slug is
    // cut off at the per-slug cap while the global budget still has room for
    // OTHER slugs.
    //
    // RED (per-slug reuses global 500): the per-slug guard never trips before
    //   the global cap, so slug "noisy" keeps capturing past
    //   RAW_BYTE_MAX_CAPTURES_PER_SLUG_24H and starves the global budget.
    // GREEN: "noisy" is cut at the per-slug cap; "other" still captures.
    expect(RAW_BYTE_MAX_CAPTURES_PER_SLUG_24H).toBeLessThan(
      RAW_BYTE_MAX_CAPTURES_PER_24H,
    );

    const allowed = new Set(["noisy", "other"]);
    const body = Buffer.from("data: {}\n\n", "utf8");
    const opts = (slug: string) =>
      baseOpts({ slug, responseBody: body, allowedSlugs: allowed });

    // The noisy slug captures up to its per-slug cap, then is cut off.
    let admitted = 0;
    for (let i = 0; i < RAW_BYTE_MAX_CAPTURES_PER_SLUG_24H + 5; i += 1) {
      if (captureRawBytes(opts("noisy")) !== null) admitted += 1;
    }
    expect(admitted).toBe(RAW_BYTE_MAX_CAPTURES_PER_SLUG_24H);

    // A DIFFERENT slug still has budget — the noisy slug did NOT drain it.
    const other = captureRawBytes(opts("other"));
    expect(other).not.toBeNull();
  });
});
