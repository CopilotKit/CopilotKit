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
 *   1. explicit `baseUrl` param
 *   2. `process.env.NEXT_PUBLIC_OPS_BASE_URL` (inlined at build)
 *   3. `/api/ops` — same-origin proxy fallback (Next.js route)
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
  | string;

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
  summary: ProbeRunSummary;
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
 */
function resolveBaseUrl(explicit?: string): string {
  const raw =
    explicit ??
    process.env.NEXT_PUBLIC_OPS_BASE_URL ??
    FALLBACK_BASE_URL;
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
    if (text && text.length <= 200) detail = ` — ${text}`;
  } catch {
    // ignore body-read failures; the status line is enough.
  }
  throw new Error(
    `ops-api request failed: ${response.status} ${response.statusText} at ${url}${detail}`,
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────

export async function fetchProbes(opts: {
  signal?: AbortSignal;
  baseUrl?: string;
} = {}): Promise<ProbesResponse> {
  const url = `${resolveBaseUrl(opts.baseUrl)}/probes`;
  const response = await fetch(url, {
    method: "GET",
    signal: opts.signal,
    headers: { accept: "application/json" },
  });
  await ensureOk(response, url);
  return (await response.json()) as ProbesResponse;
}

export async function fetchProbeDetail(
  id: string,
  opts: { signal?: AbortSignal; baseUrl?: string } = {},
): Promise<ProbeDetailResponse> {
  const url = `${resolveBaseUrl(opts.baseUrl)}/probes/${encodeURIComponent(id)}`;
  const response = await fetch(url, {
    method: "GET",
    signal: opts.signal,
    headers: { accept: "application/json" },
  });
  await ensureOk(response, url);
  return (await response.json()) as ProbeDetailResponse;
}

export async function triggerProbe(
  id: string,
  opts: { slugs?: string[]; token: string; baseUrl?: string },
): Promise<TriggerResponse> {
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
  });
  await ensureOk(response, url);
  return (await response.json()) as TriggerResponse;
}
