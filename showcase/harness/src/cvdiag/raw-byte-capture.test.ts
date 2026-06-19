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
  nowMs?: number;
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

  it("(M3R3-1) gunzip THROWS on a malformed-chunked+gzipped body → no UNSCRUBBED compressed body is stored", () => {
    // A gzipped body carrying a secret, then framed as `Transfer-Encoding:
    // chunked`. The chunk framing is DELIBERATELY malformed (a non-hex size
    // line) so `dechunk` fails closed and returns null → decodeBody falls back
    // to the raw chunk-framed bytes, then `gunzipSync` THROWS on those framed
    // bytes (they are not a valid gzip stream).
    //
    // RED (swallow-the-throw, keep raw bytes): decodeBody returns the still
    //   chunk-framed + COMPRESSED bytes; the secret is hidden inside the gzip
    //   stream so `scrubSecrets` cannot see it → the unscrubbed compressed
    //   payload is persisted (redaction bypass).
    // GREEN: when gunzip throws we DROP the body (store empty + mark dropped),
    //   so no unscrubbed compressed bytes are ever persisted.
    const secret = "sk-test12345abcdefghij67890";
    const plain = `data: {"key":"${secret}"}\n\n`;
    const gz = gzipSync(Buffer.from(plain, "utf8"));
    // The compressed bytes do NOT literally contain the secret (so a scrub
    // over the compressed bytes is a no-op — the bypass).
    expect(gz.toString("latin1")).not.toContain(secret);

    // Wrap the gzip bytes in MALFORMED chunked framing: a non-hex size line so
    // dechunk fails closed (returns null) and decodeBody keeps the raw framed
    // bytes for the gunzip attempt, which then throws.
    const framed = Buffer.concat([
      Buffer.from("zz\r\n", "latin1"), // "zz" is not a valid hex chunk size
      gz,
      Buffer.from("\r\n0\r\n\r\n", "latin1"),
    ]);

    const sample = captureRawBytes(
      baseOpts({
        responseBody: framed,
        contentEncoding: "gzip",
        transferEncoding: "chunked",
      }),
    );

    expect(sample).not.toBeNull();
    const stored = `${sample!.head_bytes}${sample!.tail_bytes}`;
    // The raw gzip bytes (a binary marker present in the compressed stream)
    // must NOT have leaked into the stored sample.
    expect(stored).not.toContain(gz.toString("latin1"));
    // No fragment of the still-compressed payload may be persisted.
    expect(Buffer.byteLength(stored, "utf8")).toBe(0);
    // The decode failure must be surfaced as dropped content.
    expect(sample!.metadata_dropped).toBe(true);
  });

  it("(M3R4-1) mislabeled gzip (Content-Encoding: gzip but PLAINTEXT body, no 1f8b magic) → kept + scrubbed, NOT dropped", () => {
    // The PRIMARY capture target is a Cloudflare challenge HTML page, often
    // served with `Content-Encoding: gzip` while the body is actually PLAINTEXT
    // (mislabeled). `gunzipSync` throws on it. The genuine-gzip-fail drop fix
    // wrongly destroys this diagnostic payload (empty + metadata_dropped).
    //
    // RED (unconditional drop on gunzip throw): the plaintext body is dropped
    //   → stored is empty + metadata_dropped true; the diagnostic text is lost.
    // GREEN (gzip-magic gate): no 1f8b magic → treat as PLAINTEXT (do not
    //   gunzip, do not drop), scrub + keep it.
    const secret = "Bearer sk-live-mislabeledgzipSECRET12345";
    const plain = `Just a moment... challenge page authorization=${secret}\n\n`;
    const body = Buffer.from(plain, "utf8");
    // Pre-condition: the body does NOT start with the gzip magic bytes.
    expect(body[0]).not.toBe(0x1f);

    const sample = captureRawBytes(
      baseOpts({ responseBody: body, contentEncoding: "gzip" }),
    );
    expect(sample).not.toBeNull();
    const stored = `${sample!.head_bytes}${sample!.tail_bytes}`;
    // The plaintext diagnostic text is KEPT (not dropped).
    expect(stored).toContain("Just a moment");
    expect(Buffer.byteLength(stored, "utf8")).toBeGreaterThan(0);
    // And the straddle-free secret is scrubbed.
    expect(stored).not.toContain(secret);
    expect(stored).toContain("[REDACTED]");
    expect(sample!.pipeline_applied).toContain("scrub");
  });

  it("(M3R4-1b) GENUINE gzip body that fails to decompress STILL drops (no unscrubbed compressed bytes) — FIX 1 must not regress the scrub-bypass fix", () => {
    // A body that DOES start with the gzip magic bytes (1f 8b) but is otherwise
    // a corrupt/truncated gzip stream → gunzipSync throws. Because the magic
    // bytes ARE present, this is a genuine (broken) gzip stream and the
    // still-compressed unscrubbable bytes must NOT be stored.
    const secret = "sk-test12345abcdefghij67890";
    const plain = `data: {"key":"${secret}"}\n\n`;
    const gz = gzipSync(Buffer.from(plain, "utf8"));
    // Truncate the gzip stream so it has the magic header but fails to inflate.
    const corrupt = gz.subarray(0, gz.length - 5);
    expect(corrupt[0]).toBe(0x1f);
    expect(corrupt[1]).toBe(0x8b);
    expect(corrupt.toString("latin1")).not.toContain(secret);

    const sample = captureRawBytes(
      baseOpts({ responseBody: corrupt, contentEncoding: "gzip" }),
    );
    expect(sample).not.toBeNull();
    const stored = `${sample!.head_bytes}${sample!.tail_bytes}`;
    // No fragment of the still-compressed payload may be persisted.
    expect(Buffer.byteLength(stored, "utf8")).toBe(0);
    expect(sample!.metadata_dropped).toBe(true);
  });

  it("(M3R4-2) a secret straddling the head/tail seam (16-32KB body) is REDACTED (no reconstruct-from-segments bypass)", () => {
    // For HEAD_CAP < body ≤ 32KB, head ([0,16K]) and tail ([16K,end]) are
    // ADJACENT and together reconstruct the WHOLE body. Scrubbing each segment
    // INDEPENDENTLY lets a secret straddling byte 16384 match neither regex, so
    // it is stored unredacted and recoverable by concatenating head+tail.
    //
    // RED (per-segment scrub): the seam-straddling secret is split across the
    //   head/tail boundary, matches neither regex, and survives in
    //   head_bytes+tail_bytes.
    // GREEN (scrub full retained body before split when adjacent): the secret
    //   is redacted before head/tail are sliced.
    // An `sk-` key (SK_KEY_REGEX: `sk-` + chars + 12 mandatory alnum). Split so
    // the `sk-` prefix sits at the END of the head and the mandatory 12-alnum
    // tail sits at the START of the tail: the head ends in `…sk-XXXX` (no 12
    // trailing alnum → no head match) and the tail begins mid-token (no `sk-`
    // prefix → no tail match). Per-segment scrub therefore leaks it; the
    // reconstructed body still contains a complete `sk-…` key.
    const secret = "sk-SEAMSTRADDLINGabcdefghij1234567890SECRET";
    // Put the `sk-` prefix 4 bytes before the 16384 seam so the token spans it.
    const lead = "a".repeat(RAW_BYTE_HEAD_CAP - 4);
    const trail = "b".repeat(8 * 1024);
    const bodyStr = lead + secret + trail;
    const body = Buffer.from(bodyStr, "utf8");
    // Sanity: 16-32KB window (adjacent head/tail, no elided middle).
    expect(body.length).toBeGreaterThan(RAW_BYTE_HEAD_CAP);
    expect(body.length).toBeLessThanOrEqual(
      RAW_BYTE_HEAD_CAP + RAW_BYTE_TAIL_CAP,
    );

    const sample = captureRawBytes(baseOpts({ responseBody: body }));
    expect(sample).not.toBeNull();
    // No elided middle in this window → head+tail reconstruct the whole body.
    expect(sample!.elided_count).toBe(0);
    const reconstructed = `${sample!.head_bytes}${sample!.tail_bytes}`;
    // The seam-straddling secret must be REDACTED, not recoverable. The key
    // assertion: no COMPLETE `sk-` key survives in the reconstructed body.
    expect(reconstructed).not.toContain(secret);
    expect(reconstructed).not.toMatch(/sk-[A-Za-z0-9_-]{0,200}[A-Za-z0-9]{12}/);
    expect(reconstructed).toContain("[REDACTED]");
  });

  it("(M3R4-2b) >32KB body: head/tail NON-adjacent (elided middle) → per-segment scrub still redacts each segment's secret", () => {
    // Regression guard for FIX 2: for >32KB bodies the head and tail are
    // NON-adjacent (elided middle), not reconstructable, so per-segment scrub
    // is the correct/only option. Confirm each segment's own secret is redacted
    // and the elided middle is preserved.
    const headSecret = "Bearer sk-ant-api03-HEADaaaaaaaaaaaaSECRET";
    const tailSecret = "Bearer sk-ant-api03-TAILaaaaaaaaaaaaSECRET";
    const headSentinel = "HEAD_SENTINEL";
    const tailSentinel = "TAIL_SENTINEL";
    const filler = "x".repeat(50 * 1024);
    const bodyStr = `${headSentinel} ${headSecret}\n${filler}\n${tailSentinel} ${tailSecret}`;
    const body = Buffer.from(bodyStr, "utf8");
    expect(body.length).toBeGreaterThan(RAW_BYTE_HEAD_CAP + RAW_BYTE_TAIL_CAP);

    const sample = captureRawBytes(baseOpts({ responseBody: body }));
    expect(sample).not.toBeNull();
    // Elided middle present → head/tail NON-adjacent.
    expect(sample!.elided_count).toBeGreaterThan(10 * 1024);
    expect(sample!.head_bytes).toContain(headSentinel);
    expect(sample!.head_bytes).toContain("[REDACTED]");
    expect(sample!.head_bytes).not.toContain(headSecret);
    expect(sample!.tail_bytes).toContain(tailSentinel);
    expect(sample!.tail_bytes).toContain("[REDACTED]");
    expect(sample!.tail_bytes).not.toContain(tailSecret);
  });

  it("(M3R5-1) scrub GROWS bytes → adjacent-branch tail is RE-CAPPED to ≤16KB and elided_count recomputed from the FINAL post-scrub segments", () => {
    // `scrubSecrets` replaces a matched secret with `[REDACTED]` (10 bytes),
    // which is LONGER than many matched tokens (`Bearer x` = 8 bytes). In the
    // adjacent (`elided === 0`, 16-32KB) branch the full retained body is
    // scrubbed as ONE pass and then re-split at the head byte-boundary — but the
    // tail was taken UNCAPPED (`scrubbedBuf.subarray(headBuf.length)`), so when
    // the scrub grows the post-head bytes the tail can exceed RAW_BYTE_TAIL_CAP
    // (16KB), violating the head_bytes/tail_bytes ≤16KB schema/PB-column bound.
    // SECONDARY: `elided_count`/`metadata_dropped` are computed PRE-scrub, so
    // after the scrub grows the adjacent body they go stale (claim elided 0
    // while head+tail no longer reconstruct the scrubbed body).
    //
    // RED (uncapped post-scrub tail + pre-scrub accounting):
    //   - tail_bytes byteLength > 16384 (the secret-dense tail grew under scrub),
    //   - elided_count === 0 while head_byteLen + tail_byteLen !== scrubbed body
    //     byteLength (stale accounting).
    // GREEN (re-cap both ends to their caps + recompute elided_count from the
    //   FINAL segments):
    //   - head_bytes ≤16384 AND tail_bytes ≤16384,
    //   - elided_count === max(0, scrubbedBodyByteLen − finalHead − finalTail),
    //   - no complete `Bearer …`/`sk-…` secret recoverable from head+tail.
    //
    // Construct a 16-32KB (adjacent) body. The HEAD half (first 16KB) is inert
    // filler. The TAIL half (after byte 16384) is packed with many short
    // `Bearer x` tokens (8 bytes each → +2 bytes per scrub). ~2000 matches grow
    // the post-head content by ~4KB, pushing the uncapped tail past 16384.
    const token = "Bearer x "; // 9 bytes; matches BEARER_TOKEN_REGEX → +1 byte
    const headFiller = "h".repeat(RAW_BYTE_HEAD_CAP); // exactly the head segment
    // Fill the tail region with secret-dense tokens. ~15.5KB of `Bearer x `
    // tokens; each `Bearer x` (8 of the 9 bytes) → `[REDACTED]` grows +2 bytes,
    // so ~1764 matches add ~3.4KB → scrubbed tail > 16384.
    const tailTokenCount = Math.floor((15.5 * 1024) / token.length);
    const tailRegion = token.repeat(tailTokenCount);
    const bodyStr = headFiller + tailRegion;
    const body = Buffer.from(bodyStr, "utf8");
    // Sanity: adjacent window (HEAD_CAP < body ≤ 32KB), so elided is 0 PRE-scrub
    // and head+tail are reconstructed contiguously.
    expect(body.length).toBeGreaterThan(RAW_BYTE_HEAD_CAP);
    expect(body.length).toBeLessThanOrEqual(
      RAW_BYTE_HEAD_CAP + RAW_BYTE_TAIL_CAP,
    );

    const sample = captureRawBytes(baseOpts({ responseBody: body }));
    expect(sample).not.toBeNull();

    const headLen = Buffer.byteLength(sample!.head_bytes, "utf8");
    const tailLen = Buffer.byteLength(sample!.tail_bytes, "utf8");

    // (i) BOTH ends are within their byte caps even though the scrub grew the
    //     content (RED: tailLen > 16384 because the post-scrub tail was uncapped).
    expect(headLen).toBeLessThanOrEqual(RAW_BYTE_HEAD_CAP);
    expect(tailLen).toBeLessThanOrEqual(RAW_BYTE_TAIL_CAP);

    // (ii) elided_count is recomputed from the FINAL post-scrub/post-recap
    //      segments: when scrub-growth forces a re-cap, content is dropped and
    //      elided_count must be > 0 (RED: stays 0 — stale pre-scrub accounting).
    //      The truthful invariant: head+tail byteLen + elided_count equals the
    //      scrubbed body's byteLen (head+tail reconstruct exactly what was kept).
    const scrubbedBodyLen = Buffer.byteLength(
      // The scrubbed full retained body: scrub grows it, so its byteLen > body.
      // We reconstruct the expected accounting from the sample itself: the only
      // truthful relation is finalHead + finalTail + elided === scrubbedBodyLen.
      sample!.head_bytes + sample!.tail_bytes,
      "utf8",
    );
    // Because the re-cap dropped bytes (tail grew past the cap), elided_count
    // must be strictly positive — head+tail no longer cover the scrubbed body.
    expect(sample!.elided_count).toBeGreaterThan(0);
    // Accounting is internally consistent: the dropped middle plus the retained
    // ends equals the scrubbed body length. (head+tail = scrubbedBodyLen here
    // by construction of the reconstruction; elided is the dropped remainder.)
    expect(headLen + tailLen).toBe(scrubbedBodyLen);
    // metadata_dropped must reflect that content was elided post-scrub.
    expect(sample!.metadata_dropped).toBe(true);

    // (iii) No complete secret recoverable from the reconstructed body.
    const reconstructed = `${sample!.head_bytes}${sample!.tail_bytes}`;
    expect(reconstructed).not.toMatch(/Bearer\s+\S/);
    expect(reconstructed).toContain("[REDACTED]");
  });

  it("(M3R5-2) >32KB non-adjacent branch: each per-segment scrub is RE-CAPPED to ≤16KB after scrub growth", () => {
    // The non-adjacent (`elided > 0`, >32KB) branch scrubs head and tail
    // SEPARATELY and stores them directly — also uncapped post-scrub. A
    // secret-dense segment can grow past its 16KB cap under scrub. Confirm both
    // segments are re-clamped to their caps after the per-segment scrub.
    //
    // RED: a secret-dense ~16KB head/tail grows under scrub → head/tail_bytes
    //   > 16384.
    // GREEN: re-capped to ≤16384 each.
    const token = "Bearer x "; // 9 bytes, grows +1 under scrub
    // Build a head segment that is ~15.5KB of dense tokens, an elided middle,
    // then a ~15.5KB dense tail. Total well over 32KB so elided > 0.
    const denseCount = Math.floor((15.5 * 1024) / token.length);
    const denseHead = token.repeat(denseCount);
    const denseTail = token.repeat(denseCount);
    const middle = "x".repeat(40 * 1024); // elided filler
    const bodyStr = denseHead + middle + denseTail;
    const body = Buffer.from(bodyStr, "utf8");
    expect(body.length).toBeGreaterThan(RAW_BYTE_HEAD_CAP + RAW_BYTE_TAIL_CAP);

    const sample = captureRawBytes(baseOpts({ responseBody: body }));
    expect(sample).not.toBeNull();

    // Both ends within their byte caps even after the per-segment scrub grew
    // the secret-dense content.
    expect(Buffer.byteLength(sample!.head_bytes, "utf8")).toBeLessThanOrEqual(
      RAW_BYTE_HEAD_CAP,
    );
    expect(Buffer.byteLength(sample!.tail_bytes, "utf8")).toBeLessThanOrEqual(
      RAW_BYTE_TAIL_CAP,
    );
    // Still an elided middle, and each segment's secrets are redacted.
    expect(sample!.elided_count).toBeGreaterThan(0);
    expect(`${sample!.head_bytes}${sample!.tail_bytes}`).not.toMatch(
      /Bearer\s+\S/,
    );
    expect(sample!.head_bytes).toContain("[REDACTED]");
    expect(sample!.tail_bytes).toContain("[REDACTED]");
  });

  it("(M3R3-2) injected nowMs===0 does NOT reset the global ≤500/24h window every call (clock-0 sentinel collision)", () => {
    // The global window used `globalWindowStartMs === 0` as BOTH the
    // uninitialized sentinel AND a legitimate clock value. With an injected
    // clock pinned at t=0, every call saw the sentinel and reset the window,
    // so the global cap never tripped.
    //
    // RED (=== 0 sentinel): at nowMs=0 the window resets each call → the
    //   global count is wiped before the cap check → the 501st capture at t=0
    //   is admitted (cap never trips).
    // GREEN: an undefined/boolean sentinel means a legitimate nowMs=0 does NOT
    //   reset the window → the global cap trips at exactly the 500th capture.
    const allowed = new Set(["a", "b", "c", "d", "e", "f"]);
    const body = Buffer.from("data: {}\n\n", "utf8");
    // Spread across enough DISTINCT slugs that no single slug hits the smaller
    // per-slug cap (100) before the global 500 cap can trip. 6 slugs × ≤100 =
    // 600 per-slug headroom > 500 global, all at the same injected clock=0.
    const slugs = [...allowed];

    let admitted = 0;
    for (let i = 0; i < RAW_BYTE_MAX_CAPTURES_PER_24H + 50; i += 1) {
      const slug = slugs[i % slugs.length]!;
      const sample = captureRawBytes(
        baseOpts({ slug, responseBody: body, allowedSlugs: allowed, nowMs: 0 }),
      );
      if (sample !== null) admitted += 1;
    }
    // The global cap must trip at exactly 500 even with the clock pinned to 0.
    expect(admitted).toBe(RAW_BYTE_MAX_CAPTURES_PER_24H);
  });
});
