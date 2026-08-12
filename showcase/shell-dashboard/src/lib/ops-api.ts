/**
 * Fetch client for the showcase-harness HTTP API consumed by the dashboard
 * Status tab. Contract is shared with the showcase-harness service (parallel
 * track B3) via the design spec — see Notion 34d3aa38-1852-811a-8715-...
 *
 * Endpoints:
 *   - GET  <base>/probes                  → ProbesResponse
 *   - GET  <base>/probes/<id>             → { probe, runs }
 *   - POST <base>/probes/<id>/trigger     → TriggerResponse
 *
 * `baseUrl` resolution order (per call):
 *   1. explicit `baseUrl` param (overrides everything; used in tests + SSR)
 *   2. `runtimeConfig.opsBaseUrl` (read from `window.__SHOWCASE_CONFIG__`,
 *      populated at request time by the root layout's inline <script>) —
 *      opt-in escape hatch for direct cross-origin calls, sourced from the
 *      client-intended `NEXT_PUBLIC_OPS_DIRECT_BASE_URL` env var. This is
 *      DISTINCT from the server proxy target `OPS_BASE_URL` (read only by
 *      the Route Handler). It defaults to "" — including in production —
 *      so the client falls through to step 3; the harness URL is never
 *      injected into the client bundle (showcase-harness has no CORS
 *      allowlist, so a direct cross-origin call would be blocked).
 *   3. `/api/ops` — same-origin path served by the Route Handler in
 *      `src/app/api/ops/[...path]/route.ts`. This is the production
 *      contract, not a guess: the handler forwards `/api/ops/<path>` to
 *      `${OPS_BASE_URL}/api/<path>` on the server side (reading
 *      `OPS_BASE_URL` at request time), so the browser only ever sees
 *      same-origin calls and `OPS_BASE_URL` stays out of the client bundle.
 *
 * The trigger token is supplied by the caller (typically read from
 * `process.env.NEXT_PUBLIC_OPS_TRIGGER_TOKEN` at the React layer).
 */

// ─────────────────────────────────────────────────────────────────────────
// Types — shared on-the-wire contract with showcase-harness (B3).
// ─────────────────────────────────────────────────────────────────────────

export type ProbeKind =
  | "e2e_demos"
  | "e2e_smoke"
  | "smoke"
  | "health"
  | "image-drift"
  | "pin-drift"
  // CROSS-ENV pin-drift (U11 / spec §7.3). The harness `/probes` endpoint
  // emits `cfg.kind` raw, so this arrives over the wire as the underscore
  // form `pin_drift_cross_env`. The Ops surface routes PROD drift here and
  // STAGING to `image-drift` (the `:latest`-drift signal) — see the harness
  // `probes/ops-drift-routing.ts`. Listed so the kind is documented rather
  // than only matching the `(string & {})` forward-compat fallback.
  | "pin_drift_cross_env"
  | "aimock-wiring"
  | "qa"
  | "redirect-decommission"
  | "version-drift"
  | "deploy-result"
  // Allow forward-compat probes the dashboard hasn't been taught about yet.
  // The `(string & {})` form preserves autocomplete on the known literals
  // while still accepting any string at the type level.
  | (string & {});

export type ServiceState = "queued" | "running" | "completed" | "failed";
export type ProbeResult = "green" | "yellow" | "red";

export interface ProbeRunServiceResult {
  slug: string;
  state: "completed" | "failed";
  result?: "green" | "yellow" | "red";
  error?: string;
}

export interface ProbeRunSummary {
  total: number;
  passed: number;
  failed: number;
  services?: ProbeRunServiceResult[];
}

export interface ProbeLastRun {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  state: "completed" | "failed";
  // Nullable: a "completed" run produced by a failure path can land here
  // without a summary (see showcase-harness CR-A1.5). Consumers MUST null-guard
  // before reading summary.passed / summary.total / summary.failed.
  summary: ProbeRunSummary | null;
}

export interface ProbeServiceProgress {
  slug: string;
  state: ServiceState;
  startedAt?: string;
  finishedAt?: string;
  result?: ProbeResult;
  error?: string;
}

export interface ProbeInflight {
  startedAt: string;
  elapsedMs: number;
  services: ProbeServiceProgress[];
}

export interface ProbeScheduleEntry {
  id: string;
  kind: ProbeKind;
  schedule: string;
  nextRunAt: string | null;
  lastRun: ProbeLastRun | null;
  inflight: ProbeInflight | null;
  config: {
    timeout_ms: number;
    max_concurrency: number;
    discovery: unknown;
  };
}

export interface ProbesResponse {
  probes: ProbeScheduleEntry[];
}

export interface ProbeRun {
  id: string;
  probeId: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  triggered: boolean;
  summary: ProbeRunSummary | null;
}

export interface ProbeDetailResponse {
  probe: ProbeScheduleEntry;
  runs: ProbeRun[];
}

export interface TriggerResponse {
  runId: string;
  status: "queued" | "running";
  probe: string;
  scope: string[];
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

import { getRuntimeConfig } from "./runtime-config.client";

const FALLBACK_BASE_URL = "/api/ops";

/**
 * Resolve the API base URL with this precedence:
 *  1. explicit `baseUrl` param — used in tests + SSR.
 *  2. `runtimeConfig.opsBaseUrl` — the client DIRECT override, sourced
 *     from `NEXT_PUBLIC_OPS_DIRECT_BASE_URL`, for deploys that want
 *     direct cross-origin calls (e.g. local dev hitting a remote
 *     harness). Production leaves this empty (it is NOT the server proxy
 *     target `OPS_BASE_URL`) so the call stays same-origin via step 3.
 *  3. `/api/ops` — same-origin path served by the Route Handler, which
 *     forwards to `${OPS_BASE_URL}/api/<path>` server-side.
 *
 * Whitespace-only and empty values are treated as missing — the same
 * defensive trim as the prior `process.env.NEXT_PUBLIC_OPS_BASE_URL?.trim()`
 * pattern, preserving the "do not silently 404 against own origin" guard.
 */
function resolveBaseUrl(explicit?: string): string {
  // On the server (SSR) there is no window. `getRuntimeConfig` (client
  // variant) throws in that case — we MUST fall back to the same-origin
  // path or the explicit override. In a browser the root layout's
  // inline <script> populates `window.__SHOWCASE_CONFIG__` before any
  // client code runs; if it's missing (wiring bug, or a test that
  // forgot to set it) we treat that as "no override" rather than
  // throwing here, since the same-origin rewrite is the safe default.
  let envBase: string | undefined;
  if (typeof window !== "undefined") {
    try {
      const trimmed = getRuntimeConfig().opsBaseUrl?.trim();
      if (trimmed && trimmed.length > 0) envBase = trimmed;
    } catch {
      // window.__SHOWCASE_CONFIG__ missing — fall through to FALLBACK_BASE_URL.
    }
  }
  const raw = explicit ?? envBase ?? FALLBACK_BASE_URL;
  return raw.replace(/\/+$/, "");
}

/**
 * Typed HTTP-status error thrown by `ensureOk` for non-2xx responses.
 * Carries the numeric `status` so callers can classify without scraping
 * the message — the §6.1 poll hook distinguishes a 404 (misdeploy
 * incident class) from every other failure (unreachable) off this field.
 * The message format is unchanged from the prior plain-Error throw.
 */
export class OpsApiHttpError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly url: string;

  constructor(status: number, statusText: string, url: string, detail = "") {
    super(`ops-api request failed: ${status} ${statusText} at ${url}${detail}`);
    this.name = "OpsApiHttpError";
    this.status = status;
    this.statusText = statusText;
    this.url = url;
  }
}

/**
 * Thrown by the worker-runs history/detail fetchers when the §5.2 shared
 * rate limit keeps answering 429 past the retry cap. Per §6.1 this is
 * explicitly NON-incident — the CP is alive and deliberately throttling —
 * so consumers (the detail panel) render a retry affordance and MUST NOT
 * trip the `unavailable` state, the §6.3 error panel, or the §7.4 banner.
 */
export class ThrottledError extends Error {
  /** Server-advised (or fallback) wait before the next manual retry. */
  readonly retryAfterMs: number;
  readonly url: string;

  constructor(url: string, retryAfterMs: number) {
    super(
      `ops-api throttled: 429 at ${url} — retry attempts exhausted (retry after ${retryAfterMs}ms)`,
    );
    this.name = "ThrottledError";
    this.retryAfterMs = retryAfterMs;
    this.url = url;
  }
}

/**
 * Throw a uniform error for non-2xx responses. We intentionally keep the
 * message terse + machine-readable (`"<status> <statusText> at <url>"`)
 * so call sites and tests can assert against the status code without
 * scraping body text. Body is best-effort appended when short.
 */
async function ensureOk(response: Response, url: string): Promise<void> {
  if (response.ok) return;
  let detail = "";
  try {
    const text = await response.text();
    if (text) {
      if (text.length <= 500) {
        detail = ` — ${text}`;
      } else {
        // Bodies larger than 500B (often HTML 5xx pages or stack traces)
        // would balloon the error message and trash log readability;
        // truncate but keep the marker + total size so an operator can see
        // they're missing tail data and re-fetch from the source if needed.
        detail = ` — ${text.slice(0, 500)} [truncated, ${text.length} bytes total]`;
      }
    }
  } catch (bodyErr) {
    // Propagate AbortError as-is so hook-layer cancellation filters
    // (`err.name === "AbortError"`) keep working. Wrapping it in a generic
    // Error would surface "AbortError" as user-facing noise.
    if ((bodyErr as { name?: string })?.name === "AbortError") {
      throw bodyErr;
    }
    // Surface the body-read failure rather than swallowing it silently —
    // callers and tests need a marker to distinguish "server returned an
    // empty/unreachable body" from "we just chose not to include it".
    const msg = (bodyErr as Error)?.message ?? "unknown";
    detail = ` (body read failed: ${msg})`;
  }
  throw new OpsApiHttpError(response.status, response.statusText, url, detail);
}

/**
 * Parse a JSON response, wrapping any parse failure with the URL so the
 * caller can attribute the failure to a specific endpoint.
 */
async function parseJson<T>(response: Response, url: string): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch (parseErr) {
    // Propagate AbortError as-is — same rationale as ensureOk.
    if ((parseErr as { name?: string })?.name === "AbortError") {
      throw parseErr;
    }
    const msg = (parseErr as Error)?.message ?? "unknown";
    // Preserve the original error as `cause` so debuggers can walk back to
    // the SyntaxError name/stack without re-parsing the wrapped message.
    throw new Error(`ops-api JSON parse failed at ${url}: ${msg}`, {
      cause: parseErr,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────

export async function fetchProbes(
  opts: {
    signal?: AbortSignal;
    baseUrl?: string;
  } = {},
): Promise<ProbesResponse> {
  const url = `${resolveBaseUrl(opts.baseUrl)}/probes`;
  // Opt out of browser + Next.js fetch caching. Status data is polled
  // every ~10s and must reflect the current backend state, not a cached
  // response from a prior poll.
  const response = await fetch(url, {
    method: "GET",
    signal: opts.signal,
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  await ensureOk(response, url);
  return parseJson<ProbesResponse>(response, url);
}

export async function fetchProbeDetail(
  id: string,
  opts: { signal?: AbortSignal; baseUrl?: string } = {},
): Promise<ProbeDetailResponse> {
  if (!id) throw new Error("probe id is required");
  const url = `${resolveBaseUrl(opts.baseUrl)}/probes/${encodeURIComponent(id)}`;
  // See fetchProbes — same no-store rationale for live detail data.
  const response = await fetch(url, {
    method: "GET",
    signal: opts.signal,
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  await ensureOk(response, url);
  return parseJson<ProbeDetailResponse>(response, url);
}

export interface TriggerProbeOptions {
  slugs?: string[];
  token: string;
  baseUrl?: string;
  signal?: AbortSignal;
}

export async function triggerProbe(
  id: string,
  opts: TriggerProbeOptions,
): Promise<TriggerResponse> {
  if (!id) throw new Error("probe id is required");
  const url = `${resolveBaseUrl(opts.baseUrl)}/probes/${encodeURIComponent(
    id,
  )}/trigger`;
  // Always send a JSON object body, even when slugs is omitted — the API
  // expects content-type application/json and a parseable body. An empty
  // object is the canonical "trigger with default scope" payload.
  const body: Record<string, unknown> = {};
  if (opts.slugs && opts.slugs.length > 0) body.slugs = opts.slugs;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${opts.token}`,
    },
    body: JSON.stringify(body),
    // No-store for parity with the GET fetches — POST responses can be
    // cached by intermediaries when CDN-fronted; explicit no-store
    // guarantees the trigger response goes end-to-end live.
    cache: "no-store",
    signal: opts.signal,
  });
  await ensureOk(response, url);
  return parseJson<TriggerResponse>(response, url);
}

// ─────────────────────────────────────────────────────────────────────────
// Worker-routed run visibility — DTOs + fetchers (spec §5.2.1–§5.2.3, §6.1).
//
// On-the-wire contract with the harness CP `/api/runs*` routes
// (`showcase/harness/src/http/fleet-runs.ts`), reached through the same
// `/api/ops/[...path]` proxy as the probe endpoints. The JSON examples in
// spec §5.2.1/§5.2.3 are the contract; field nullability mirrors the
// server projections in `run-view.ts`.
// ─────────────────────────────────────────────────────────────────────────

/**
 * §5.2.1 precedence-derived batch outcome — exactly three values, derived
 * server-side (stalled > failed > completed). Consumers render this
 * verbatim and never re-classify client-side.
 */
export type WorkerRunOutcome = "completed" | "failed" | "stalled";

/**
 * §5.2.1 worker health, derived server-side by the shared `deriveHealth`
 * at 1x/2x the boot-resolved heartbeat window. Rendered verbatim — no
 * client-side re-derivation.
 */
export type WorkerHealthState = "online" | "stale" | "offline";

export interface WorkerRunJobCounts {
  total: number;
  done: number;
  failed: number;
  /** Jobs with hook-stamped `reclaim_count > 0`, counted once each (§4.2). */
  reclaimed: number;
}

export interface WorkerCellCounts {
  total: number;
  passed: number;
  failed: number;
}

/**
 * One run batch (jobs grouped by `run_id`) — the §5.2.1 `lastRun` shape,
 * also each item of the §5.2.2 history list.
 */
export interface WorkerRunBatch {
  runId: string;
  triggered: boolean;
  enqueuedAt: string;
  /** Null while any job is non-terminal (stalled batches never finish). */
  finishedAt: string | null;
  durationMs: number | null;
  outcome: WorkerRunOutcome;
  jobs: WorkerRunJobCounts;
  cells: WorkerCellCounts | null;
  /** Summed from probe_runs.summary; null when no row carries the fields (pre-P2 rows). */
  redsIntroduced: number | null;
  redsCleared: number | null;
  /** Closed-vocabulary only (§5.2.1 redaction) — never commError.message content. */
  errorSummary: string | null;
  /** Deduped, isPoolCommErrorKind-validated kinds; unknown values arrive as "unknown". */
  commErrorKinds: string[];
  /**
   * §5.2.2 degenerate-clamp marker: present+true when the batch was larger
   * than the capped fetch window, so every count may undercount.
   */
  truncated?: boolean;
}

/** §5.2.1 `inflight` — the newest run_id group only, when non-terminal. */
export interface WorkerRunInflight {
  runId: string;
  triggered: boolean;
  enqueuedAt: string;
  elapsedMs: number;
  /** §5.2.1 rules (a)/(c): 2x-period no-progress or 4x-period absolute age. */
  stalled: boolean;
  jobs: {
    pending: number;
    claimed: number;
    running: number;
    done: number;
    failed: number;
  };
}

/**
 * One `/api/runs` family entry. When the §5.2.1 graceful-degradation rule
 * fires (PB failure while computing this family's projection), the entry
 * carries `error: "history_unavailable"` IN PLACE OF the computed fields —
 * hence everything past the registry echo is optional. §6.1 treats any
 * entry-level error as the same incident class as a failed poll.
 */
export interface WorkerFamilySummary {
  family: string;
  label: string;
  /** Echoed from FLEET_FAMILIES so cell keys map to families purely from the payload (§7.2). */
  probeKeyPrefix: string;
  error?: "history_unavailable";
  /** Display only (§6.2 humanizeCron) — NEVER threshold math; use periodMs. */
  schedule?: string;
  /**
   * Server-computed from the resolved cron (§5.2.1): shortest gap between
   * consecutive fires. All period-derived dashboard windows (§7.3 glyph,
   * §7.4 banner) consume this verbatim — no client-side cron parsing.
   */
  periodMs?: number;
  nextRunAt?: string | null;
  lastRun?: WorkerRunBatch | null;
  inflight?: WorkerRunInflight | null;
  /**
   * Finish of the newest completed batch within the capped walk-back, or
   * null (no completed batch in window / never succeeded). Null consumers
   * fall back to the oldest known batch's enqueuedAt (§5.2.1 null rule).
   */
  lastSuccessAt?: string | null;
}

/** §5.2.1 workers strip entry. The `endpoint` column is never serialized. */
export interface WorkerView {
  workerId: string;
  health: WorkerHealthState;
  lastHeartbeatAt: string;
  /**
   * ISO instant the worker last (re)registered, or "" when absent. The
   * freshest non-empty value across the strip is the fleet's most-recent
   * bounce instant; the §7.3 glyph / §7.4 banner grace a post-deploy drain
   * off it (PR #5715), consistent with the §9 Slack monitor.
   */
  registeredAt: string;
  currentJobId: string | null;
  capacity: { inUse: number; available: number; max: number };
}

/** GET /api/runs (§5.2.1). */
export interface WorkerRunsResponse {
  families: WorkerFamilySummary[];
  workers: WorkerView[];
}

/** GET /api/runs/:family (§5.2.2). */
export interface WorkerRunHistoryResponse {
  family: string;
  runs: WorkerRunBatch[];
  perPage: number;
  /** Composite cursor; both null ONLY when history exhausted (§5.2.2). */
  nextBefore: string | null;
  nextBeforeId: string | null;
  /** §5.2.1-anchored degradation marker (PB outage → 200 + error, never 500). */
  error?: "history_unavailable";
}

/** One per-service job row of the §5.2.3 drill-down. */
export interface WorkerRunJob {
  jobId: string;
  probeKey: string;
  serviceSlug: string;
  status: "pending" | "claimed" | "running" | "done" | "failed";
  claimedBy: string | null;
  enqueuedAt: string;
  claimedAt: string | null;
  finishedAt: string | null;
  /** claimed_at − created; for reclaimCount > 0 this measures the LAST claim (§5.2.1 corollary). */
  queueLatencyMs: number | null;
  durationMs: number | null;
  /** §4.2 hook counter, surfaced directly. */
  reclaimCount: number;
  cells: WorkerCellCounts | null;
  /** Same §5.2.1 redaction rule as the batch-level summary. */
  errorSummary: string | null;
  /** kind is enum-validated server-side; message is never serialized. */
  commError: { kind: string; observedAt: string } | null;
}

/** GET /api/runs/:family/:runId (§5.2.3). */
export interface WorkerRunDetailResponse {
  family: string;
  runId: string;
  jobs: WorkerRunJob[];
  error?: "history_unavailable";
}

/** §5.2.2 composite (created, id) cursor — echo nextBefore/nextBeforeId verbatim. */
export interface WorkerRunsCursor {
  before: string;
  beforeId: string;
}

// The §5.2 fixed-window rate limit is 30 req / 10 s; when a 429 arrives
// without a Retry-After header we wait the full window length (§6.1).
export const THROTTLE_RETRY_FALLBACK_MS = 10_000;
// §6.1: retry capped at 3 attempts total, then surface a panel-local
// retry affordance (ThrottledError) rather than escalating.
export const THROTTLE_MAX_ATTEMPTS = 3;

/**
 * Parse a Retry-After header value (delta-seconds or HTTP-date) into
 * milliseconds. Returns null for absent/unparseable values so the caller
 * applies the §6.1 fallback (the 10 s window length).
 */
function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }
  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

/**
 * Abort-aware sleep. Rejects with a genuine AbortError (DOMException) so
 * the hook-layer cancellation filters (`err.name === "AbortError"`) treat
 * a mid-wait teardown exactly like a mid-fetch one.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const abortError = () => new DOMException("aborted", "AbortError");
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * GET-and-parse with the §6.1 429 path: honor Retry-After (fallback: the
 * 10 s window length), retry capped at THROTTLE_MAX_ATTEMPTS total
 * attempts, then throw a typed ThrottledError. Every other status flows
 * through the standard ensureOk/parseJson plumbing.
 */
async function fetchJsonWithThrottleRetry<T>(
  url: string,
  signal?: AbortSignal,
): Promise<T> {
  let lastRetryAfterMs = THROTTLE_RETRY_FALLBACK_MS;
  for (let attempt = 1; attempt <= THROTTLE_MAX_ATTEMPTS; attempt++) {
    const response = await fetch(url, {
      method: "GET",
      signal,
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (response.status === 429) {
      lastRetryAfterMs =
        parseRetryAfterMs(response.headers.get("retry-after")) ??
        THROTTLE_RETRY_FALLBACK_MS;
      if (attempt === THROTTLE_MAX_ATTEMPTS) break;
      await sleep(lastRetryAfterMs, signal);
      continue;
    }
    await ensureOk(response, url);
    return parseJson<T>(response, url);
  }
  throw new ThrottledError(url, lastRetryAfterMs);
}

/**
 * GET /api/runs — the §5.2.1 family summary. No 429 path: the route is
 * memoized server-side, not rate-limited (§5.2), so the §6.1 incident
 * classification never has to disambiguate this fetcher.
 */
export async function fetchWorkerRuns(
  opts: { signal?: AbortSignal; baseUrl?: string } = {},
): Promise<WorkerRunsResponse> {
  const url = `${resolveBaseUrl(opts.baseUrl)}/runs`;
  // Same no-store rationale as fetchProbes — polled live data.
  const response = await fetch(url, {
    method: "GET",
    signal: opts.signal,
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  await ensureOk(response, url);
  return parseJson<WorkerRunsResponse>(response, url);
}

/**
 * GET /api/runs/:family — §5.2.2 run history. The cursor pair is echoed
 * verbatim from the previous page's nextBefore/nextBeforeId (composite
 * (created, id) — never send `before` alone). Shares the §5.2 rate-limit
 * window with the detail route, hence the 429 retry path.
 */
export async function fetchWorkerRunHistory(
  family: string,
  cursor?: WorkerRunsCursor,
  opts: { signal?: AbortSignal; baseUrl?: string; perPage?: number } = {},
): Promise<WorkerRunHistoryResponse> {
  if (!family) throw new Error("family is required");
  const params = new URLSearchParams();
  if (opts.perPage !== undefined) params.set("perPage", String(opts.perPage));
  if (cursor) {
    params.set("before", cursor.before);
    params.set("beforeId", cursor.beforeId);
  }
  const query = params.toString();
  const url = `${resolveBaseUrl(opts.baseUrl)}/runs/${encodeURIComponent(
    family,
  )}${query ? `?${query}` : ""}`;
  return fetchJsonWithThrottleRetry<WorkerRunHistoryResponse>(url, opts.signal);
}

/**
 * GET /api/runs/:family/:runId — §5.2.3 per-service drill-down. Shares
 * the rate-limit window (and therefore the 429/ThrottledError path) with
 * the history route.
 */
export async function fetchWorkerRunDetail(
  family: string,
  runId: string,
  opts: { signal?: AbortSignal; baseUrl?: string } = {},
): Promise<WorkerRunDetailResponse> {
  if (!family) throw new Error("family is required");
  if (!runId) throw new Error("runId is required");
  const url = `${resolveBaseUrl(opts.baseUrl)}/runs/${encodeURIComponent(
    family,
  )}/${encodeURIComponent(runId)}`;
  return fetchJsonWithThrottleRetry<WorkerRunDetailResponse>(url, opts.signal);
}
