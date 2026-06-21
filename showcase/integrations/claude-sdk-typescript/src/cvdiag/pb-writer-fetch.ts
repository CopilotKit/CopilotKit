/**
 * pb-writer-fetch.ts — the CONCRETE `CvdiagPbWriter` for the TS INTEGRATION
 * backends (plan unit L1-E wiring). This is the writer that actually persists
 * `CvdiagEmitter.flush()` batches into the `cvdiag_events` PocketBase
 * collection from inside a deployed Next.js route handler.
 *
 * WHY a second writer (and not harness/src/cvdiag/pb-writer.ts): that writer is
 * HARNESS/probe-side — it wraps the harness `PbClient` and authenticates as a
 * SUPERUSER (storage/pb-client.ts `/api/collections/_superusers/auth-with-
 * password`). Superuser auth is BOTH wrong for an integration (an integration
 * must never hold superuser credentials) AND unbundlable: `PbClient` drags the
 * harness storage/logging tree, which has no resolution inside a standalone
 * integration's Next.js build context (the `bin/showcase cvdiag-stage-ts` COPY
 * staging only ships the leaf cvdiag sources). The result of that mismatch was
 * the production defect this module fixes: `withCvdiagBackend` constructed a
 * `CvdiagEmitter` with NO `pbWriter`, so `flush()` was a permanent no-op and
 * ZERO backend telemetry ever persisted.
 *
 * CONTRACT (flap-observability spec §4 three-key ACL): authenticate as the
 * `cvdiag_api_keys` record with role `writer` (NOT superuser). The
 * `cvdiag_events` createRule requires exactly that
 * (`@request.auth.collectionName = "cvdiag_api_keys" && @request.auth.role =
 * "writer"`). This writer:
 *   1. POSTs `/api/collections/cvdiag_api_keys/auth-with-password` with
 *      `{ identity: CVDIAG_WRITER_IDENTITY, password: CVDIAG_WRITER_KEY }` →
 *      a Bearer token.
 *   2. POSTs each event to `/api/collections/cvdiag_events/records` with
 *      `Authorization: Bearer <token>`.
 *   3. Caches the token and RE-AUTHs once on a 401 (token expiry / rotation).
 *
 * Implemented with plain `fetch` ONLY — the pocketbase SDK is deliberately NOT
 * pulled in, because it does not bundle cleanly into the integrations'
 * standalone `next build` (this is the exact build surface that bit the seam
 * before). `fetch` is global in Node 18+ and in the Next.js runtime.
 *
 * BEST-EFFORT / NEVER-THROW: this mirrors the emitter's pure-instrumentation
 * contract (emit.ts §7 R5-F8) and `pb-writer.ts`. Every failure — an auth
 * rejection, a wrong key, a PB hiccup, an ACL 403, a network error — is
 * SWALLOWED and surfaced as a single `CVDIAG`-tagged `console.warn`. The
 * `writeBatch` promise RESOLVES whether every, some, or no rows persisted; it
 * NEVER rejects into `CvdiagEmitter.flush()` (which itself swallows). A CVDIAG
 * write failure must NEVER block, throw into, or false-red the boundary it
 * observes.
 */

import type { CvdiagEnvelope } from "./schema.js";

/** The `cvdiag_events` collection name (mirrors migration 1779990200). */
const CVDIAG_EVENTS_COLLECTION = "cvdiag_events";
/** The auth collection holding the role-keyed identities (migration 1779990200). */
const CVDIAG_API_KEYS_COLLECTION = "cvdiag_api_keys";
/**
 * Default writer identity seeded by the migration. The PASSWORD is supplied via
 * `CVDIAG_WRITER_KEY` (never defaulted — a missing key means "no writer wired").
 * The identity rarely changes, so it defaults to the seeded value but can be
 * overridden via `CVDIAG_WRITER_IDENTITY` for a rotated/renamed record.
 */
const DEFAULT_WRITER_IDENTITY = "cvdiag-writer@keys.local";

/** Minimal `fetch` shape (injectable for tests; defaults to the global). */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export interface CvdiagFetchPbWriterOptions {
  /** PocketBase base URL, e.g. `https://pb.internal` (no trailing slash). */
  baseUrl: string;
  /** Writer-role password (`CVDIAG_WRITER_KEY`). Required. */
  writerKey: string;
  /** Writer-role identity; defaults to the migration-seeded value. */
  writerIdentity?: string;
  /** Injected fetch (tests); defaults to the global `fetch`. */
  fetchImpl?: FetchLike;
  /** Per-request timeout in ms (default 5000). 0/undefined disables it. */
  timeoutMs?: number;
}

/**
 * Build the canonical `cvdiag_events` row from a `CvdiagEnvelope`. The envelope
 * and the PB row share the same 15 persisted fields; the two optional
 * diagnostic flags (`_metadata_dropped`, `_truncated`) are NOT columns, so —
 * mirroring `pb-writer.ts` `toEventRecord` — they are folded into the
 * `metadata` JSON bag (when set) so they stay queryable. A fresh `metadata`
 * object is built so the caller's envelope is never mutated.
 */
function toEventRecord(envelope: CvdiagEnvelope): Record<string, unknown> {
  const metadata: Record<string, unknown> = { ...envelope.metadata };
  if (envelope._metadata_dropped) metadata._metadata_dropped = true;
  if (envelope._truncated) metadata._truncated = true;
  return {
    schema_version: envelope.schema_version,
    test_id: envelope.test_id,
    trace_id: envelope.trace_id,
    span_id: envelope.span_id,
    parent_span_id: envelope.parent_span_id,
    layer: envelope.layer,
    boundary: envelope.boundary,
    slug: envelope.slug,
    demo: envelope.demo,
    ts: envelope.ts,
    mono_ns: envelope.mono_ns,
    duration_ms: envelope.duration_ms,
    outcome: envelope.outcome,
    edge_headers: { ...envelope.edge_headers },
    metadata,
  };
}

/**
 * A concrete, plain-`fetch`, WRITER-ROLE PB writer satisfying the emitter's
 * `CvdiagPbWriter` seam (`writeBatch(events) => Promise<void>`, never rejects).
 */
export class CvdiagFetchPbWriter {
  private readonly baseUrl: string;
  private readonly writerKey: string;
  private readonly writerIdentity: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  /** Cached Bearer token; null until first auth (or after a 401 reset). */
  private token: string | null = null;

  constructor(opts: CvdiagFetchPbWriterOptions) {
    // Strip a trailing slash so URL joins are unambiguous.
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.writerKey = opts.writerKey;
    this.writerIdentity = opts.writerIdentity ?? DEFAULT_WRITER_IDENTITY;
    this.fetchImpl =
      opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    this.timeoutMs = opts.timeoutMs ?? 5000;
  }

  /**
   * Persist a batch of envelopes, CREATE-only, best-effort. Auths lazily on the
   * first event, re-auths once on a per-event 401, and NEVER rejects. A
   * per-event failure degrades to a `CVDIAG`-tagged warn; the batch is never
   * aborted on one bad row.
   */
  async writeBatch(events: CvdiagEnvelope[]): Promise<void> {
    if (events.length === 0) return;
    // Authenticate once up front. If auth fails, every event below would 401 —
    // so warn once and bail rather than spamming a warn per event.
    if (this.token === null) {
      const ok = await this.ensureAuth();
      if (!ok) return;
    }
    for (const envelope of events) {
      try {
        await this.createOne(toEventRecord(envelope), envelope);
      } catch (err) {
        // `createOne` is itself never-throw; this guard covers a mapping throw
        // on a malformed envelope so one bad row can't abort the rest.
        this.warn(envelope.boundary, String(err), envelope.test_id);
      }
    }
  }

  /**
   * CREATE one row. We always hold a cached token here (writeBatch auths up
   * front). On ANY non-ok status with a cached token we re-auth ONCE and retry
   * the same row, because an expired/rotated/invalid PB auth-record token does
   * NOT surface as a clean 401 on this CREATE path — PocketBase silently treats
   * an unverifiable token as ANONYMOUS, and the `cvdiag_events` createRule
   * (writer-role required) then rejects the anonymous request as 400 (verified
   * against PB 0.22.21). So keying the re-auth on 401 alone would never recover
   * a stale token. A genuine bad-row 400 simply retries once (harmless, fails
   * again, warns once). Never throws.
   */
  private async createOne(
    record: Record<string, unknown>,
    envelope: CvdiagEnvelope,
  ): Promise<void> {
    const url = `${this.baseUrl}/api/collections/${CVDIAG_EVENTS_COLLECTION}/records`;
    const body = JSON.stringify(record);

    const res = await this.post(url, body, this.token ?? undefined);
    if (res === null) {
      this.warn(envelope.boundary, "transport error", envelope.test_id);
      return;
    }
    if (res.ok) return;

    // Non-ok with a cached token → assume the token is stale/invalid (PB hides
    // auth expiry behind a createRule-anonymous 400). Re-auth ONCE and retry.
    this.token = null;
    const ok = await this.ensureAuth();
    if (!ok) {
      this.warn(
        envelope.boundary,
        `create failed status=${res.status} (re-auth failed)`,
        envelope.test_id,
      );
      return;
    }
    const retry = await this.post(url, body, this.token ?? undefined);
    if (retry !== null && retry.ok) return;
    if (retry === null) {
      this.warn(
        envelope.boundary,
        "create failed after re-auth: transport error",
        envelope.test_id,
      );
      return;
    }
    const retryBody = await safeText(retry);
    this.warn(
      envelope.boundary,
      `create failed after re-auth status=${retry.status} ${retryBody}`,
      envelope.test_id,
    );
  }

  /**
   * Auth-with-password as the WRITER ROLE against the `cvdiag_api_keys` auth
   * collection. Caches the Bearer token on success; returns false (warns) on
   * any failure. Never throws.
   */
  private async ensureAuth(): Promise<boolean> {
    if (this.token !== null) return true;
    const res = await this.post(
      `${this.baseUrl}/api/collections/${CVDIAG_API_KEYS_COLLECTION}/auth-with-password`,
      JSON.stringify({
        identity: this.writerIdentity,
        password: this.writerKey,
      }),
      undefined,
    );
    if (res === null) {
      this.warn("auth", "transport error", this.writerIdentity);
      return false;
    }
    if (!res.ok) {
      const body = await safeText(res);
      this.warn(
        "auth",
        `auth failed status=${res.status} ${body}`,
        this.writerIdentity,
      );
      return false;
    }
    // Read the FULL body — the auth token is ~600 chars, so the warn-path
    // `safeText` (which 256-char clamps) would corrupt valid JSON.
    let text: string;
    try {
      text = await res.text();
    } catch {
      this.warn("auth", "auth body read failed", this.writerIdentity);
      return false;
    }
    let token: unknown;
    try {
      token = (JSON.parse(text) as { token?: unknown }).token;
    } catch {
      this.warn("auth", "auth response was not JSON", this.writerIdentity);
      return false;
    }
    if (typeof token !== "string" || token.length === 0) {
      this.warn(
        "auth",
        "auth returned empty/non-string token",
        this.writerIdentity,
      );
      return false;
    }
    this.token = token;
    return true;
  }

  /**
   * POST helper. Returns the response, or null on a transport/abort error (so
   * callers branch on a single null sentinel + an HTTP status). Applies an
   * optional per-request timeout via AbortController. Never throws.
   */
  private async post(
    url: string,
    body: string,
    bearer: string | undefined,
  ): Promise<{ ok: boolean; status: number; text(): Promise<string> } | null> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (bearer !== undefined) headers["authorization"] = `Bearer ${bearer}`;
    const controller = this.timeoutMs > 0 ? new AbortController() : undefined;
    const timer =
      controller !== undefined
        ? setTimeout(() => controller.abort(), this.timeoutMs)
        : undefined;
    try {
      return await this.fetchImpl(url, {
        method: "POST",
        headers,
        body,
        signal: controller?.signal,
      });
    } catch {
      return null;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /** Single CVDIAG-tagged warn for any swallowed failure (greppable anchor). */
  private warn(boundary: string, error: string, testId: string): void {
    console.warn(
      `CVDIAG pb-writer-fetch write failed test_id=${testId} ` +
        `boundary=${boundary} error=${error}`,
    );
  }
}

/**
 * Construct a `CvdiagFetchPbWriter` from the environment, or return `undefined`
 * when CVDIAG PB persistence is NOT configured. The wiring contract for
 * `withCvdiagBackend`: build + inject the writer ONLY when `CVDIAG_PB_URL` is
 * set (and a `CVDIAG_WRITER_KEY` is present). When `CVDIAG_PB_URL` is absent the
 * emitter is left with NO `pbWriter` — exactly the current stdout-only behavior
 * — so a deployment without a PocketBase target is unchanged. Never throws.
 */
export function createCvdiagFetchPbWriterFromEnv(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): CvdiagFetchPbWriter | undefined {
  const baseUrl = env.CVDIAG_PB_URL?.trim();
  if (baseUrl === undefined || baseUrl === "") return undefined;
  const writerKey = env.CVDIAG_WRITER_KEY?.trim();
  if (writerKey === undefined || writerKey === "") {
    // PB URL set but no writer key → cannot authenticate. Warn once and leave
    // the emitter writer-less (stdout-only) rather than injecting a writer that
    // 401-drops every event.
    console.warn(
      "CVDIAG pb-writer-fetch: CVDIAG_PB_URL is set but CVDIAG_WRITER_KEY is " +
        "empty/unset — no PB writer wired (events stay stdout-only).",
    );
    return undefined;
  }
  const writerIdentity = env.CVDIAG_WRITER_IDENTITY?.trim();
  return new CvdiagFetchPbWriter({
    baseUrl,
    writerKey,
    writerIdentity:
      writerIdentity !== undefined && writerIdentity !== ""
        ? writerIdentity
        : undefined,
  });
}

/** Read a Response body without throwing (used in warn paths). */
async function safeText(res: { text(): Promise<string> }): Promise<string> {
  try {
    return (await res.text()).slice(0, 256);
  } catch {
    return "";
  }
}
