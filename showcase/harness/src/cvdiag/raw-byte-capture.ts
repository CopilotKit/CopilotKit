/**
 * raw-byte-capture.ts — L2-C / Phase 2.5: DEBUG-tier raw-byte capture of a
 * 200-but-empty SSE response, with the normative PII-redaction pipeline
 * (spec §11.4 T2 / Phase 2.5, R2-NF3).
 *
 * WHY this exists: a clean 200 whose assistant text stays empty (the d4 flap
 * surface, class (d)) is indistinguishable, from the event-shape signals
 * alone, between an origin-emitted empty stream, an edge-cut mid-stream, and a
 * Cloudflare challenge HTML page served in place of the SSE. Capturing the
 * literal bytes — DECODED, SCRUBBED, HTML-STRIPPED, and head/tail-capped —
 * lets the classifier tell those three apart. This is the ONLY place CVDIAG
 * captures a response body, and it is gated hard to DEBUG tier (spec §2
 * non-goal #3 carve-out).
 *
 * PIPELINE ORDER (critical, R2-NF3 — must run in this exact sequence):
 *   1. DECODE   — gunzip if `Content-Encoding: gzip`; dechunk if
 *                 `Transfer-Encoding: chunked`. Scrubbing raw COMPRESSED bytes
 *                 is ineffective: a `sk-…` secret hidden inside a gzip stream
 *                 would survive a scrub applied before decode. Decode FIRST.
 *   2. HTML-STRIP — if `text/html` (or the body looks like an HTML challenge
 *                 page), drop `<script>` / `<style>` / fingerprint-payload
 *                 blocks and retain only the visible text (CF "Just a
 *                 moment…" challenge interstitials).
 *   3. HEAD+TAIL CAP — keep ≤16KB head + ≤16KB tail (32KB max); the elided
 *                 middle is accounted for by `elided_count` (bytes dropped),
 *                 computed against the FULL decoded+stripped body.
 *   4. SCRUB    — reuse edge-headers.ts `scrubSecrets()` (Bearer / sk- /
 *                 URL-userinfo) on the RETAINED head and tail SEPARATELY.
 *
 * WHY scrub LAST, per-segment (not over the full body before the cap): the
 * elided middle is dropped from the sample anyway, so scrubbing the retained
 * head and tail covers every byte that can possibly be stored. Each retained
 * segment is scrubbed with a scan budget equal to ITS OWN length, so the WHOLE
 * segment is always scanned (no `…[unscanned]` truncation inside the stored
 * sample) for any body size. The segments are bounded by `headTailCap`: head ≤
 * HEAD_CAP (16KB) and tail ≤ TAIL_CAP (16KB) for ALL body sizes — the cap never
 * returns a >16KB head. Bounded (≤16KB each) × linear regex = O(constant), so
 * this stays ReDoS-impossible. The earlier scrub-before-cap order forced
 * `scrubSecrets` onto the FULL body: for a body >32KB it hit the bounded-prefix
 * path, truncating to a `…[unscanned:N]` prefix BEFORE the cap — which lost the
 * real tail, never scanned it for secrets, and zeroed out the true
 * `elided_count`. Sizing each scrub budget to the segment's own length (now ≤
 * HEAD_CAP/TAIL_CAP) eliminates the truncation for every body-size window.
 *
 * GUARD (R4-F12): DEBUG tier ONLY. `captureRawBytes()` returns `null`
 * immediately when the resolved tier is not `debug`. Beyond the tier gate the
 * module enforces a per-slug 24h auto-disable and a global ≤500-captures/24h
 * ring-buffer (drop-oldest accounting), so a long-lived DEBUG session can
 * never accumulate unbounded body samples.
 *
 * Pure instrumentation: a capture fault must NEVER throw into the probe it
 * observes — every failure path returns `null` rather than raising.
 *
 * STATUS — EXPERIMENTAL, DEBUG-tier, NON-PROD, OPT-IN: raw-byte body capture is
 * default-OFF and reachable ONLY when DEBUG is armed (fail-closed safe-env guard
 * in emit.ts) AND the emitting slug is in `CVDIAG_DEBUG_ALLOW_LIST`
 * (`allowedSlugs` per-slug gate below). It is NOT hardened against adversarial
 * input: the `stripHtml` regex passes (O(n²) ReDoS) and the `gunzipSync` decode
 * (unbounded gzip-bomb expansion) are KNOWN unhardened risks, tracked as a
 * DEFERRED follow-up — do NOT treat this path as production-safe until that
 * hardening lands. (The ≤32KB head/tail cap + linear scrub keep the SCRUB stage
 * bounded, but decode/strip run before the cap on the full decoded body.)
 */

import { gunzipSync } from "node:zlib";

import { scrubSecrets } from "./edge-headers.js";

/** Per-side head/tail cap (spec §11.4: ≤16KB head + ≤16KB tail, 32KB max). */
export const RAW_BYTE_HEAD_CAP = 16 * 1024;
export const RAW_BYTE_TAIL_CAP = 16 * 1024;

/** Storage budget: ≤500 captures total per 24h, ring-buffer beyond (R2-NF3). */
export const RAW_BYTE_MAX_CAPTURES_PER_24H = 500;

/**
 * Per-slug 24h sub-budget: ≤100 captures from any single slug per 24h. Smaller
 * than the global cap so one noisy slug cannot drain the whole ≤500 global
 * budget and starve the other allow-listed slugs (spec §11.4 per-slug
 * auto-disable). Reusing the global 500 here would let the per-slug guard never
 * trip before the global cap — defeating the starvation guard's purpose.
 */
export const RAW_BYTE_MAX_CAPTURES_PER_SLUG_24H = 100;

/** Per-slug DEBUG auto-disable window (spec §11.4: 24h). */
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/** The ordered pipeline stages, surfaced on the sample for downstream audit. */
export type RawBytePipelineStage =
  | "decode"
  | "scrub"
  | "html_strip"
  | "headtail";

/**
 * One DEBUG-tier raw-byte sample. Maps 1:1 onto the PB writer's
 * `CvdiagRawByteSampleRecord` (cvdiag_raw_byte_samples schema) so the caller
 * can hand it straight to `CvdiagPbWriter.writeRawByteSample()`.
 */
export interface RawByteSample {
  test_id: string;
  slug: string;
  ts: string;
  /** Ordered list of pipeline stages that actually ran on this sample. */
  pipeline_applied: RawBytePipelineStage[];
  /** ≤16KB head of the post-pipeline bytes (UTF-8). */
  head_bytes: string;
  /** ≤16KB tail of the post-pipeline bytes (UTF-8). Empty if not elided. */
  tail_bytes: string;
  /** Number of bytes elided from the middle (0 when the body fit the cap). */
  elided_count: number;
  /** True iff a decode/scrub/strip step dropped content beyond the head/tail. */
  metadata_dropped: boolean;
}

/**
 * Parse the `CVDIAG_DEBUG_ALLOW_LIST` env value (a comma-separated slug list)
 * into a `Set` of slugs ONCE, trimming each entry and dropping empties. DEBUG
 * raw-byte capture is scoped to EXACTLY these slugs (spec §6 / threat-model
 * §1.6) — an exact slug match, NO `*` wildcard (the spec defines no wildcard;
 * a literal `"*"` entry matches only the slug `"*"`). An `undefined`/empty
 * value yields an empty set → no slug is ever capture-eligible (the
 * constructor's presence check still requires a non-empty value to ARM DEBUG;
 * this is the per-event SCOPE on top of that opt-in).
 */
export function parseDebugAllowList(
  value: string | undefined,
): ReadonlySet<string> {
  if (value === undefined) return new Set();
  const slugs = new Set<string>();
  for (const entry of value.split(",")) {
    const trimmed = entry.trim();
    if (trimmed !== "") slugs.add(trimmed);
  }
  return slugs;
}

/** Inputs to one raw-byte capture attempt. */
export interface CaptureRawBytesOptions {
  /** Service slug (per-slug 24h auto-disable + ring-buffer keying). */
  slug: string;
  /**
   * The parsed `CVDIAG_DEBUG_ALLOW_LIST` slug set (see `parseDebugAllowList`).
   * DEBUG raw-byte capture is admitted ONLY when `slug` is in this set — the
   * per-event SCOPE that the construction-time presence check (which only
   * verifies the list is non-empty to opt INTO DEBUG) does not enforce. An
   * empty set admits NO slug.
   */
  allowedSlugs: ReadonlySet<string>;
  /** Per-level CVDIAG test_id (UUIDv7); threaded onto the sample. */
  testId: string;
  /** Literal response bytes as observed on the wire (possibly compressed). */
  responseBody: Buffer;
  /** `Content-Encoding` header value (e.g. `gzip`). */
  contentEncoding: string;
  /** `Transfer-Encoding` header value (e.g. `chunked`). */
  transferEncoding: string;
  /** `Content-Type` header value; drives the html-strip decision. */
  contentType?: string;
  /** Resolved CVDIAG tier; capture runs ONLY at `debug`. */
  tier: "default" | "verbose" | "debug";
  /**
   * True iff DEBUG capture is armed (`CVDIAG_DEBUG=1` resolved + not
   * fail-closed). A belt-and-suspenders companion to `tier === "debug"`.
   */
  debugEnabled: boolean;
  /** Injectable clock (ms since epoch) for deterministic 24h-window tests. */
  nowMs?: number;
}

/**
 * Per-slug capture bookkeeping: the rolling 24h window start and the count of
 * captures taken within it. Lives at module scope because a single harness
 * process owns the whole probe run; the ring-buffer is process-global.
 */
interface SlugCaptureState {
  windowStartMs: number;
  count: number;
}

const slugStateByName = new Map<string, SlugCaptureState>();
/**
 * Global rolling window start across all slugs (the ≤500/24h ring-buffer).
 * `undefined` is the UNINITIALIZED sentinel — distinct from a legitimate clock
 * value of `0`. Using `0` as both the sentinel AND a real clock reading let an
 * injected `nowMs === 0` reset the window on every call, so the global cap
 * never tripped at clock-0. Mirrors the per-slug `state === undefined` sentinel.
 */
let globalWindowStartMs: number | undefined = undefined;
let globalCount = 0;

/**
 * Reset all in-memory capture bookkeeping. Test-only seam so the per-slug 24h
 * window and the global ring-buffer do not leak state across test cases.
 */
export function resetRawByteCaptureStateForTest(): void {
  slugStateByName.clear();
  globalWindowStartMs = undefined;
  globalCount = 0;
}

/**
 * Roll the per-slug + global 24h windows forward to `nowMs`, then admit one
 * capture iff neither budget is exhausted. Returns true when the capture is
 * within budget (and accounts for it); false when the ring-buffer rejects it.
 */
function admitCapture(slug: string, nowMs: number): boolean {
  // Global ≤500/24h ring-buffer. `undefined` is the uninitialized sentinel
  // (NOT `0`, which is a legitimate injected clock value) so a real nowMs===0
  // never spuriously resets the window mid-run.
  if (
    globalWindowStartMs === undefined ||
    nowMs - globalWindowStartMs >= TWENTY_FOUR_HOURS_MS
  ) {
    globalWindowStartMs = nowMs;
    globalCount = 0;
  }
  if (globalCount >= RAW_BYTE_MAX_CAPTURES_PER_24H) {
    return false;
  }

  // Per-slug 24h auto-disable: each slug gets its own rolling window so a
  // single noisy slug cannot starve the others, and a slug that has been
  // capturing for >24h rolls into a fresh window (auto-disable then re-arm on
  // the next window — the DEBUG session itself is still time-bounded by the
  // emitter's 10-minute wall-clock).
  let state = slugStateByName.get(slug);
  if (
    state === undefined ||
    nowMs - state.windowStartMs >= TWENTY_FOUR_HOURS_MS
  ) {
    state = { windowStartMs: nowMs, count: 0 };
    slugStateByName.set(slug, state);
  }
  if (state.count >= RAW_BYTE_MAX_CAPTURES_PER_SLUG_24H) {
    return false;
  }

  state.count += 1;
  globalCount += 1;
  return true;
}

/** Decode transfer/content encodings to plaintext bytes (step 1). */
function decodeBody(
  body: Buffer,
  contentEncoding: string,
  transferEncoding: string,
): { decoded: Buffer; applied: boolean; decodeFailed: boolean } {
  let buf = body;
  let applied = false;

  // Dechunk first (transfer-encoding is the outer wrapper): strip the
  // hex-length + CRLF framing of `Transfer-Encoding: chunked` so the inner
  // bytes (which may themselves be gzip) are contiguous.
  if (/\bchunked\b/i.test(transferEncoding)) {
    const dechunked = dechunk(buf);
    if (dechunked !== null) {
      buf = dechunked;
      applied = true;
    }
  }

  // Then gunzip if the content was gzip-compressed — gated on whether the body
  // actually carries the gzip MAGIC bytes (0x1f 0x8b) ANYWHERE. The PRIMARY
  // capture target — a Cloudflare challenge HTML page — is frequently served
  // with a `Content-Encoding: gzip` header while the body is actually PLAINTEXT
  // (mislabeled). Without a magic-byte gate `gunzipSync` throws on that
  // plaintext and the whole diagnostic payload is destroyed. So:
  //   - NO gzip magic anywhere → the header lies; the body is genuine PLAINTEXT
  //     (do NOT gunzip, do NOT drop — fall through to scrub + keep it).
  //   - gzip magic PRESENT (at offset 0, or embedded after a chunk-framing
  //     fallback) → a GENUINE gzip stream whose compressed bytes hide any secret
  //     from `scrubSecrets`. Attempt the decode; if it throws (framed / corrupt
  //     / truncated stream) the still-compressed bytes must NOT be persisted —
  //     that is a redaction BYPASS. Fail closed: report the decode failure so
  //     the caller drops the body (stores empty + marks dropped). This is the
  //     genuine-gzip-failure scrub-bypass guard and must NOT regress.
  if (/\bgzip\b/i.test(contentEncoding) && hasGzipMagic(buf)) {
    try {
      buf = gunzipSync(buf);
      applied = true;
    } catch {
      return { decoded: Buffer.alloc(0), applied: true, decodeFailed: true };
    }
  }

  return { decoded: buf, applied, decodeFailed: false };
}

/**
 * True iff `buf` contains the gzip magic bytes (`0x1f 0x8b`, RFC 1952 §2.3.1
 * ID1/ID2) ANYWHERE — at offset 0 for a bare gzip stream, or embedded after a
 * chunk-framing prefix when a malformed `Transfer-Encoding: chunked` body falls
 * back to its raw bytes. Used to distinguish a GENUINE (possibly framed) gzip
 * stream from a body that merely carries a (mislabeled) `Content-Encoding: gzip`
 * header over PLAINTEXT — the common Cloudflare-challenge case. A buffer with
 * the magic present is treated as a genuine gzip stream (decompressed, or — if
 * the stream is framed/corrupt and `gunzipSync` throws — DROPPED to avoid
 * persisting unscrubbable compressed bytes, a redaction bypass); a buffer with
 * NO magic anywhere is kept as plaintext so the diagnostic payload survives.
 */
function hasGzipMagic(buf: Buffer): boolean {
  return buf.indexOf(GZIP_MAGIC) !== -1;
}

/** RFC 1952 gzip stream identifier (ID1 = 0x1f, ID2 = 0x8b). */
const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);

/**
 * Decode an HTTP `Transfer-Encoding: chunked` body to its payload bytes.
 * Returns null when the framing is malformed so the caller can fall back to
 * the raw bytes rather than corrupting the sample.
 */
function dechunk(body: Buffer): Buffer | null {
  const out: Buffer[] = [];
  let offset = 0;
  while (offset < body.length) {
    const crlf = body.indexOf("\r\n", offset, "latin1");
    if (crlf < 0) return null;
    const sizeLine = body
      .toString("latin1", offset, crlf)
      .split(";", 1)[0]!
      .trim();
    // The chunk size MUST be one or more hex digits (RFC 7230 §4.1). Reject any
    // non-hex / empty / signed (`-`/`+`) / `0x`-prefixed token: `parseInt`
    // would otherwise coerce a leading-hex-prefix garbage line to a plausible
    // number and silently corrupt the dechunked output. Fail closed (return
    // null) on malformed framing so the caller falls back to raw bytes.
    if (!/^[0-9a-fA-F]+$/.test(sizeLine)) return null;
    const size = Number.parseInt(sizeLine, 16);
    // Defense in depth: NaN is already excluded by the regex; this also rejects
    // a size large enough to overflow a safe integer.
    if (!Number.isSafeInteger(size) || size < 0) return null;
    offset = crlf + 2;
    if (size === 0) {
      // Terminal chunk: its CRLF was already consumed above. Anything that
      // follows is the (optional) trailer + final CRLF, which carries no body
      // payload, so we stop here.
      break;
    }
    if (offset + size > body.length) return null;
    out.push(body.subarray(offset, offset + size));
    offset += size;
    // A non-terminal chunk's data MUST be followed by a literal CRLF. Verify it
    // rather than blindly advancing past two bytes — a missing/garbled CRLF is
    // malformed framing, so fail closed.
    if (
      offset + 2 > body.length ||
      body[offset] !== 0x0d ||
      body[offset + 1] !== 0x0a
    ) {
      return null;
    }
    offset += 2;
  }
  return Buffer.concat(out);
}

/** True iff the body should be treated as an HTML page for html-strip. */
function isHtmlBody(contentType: string | undefined, text: string): boolean {
  if (contentType !== undefined && /text\/html/i.test(contentType)) return true;
  // Defensive: a WAF can serve a challenge page with a non-html content-type.
  return /<\s*(?:!doctype html|html|head|body)\b/i.test(text);
}

/**
 * Strip `<script>` / `<style>` / fingerprint-payload blocks from an HTML
 * challenge page, retaining only the visible text (step 3). Removes the tag
 * bodies entirely (not just the tags) so a Cloudflare fingerprint payload
 * inside `<script>window.__cf$=…</script>` never survives into the sample.
 */
function stripHtml(text: string): { stripped: string; dropped: boolean } {
  const stripped = text
    // Drop <script>…</script> and <style>…</style> bodies whole.
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
    // Drop <noscript> blocks (often carry the challenge fallback markup).
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript\s*>/gi, " ")
    // Drop any remaining tags, keeping the visible text between them.
    .replace(/<[^>]+>/g, " ")
    // Collapse the whitespace left behind by tag removal.
    .replace(/\s+/g, " ")
    .trim();
  // `dropped`/`metadata_dropped` flags that ACTUAL (sensitive) content was
  // removed — `<script>`/`<style>` bodies, tag attributes, etc. Compare on the
  // NON-WHITESPACE content of both sides: a mere whitespace collapse (e.g. a
  // body that already had no tags, just trailing newlines) must NOT raise the
  // flag, or it over-reports that content was removed when only whitespace was
  // normalized. A raw `length` comparison wrongly trips on whitespace collapse.
  const nonWsBefore = text.replace(/\s+/g, "").length;
  const nonWsAfter = stripped.replace(/\s+/g, "").length;
  return { stripped, dropped: nonWsAfter < nonWsBefore };
}

/**
 * Take the longest UTF-8 prefix of `buf` that is ≤ `maxBytes` AND does not
 * split a multibyte code point. Decoding the raw byte slice would emit a
 * U+FFFD replacement char wherever a multibyte sequence straddles the cap
 * boundary; instead we back the cap off to the last whole code-point start so
 * the retained text is byte-exact for every char it keeps.
 */
function utf8PrefixWithinBytes(buf: Buffer, maxBytes: number): Buffer {
  if (buf.length <= maxBytes) return buf;
  let end = maxBytes;
  // UTF-8 continuation bytes are 0b10xxxxxx (0x80–0xBF). If the byte at the cap
  // boundary is a continuation byte, we are mid-sequence — walk back to the
  // lead byte (the first non-continuation byte) and cut there.
  while (end > 0 && (buf[end]! & 0xc0) === 0x80) end -= 1;
  return buf.subarray(0, end);
}

/**
 * Take the longest UTF-8 suffix of `buf` that is ≤ `maxBytes` AND does not
 * split a multibyte code point. Symmetric to `utf8PrefixWithinBytes`: walk the
 * start boundary forward off any continuation byte to the next lead byte.
 */
function utf8SuffixWithinBytes(buf: Buffer, maxBytes: number): Buffer {
  if (buf.length <= maxBytes) return buf;
  let start = buf.length - maxBytes;
  // If the byte at the suffix start is a continuation byte, we are mid-sequence
  // — walk forward to the next lead byte so we never begin on a partial char.
  while (start < buf.length && (buf[start]! & 0xc0) === 0x80) start += 1;
  return buf.subarray(start);
}

/**
 * Head + tail cap (step 4). Keeps a ≤16KB head + ≤16KB tail of the UTF-8 text
 * (spec §11.4 / cvdiag_raw_byte_samples: head_bytes ≤16KB, tail_bytes ≤16KB);
 * the elided middle is counted in `elided_count` (bytes dropped). Boundaries
 * are taken on whole-code-point edges so no multibyte char is split into a
 * U+FFFD replacement char at the cap, and the head is ALWAYS ≤16KB (never the
 * up-to-32KB whole body the earlier cap returned, which risked PB column
 * truncation/reject). Windows:
 *   - body ≤ HEAD_CAP        → whole body is head, tail empty, elided 0.
 *   - HEAD_CAP < body ≤ 32KB → head = first ≤16KB, tail = remainder ≤16KB,
 *                              elided 0 (head+tail still cover the whole body).
 *   - body > 32KB            → head = first ≤16KB, tail = last ≤16KB, middle
 *                              elided.
 */
function headTailCap(text: string): {
  head: string;
  tail: string;
  elided: number;
} {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= RAW_BYTE_HEAD_CAP) {
    return { head: text, tail: "", elided: 0 };
  }
  const headBuf = utf8PrefixWithinBytes(buf, RAW_BYTE_HEAD_CAP);
  const tailBuf = utf8SuffixWithinBytes(
    buf.subarray(headBuf.length),
    RAW_BYTE_TAIL_CAP,
  );
  // `elided` is the real bytes dropped from the middle: the full body minus the
  // two retained (code-point-aligned, each ≤cap) segments. Backing the cap off
  // a partial char shrinks a segment by ≤3 bytes, which correctly accrues to
  // the elided count.
  const elided = buf.length - headBuf.length - tailBuf.length;
  return {
    head: headBuf.toString("utf8"),
    tail: tailBuf.toString("utf8"),
    elided,
  };
}

/**
 * Capture one DEBUG-tier raw-byte sample of a 200-but-empty response,
 * applying the normative decode→scrub→html-strip→head+tail pipeline. Returns
 * `null` when not at DEBUG tier, when the per-slug / global ring-buffer is
 * exhausted, or on any internal fault (pure instrumentation never throws).
 */
export function captureRawBytes(
  opts: CaptureRawBytesOptions,
): RawByteSample | null {
  // Hard tier gate (R4-F12): DEBUG only. Return null IMMEDIATELY for any
  // non-debug tier or a disarmed DEBUG flag — no decode, no allocation.
  if (opts.tier !== "debug" || opts.debugEnabled !== true) {
    return null;
  }

  // Per-slug allow-list scope (spec §6 / §1.6): DEBUG arms raw-byte capture
  // (PII-sensitive) ONLY for slugs explicitly listed in `CVDIAG_DEBUG_ALLOW_LIST`.
  // The construction-time presence check only verifies the list is non-empty
  // (opt-IN to DEBUG); the per-slug SCOPE is enforced HERE — exact match, no
  // wildcard. A slug not in the set gets NO capture even with DEBUG armed.
  if (!opts.allowedSlugs.has(opts.slug)) {
    return null;
  }

  try {
    const nowMs = opts.nowMs ?? Date.now();
    if (!admitCapture(opts.slug, nowMs)) {
      return null;
    }

    const applied: RawBytePipelineStage[] = [];
    let metadataDropped = false;

    // 1. DECODE (transfer + content encoding) — BEFORE scrub.
    const {
      decoded,
      applied: decodeApplied,
      decodeFailed,
    } = decodeBody(
      opts.responseBody,
      opts.contentEncoding,
      opts.transferEncoding,
    );
    if (decodeApplied) applied.push("decode");

    // DECODE FAILED (e.g. gunzip threw on bytes that are not a valid gzip
    // stream): the body is still COMPRESSED, so `scrubSecrets` cannot see a
    // secret hidden inside it. Persisting the raw compressed bytes would be a
    // redaction BYPASS. Drop the body — store an empty sample marked dropped —
    // rather than persisting an unscrubbable compressed payload.
    if (decodeFailed) {
      return {
        test_id: opts.testId,
        slug: opts.slug,
        ts: new Date(nowMs).toISOString(),
        pipeline_applied: applied,
        head_bytes: "",
        tail_bytes: "",
        elided_count: 0,
        metadata_dropped: true,
      };
    }

    let text = decoded.toString("utf8");

    // 2. HTML-STRIP if this is an HTML (challenge) page. Done on the decoded
    //    text BEFORE the cap so a `<script>` fingerprint payload is removed from
    //    the full body rather than slipping past a mid-body cap boundary.
    if (isHtmlBody(opts.contentType, text)) {
      const { stripped, dropped } = stripHtml(text);
      text = stripped;
      applied.push("html_strip");
      if (dropped) metadataDropped = true;
    }

    // 3. HEAD + TAIL CAP on the FULL decoded+stripped body, so the captured
    //    head/tail are the REAL ends of the body and `elided_count` reflects the
    //    real bytes dropped from the middle.
    const { head: rawHead, tail: rawTail, elided } = headTailCap(text);
    applied.push("headtail");
    if (elided > 0) metadataDropped = true;

    // 4. SCRUB the retained bytes. Each retained segment is bounded by
    //    `headTailCap` (head ≤ HEAD_CAP 16KB, tail ≤ TAIL_CAP 16KB) and the
    //    scan budget is sized to the content's own length, so the WHOLE
    //    retained content is always scanned (no `…[unscanned:N]` truncation) for
    //    ANY body size. Bounded (≤32KB total) × linear regex = O(constant),
    //    ReDoS-impossible.
    //
    //    SEAM REDACTION (the head/tail split is a PII pitfall): when `elided ===
    //    0` the head ([0,16K]) and tail ([16K,end]) are ADJACENT and together
    //    reconstruct the WHOLE retained body, so a Bearer/sk-/URL-userinfo
    //    secret STRADDLING byte 16384 would match neither regex if each segment
    //    were scrubbed in isolation — and be recoverable by concatenating
    //    head_bytes + tail_bytes (PII bypass). So for the adjacent case we scrub
    //    the FULL retained content as ONE pass FIRST, then re-split at the
    //    original head byte-boundary. When `elided > 0` (>32KB body) the head and
    //    tail are NON-adjacent — an elided middle separates them, they cannot be
    //    reconstructed into a contiguous body, so a per-segment scrub is correct
    //    (and there is no contiguous seam to straddle).
    //
    //    RE-CAP AFTER SCRUB (M3 CR R5): `scrubSecrets` GROWS the byte count —
    //    `[REDACTED]` (10 bytes) is longer than many matched tokens (`Bearer x`
    //    = 8 bytes, short `sk-…` keys), so a secret-dense segment can exceed its
    //    16KB cap AFTER scrub even though it was ≤16KB before. Storing an
    //    uncapped post-scrub segment violates the head_bytes/tail_bytes ≤16KB
    //    schema/PB-column bound (PB truncation/reject). So after the full-body
    //    (adjacent) or per-segment (non-adjacent) scrub, RE-CLAMP both ends to
    //    their byte caps on whole-code-point edges. This is terminal/safe: the
    //    content is FULLY scrubbed before the re-cap, so re-clamping cannot
    //    expose a new unredacted seam-straddling secret. The accounting
    //    (`elided_count` / `metadata_dropped`) is then RECOMPUTED from the
    //    FINAL post-scrub/post-recap segments so it never goes stale (the
    //    pre-scrub `elided` could claim 0 while scrub-growth + re-cap actually
    //    dropped bytes from the retained ends).
    let head: string;
    let tail: string;
    // `scrubbedBodyBytes` is the total byte length of the SCRUBBED retained
    // content (head + any elided middle + tail) — used below to RECOMPUTE
    // `elided_count` from the FINAL segments so the accounting never goes stale
    // when scrub-growth + the re-cap drop bytes from a retained end.
    let scrubbedBodyBytes: number;
    if (rawTail === "") {
      // Single retained segment (body ≤ HEAD_CAP): scrub then re-cap to ≤16KB.
      const scrubbedBuf = Buffer.from(
        scrubSecrets(rawHead, rawHead.length),
        "utf8",
      );
      head = utf8PrefixWithinBytes(scrubbedBuf, RAW_BYTE_HEAD_CAP).toString(
        "utf8",
      );
      tail = "";
      scrubbedBodyBytes = scrubbedBuf.length;
    } else if (elided === 0) {
      // Adjacent head+tail (HEAD_CAP < body ≤ 32KB): scrub the contiguous
      // retained body as one pass so a seam-straddling secret is redacted, then
      // re-split. The scrub GROWS bytes (`[REDACTED]` is longer than many
      // tokens), so take the head as the first ≤HEAD_CAP prefix AND re-clamp the
      // remainder to ≤TAIL_CAP — the post-head bytes can otherwise exceed
      // TAIL_CAP. Both ends are code-point-aligned by the utf8*WithinBytes
      // helpers, so no multibyte char is split.
      const scrubbedBuf = Buffer.from(
        scrubSecrets(rawHead + rawTail, rawHead.length + rawTail.length),
        "utf8",
      );
      const headBuf = utf8PrefixWithinBytes(scrubbedBuf, RAW_BYTE_HEAD_CAP);
      const tailBuf = utf8SuffixWithinBytes(
        scrubbedBuf.subarray(headBuf.length),
        RAW_BYTE_TAIL_CAP,
      );
      head = headBuf.toString("utf8");
      tail = tailBuf.toString("utf8");
      scrubbedBodyBytes = scrubbedBuf.length;
    } else {
      // Non-adjacent head+tail (>32KB, elided middle): per-segment scrub, then
      // re-cap each segment to its byte cap (scrub-growth can push a dense
      // segment past 16KB).
      const scrubbedHeadBuf = Buffer.from(
        scrubSecrets(rawHead, rawHead.length),
        "utf8",
      );
      const scrubbedTailBuf = Buffer.from(
        scrubSecrets(rawTail, rawTail.length),
        "utf8",
      );
      head = utf8PrefixWithinBytes(scrubbedHeadBuf, RAW_BYTE_HEAD_CAP).toString(
        "utf8",
      );
      tail = utf8SuffixWithinBytes(scrubbedTailBuf, RAW_BYTE_TAIL_CAP).toString(
        "utf8",
      );
      // The scrubbed retained content is the two scrubbed segments PLUS the
      // pre-scrub `elided` middle (which is never retained and never scrubbed,
      // so its raw byte count is the truthful contribution to the dropped span).
      scrubbedBodyBytes =
        scrubbedHeadBuf.length + elided + scrubbedTailBuf.length;
    }
    applied.push("scrub");

    // RECOMPUTE accounting from the FINAL post-scrub/post-recap segments. The
    // pre-scrub `elided` was computed against the raw (un-grown) body; scrub
    // growth + the re-cap above can drop ADDITIONAL bytes from the retained
    // ends, so the truthful elided count is the scrubbed-body byte length minus
    // the two FINAL retained segments. `metadata_dropped` stays true if a
    // decode/strip step set it earlier, OR is raised here when bytes were
    // elided from the (post-scrub) middle.
    const finalElided = Math.max(
      0,
      scrubbedBodyBytes -
        Buffer.byteLength(head, "utf8") -
        Buffer.byteLength(tail, "utf8"),
    );
    if (finalElided > 0) metadataDropped = true;

    return {
      test_id: opts.testId,
      slug: opts.slug,
      ts: new Date(nowMs).toISOString(),
      pipeline_applied: applied,
      head_bytes: head,
      tail_bytes: tail,
      elided_count: finalElided,
      metadata_dropped: metadataDropped,
    };
  } catch {
    // Pure instrumentation: never throw into the probe boundary we observe.
    return null;
  }
}
