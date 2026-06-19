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
 * ≤16KB head and ≤16KB tail covers every byte that can possibly be stored. This
 * (a) keeps each scrub input bounded ≤16KB (linear regex × bounded length =
 * O(constant), ReDoS-impossible — no scan-budget truncation needed), and (b)
 * captures the REAL head and REAL tail of the body. The earlier scrub-before-cap
 * order forced `scrubSecrets` onto the FULL body: for a body >32KB it hit the
 * bounded-prefix path, truncating to a `…[unscanned:N]` prefix BEFORE the cap —
 * which lost the real tail, never scanned it for secrets, and zeroed out the
 * true `elided_count`. Scrubbing the two retained segments after the cap fixes
 * all three.
 *
 * GUARD (R4-F12): DEBUG tier ONLY. `captureRawBytes()` returns `null`
 * immediately when the resolved tier is not `debug`. Beyond the tier gate the
 * module enforces a per-slug 24h auto-disable and a global ≤500-captures/24h
 * ring-buffer (drop-oldest accounting), so a long-lived DEBUG session can
 * never accumulate unbounded body samples.
 *
 * Pure instrumentation: a capture fault must NEVER throw into the probe it
 * observes — every failure path returns `null` rather than raising.
 */

import { gunzipSync } from "node:zlib";

import { scrubSecrets } from "./edge-headers.js";

/** Per-side head/tail cap (spec §11.4: ≤16KB head + ≤16KB tail, 32KB max). */
export const RAW_BYTE_HEAD_CAP = 16 * 1024;
export const RAW_BYTE_TAIL_CAP = 16 * 1024;

/** Storage budget: ≤500 captures total per 24h, ring-buffer beyond (R2-NF3). */
export const RAW_BYTE_MAX_CAPTURES_PER_24H = 500;

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

/** Inputs to one raw-byte capture attempt. */
export interface CaptureRawBytesOptions {
  /** Service slug (per-slug 24h auto-disable + ring-buffer keying). */
  slug: string;
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
/** Global rolling count across all slugs (the ≤500/24h ring-buffer). */
let globalWindowStartMs = 0;
let globalCount = 0;

/**
 * Reset all in-memory capture bookkeeping. Test-only seam so the per-slug 24h
 * window and the global ring-buffer do not leak state across test cases.
 */
export function resetRawByteCaptureStateForTest(): void {
  slugStateByName.clear();
  globalWindowStartMs = 0;
  globalCount = 0;
}

/**
 * Roll the per-slug + global 24h windows forward to `nowMs`, then admit one
 * capture iff neither budget is exhausted. Returns true when the capture is
 * within budget (and accounts for it); false when the ring-buffer rejects it.
 */
function admitCapture(slug: string, nowMs: number): boolean {
  // Global ≤500/24h ring-buffer.
  if (
    globalWindowStartMs === 0 ||
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
  if (state.count >= RAW_BYTE_MAX_CAPTURES_PER_24H) {
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
): { decoded: Buffer; applied: boolean } {
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

  // Then gunzip if the content was gzip-compressed.
  if (/\bgzip\b/i.test(contentEncoding)) {
    try {
      buf = gunzipSync(buf);
      applied = true;
    } catch {
      // Not actually a valid gzip stream (or truncated mid-stream) — fall back
      // to the raw bytes; scrubbing them is better than dropping the sample.
    }
  }

  return { decoded: buf, applied };
}

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
    const size = Number.parseInt(sizeLine, 16);
    if (Number.isNaN(size)) return null;
    offset = crlf + 2;
    if (size === 0) break; // terminal chunk
    if (offset + size > body.length) return null;
    out.push(body.subarray(offset, offset + size));
    offset += size;
    // Skip the trailing CRLF after the chunk data.
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
  const before = text.length;
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
  return { stripped, dropped: stripped.length < before };
}

/**
 * Head + tail cap (step 4). Keeps ≤16KB head + ≤16KB tail of the UTF-8 text;
 * the elided middle is counted in `elided_count` (bytes dropped). When the
 * body fits within head+tail, the whole body is the head and the tail is
 * empty.
 */
function headTailCap(text: string): {
  head: string;
  tail: string;
  elided: number;
} {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= RAW_BYTE_HEAD_CAP + RAW_BYTE_TAIL_CAP) {
    return { head: text, tail: "", elided: 0 };
  }
  const head = buf.subarray(0, RAW_BYTE_HEAD_CAP).toString("utf8");
  const tail = buf.subarray(buf.length - RAW_BYTE_TAIL_CAP).toString("utf8");
  const elided = buf.length - RAW_BYTE_HEAD_CAP - RAW_BYTE_TAIL_CAP;
  return { head, tail, elided };
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

  try {
    const nowMs = opts.nowMs ?? Date.now();
    if (!admitCapture(opts.slug, nowMs)) {
      return null;
    }

    const applied: RawBytePipelineStage[] = [];
    let metadataDropped = false;

    // 1. DECODE (transfer + content encoding) — BEFORE scrub.
    const { decoded, applied: decodeApplied } = decodeBody(
      opts.responseBody,
      opts.contentEncoding,
      opts.transferEncoding,
    );
    if (decodeApplied) applied.push("decode");
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

    // 4. SCRUB the RETAINED head and tail SEPARATELY. Each segment is ≤16KB, so
    //    the per-segment scan budget is the segment cap — the WHOLE segment is
    //    scanned (no `…[unscanned]` truncation) while staying ReDoS-impossible
    //    (bounded length × linear regex = O(constant)). The elided middle is
    //    gone from the sample, so scrubbing the two kept segments covers every
    //    stored byte — and both the real head AND the real tail are scrubbed.
    const head = scrubSecrets(rawHead, RAW_BYTE_HEAD_CAP);
    const tail = rawTail === "" ? "" : scrubSecrets(rawTail, RAW_BYTE_TAIL_CAP);
    applied.push("scrub");

    return {
      test_id: opts.testId,
      slug: opts.slug,
      ts: new Date(nowMs).toISOString(),
      pipeline_applied: applied,
      head_bytes: head,
      tail_bytes: tail,
      elided_count: elided,
      metadata_dropped: metadataDropped,
    };
  } catch {
    // Pure instrumentation: never throw into the probe boundary we observe.
    return null;
  }
}
