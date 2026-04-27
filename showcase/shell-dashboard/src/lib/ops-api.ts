/**
 * Fetch client for the showcase-ops HTTP API consumed by the dashboard
 * Status tab. Contract is shared with the showcase-ops service (parallel
 * track B3) via the design spec — see Notion 34d3aa38-1852-811a-8715-...
 *
 * Endpoints:
 *   - GET  <base>/probes                  → ProbesResponse
 *   - GET  <base>/probes/<id>             → { probe, runs }
 *   - POST <base>/probes/<id>/trigger     → TriggerResponse
 *
 * `baseUrl` resolution order (per call):
 *   1. explicit `baseUrl` param (overrides everything; used in tests + SSR)
 *   2. `process.env.NEXT_PUBLIC_OPS_BASE_URL` — opt-in escape hatch for
 *      direct cross-origin calls; production does NOT use this because
 *      showcase-ops has no CORS allowlist. Note: Next inlines `NEXT_PUBLIC_*`
 *      into the client bundle at build time, but this module ALSO runs in
 *      SSR + tests where `process.env` is read live at call time — so
 *      `delete process.env.NEXT_PUBLIC_OPS_BASE_URL` in a test does take
 *      effect on subsequent `resolveBaseUrl()` calls.
 *   3. `/api/ops` — same-origin path served by the Next.js rewrite in
 *      `next.config.ts`. This is the production contract, not a guess: the
 *      rewrite forwards `/api/ops/:path*` to `${OPS_BASE_URL}/api/:path*`
 *      on the server side, so the browser only ever sees same-origin calls
 *      and `OPS_BASE_URL` stays out of the client bundle.
 *
 * The trigger token is supplied by the caller (typically read from
 * `process.env.NEXT_PUBLIC_OPS_TRIGGER_TOKEN` at the React layer).
 */

// ─────────────────────────────────────────────────────────────────────────
// Types — shared on-the-wire contract with showcase-ops (B3).
// ─────────────────────────────────────────────────────────────────────────

export type ProbeKind =
  | "e2e_demos"
  | "e2e_smoke"
  | "smoke"
  | "health"
  | "image-drift"
  | "pin-drift"
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

export interface ProbeRunSummary {
  total: number;
  passed: number;
  failed: number;
}

export interface ProbeLastRun {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  state: "completed" | "failed";
  // Nullable: a "completed" run produced by a failure path can land here
  // without a summary (see showcase-ops CR-A1.5). Consumers MUST null-guard
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

const FALLBACK_BASE_URL = "/api/ops";

/**
 * Resolve the API base URL with the precedence documented at the top of
 * this module. Trailing slashes are stripped so callers don't end up with
 * a double-slash like `http://host//probes` that some servers reject.
 *
 * `NEXT_PUBLIC_OPS_BASE_URL` is treated as missing when it is undefined,
 * empty, or whitespace-only. `??` only falls through on `null`/`undefined`,
 * so without this an env var set to `""` would silently produce
 * `baseUrl === ""` and URLs like `"/probes"` (no `/api/ops` prefix) — a
 * silent failure mode where the dashboard hits its own origin and 404s.
 */
function resolveBaseUrl(explicit?: string): string {
  const envBase = process.env.NEXT_PUBLIC_OPS_BASE_URL?.trim();
  const raw = explicit ?? (envBase || undefined) ?? FALLBACK_BASE_URL;
  return raw.replace(/\/+$/, "");
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
  throw new Error(
    `ops-api request failed: ${response.status} ${response.statusText} at ${url}${detail}`,
  );
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
