import type { Probe, ProbeContext, ProbeResult } from "../types/index.js";

/**
 * Sentinel value passed by the Railway adapter's `getServiceEnv` when a Railway
 * variable is SEALED (masked server-side, appears as `*****`). A sealed value
 * means "configured but opaque" — NOT "missing". The probe cannot verify
 * whether the sealed value points at aimock, so the service is bucketed as
 * `sealed` (neither wired nor unwired) and excluded from drift counts. This
 * prevents correctly-configured services with sealed env from being falsely
 * flagged as drift on every tick.
 *
 * The orchestrator (Cluster 1) owns the adapter side: its `getServiceEnv`
 * implementation must substitute this sentinel for any variable Railway
 * returns masked. From the probe's perspective, any `OPENAI_BASE_URL`,
 * `ANTHROPIC_BASE_URL`, or `GOOGLE_GEMINI_BASE_URL` equal to this sentinel
 * is treated as unknown.
 */
export const SEALED_SENTINEL = "__SEALED__";

/**
 * Cross-cluster surface contract (for Cluster 1 + Cluster 6 F4.3 wiring):
 *
 * The probe exposes everything downstream needs to route a pure-errored state
 * (unwired=[], errored=[...]) into its own alert branch:
 *   - `signal.errored` — structured list of {name, errorDesc} per failing service.
 *   - `signal.erroredCount` — numeric count for templates / counting triggers.
 *   - `signal.hasErrored` — boolean flag for deriveSignalFlags to key off.
 *   - `signal.erroredPreview` — template-ready "name: errorDesc" strings,
 *     capped at 5 entries with "(+N more)" overflow.
 *
 * Cluster 1 is responsible for:
 *   1. Adding `set_errored` to StringTriggerEnum (src/rules/schema.ts).
 *   2. Deriving `set_errored = signal.hasErrored === true` in
 *      deriveSignalFlags (src/alerts/alert-engine.ts).
 *   3. Adding `set_errored: false` to emptyTriggerFlags().
 *
 * Cluster 6 is responsible for:
 *   4. Declaring `set_errored` in aimock-wiring-drift.yml triggers and
 *      rendering an errored branch from `signal.erroredPreview` /
 *      `signal.erroredCount`.
 *
 * No probe-side changes are needed for F4.3 — the surface is already complete.
 */

/**
 * Exact service names we do NOT check for aimock wiring. The aimock service
 * itself has no upstream to route through, and shell/pocketbase/ops are pure
 * infra with no LLM callers.
 *
 * Exact match (not prefix) is load-bearing: prefix-matching on "showcase-aimock"
 * would false-exclude a hypothetical "showcase-aimock-pinger-mock-for-test"
 * AND prevent it from showing up as unwired. Keep this list in sync with the
 * Railway service roster whenever new infra services are added.
 */
const EXCLUDE_SERVICES: ReadonlySet<string> = new Set([
  "showcase-aimock",
  "showcase-shell",
  "showcase-shell-dashboard",
  "showcase-shell-docs",
  "showcase-shell-dojo",
  "showcase-pocketbase",
  "showcase-ops",
]);

export interface AimockWiringInput {
  /** Base URL of the aimock service (must match per-service BASE_URL exactly). */
  aimockUrl: string;
  /** Callback returning the list of services in the Railway project. */
  listServices: () => Promise<{ name: string }[]>;
  /**
   * Callback returning env vars for a given service. Typically wraps a
   * Railway GraphQL query for `variables(projectId, environmentId, serviceId)`.
   */
  getServiceEnv: (name: string) => Promise<Record<string, string | undefined>>;
}

export interface AimockWiringSignal {
  /** Services missing an aimock BASE_URL override (sorted, deduped). */
  unwired: string[];
  /** Services correctly routing through aimock (sorted, deduped). */
  wired: string[];
  /**
   * Services whose env lookup threw (API error, auth failure, etc). Sorted.
   * Kept separate from `unwired` so operators can distinguish
   * "genuinely misconfigured" from "couldn't determine".
   */
  errored: { name: string; errorDesc: string }[];
  /**
   * Services whose relevant base-URL env var was SEALED (masked by Railway),
   * so the probe cannot decide wired vs unwired. Sorted, deduped. Excluded
   * from the red-state calculation — sealed values do NOT count as drift.
   * Operators get visibility via `sealedCount` / `sealedPreview` without
   * being paged on correctly-configured-but-opaque services.
   */
  sealed: string[];
  /**
   * Template-friendly preview: up to `ERRORED_PREVIEW_MAX` failing services
   * rendered as "name: errorDesc" lines. Saves operators a log-dive for the
   * common case where one Railway API hiccup trips a single service.
   * Truncated with "(+N more)" when erroredCount exceeds the preview cap.
   */
  erroredPreview: string[];
  /**
   * Template-friendly preview of sealed services, capped at
   * `ERRORED_PREVIEW_MAX` with "(+N more)" overflow. Useful for informational
   * messages that want to call out "we can't verify these" without failing
   * the probe.
   */
  sealedPreview: string[];
  unwiredCount: number;
  wiredCount: number;
  erroredCount: number;
  sealedCount: number;
  unwiredNoun: string;
  /**
   * Truthy when `errored` is non-empty — derived flag for templates that
   * need to render a distinct "lookup failed" branch without counting.
   */
  hasErrored: boolean;
  /**
   * Truthy when any service landed in the `sealed` bucket. Templates can
   * opt to render a "(N sealed — cannot verify)" aside without affecting
   * pass/fail logic.
   */
  hasSealed: boolean;
  /**
   * HF13-C1: truthy when the probe itself could not run — the canonical
   * example is a malformed `aimockUrl` that fails URL parsing. When true,
   * per-service iteration is skipped, the probe returns `state:"red"`, and
   * a single config-error sentinel populates `errored` / `erroredPreview`
   * so `deriveSignalFlags` emits `set_errored` and the aimock-wiring-drift
   * rule renders the errored branch (NOT the drift branch). Without this,
   * `normalizeUrl(aimockUrl)` returned null and every service tripped
   * `mismatch`, firing a spurious "all services drifted" page.
   */
  probeErrored: boolean;
  /** Human-readable reason for `probeErrored`, rendered by templates. */
  probeErrorDesc: string;
  /**
   * Distinct from `probeErrored` to let templates tell apart "probe itself
   * mis-configured at boot" (configError=true) from "probe ran but upstream
   * dependency errored" (probeErrored=true, configError=false). Today only
   * the config-error path flips this; left as a dedicated flag so future
   * non-config probe-level errors can reuse `probeErrored` without
   * polluting the config-error branch in Slack templates.
   */
  configError: boolean;
}

/** Maximum number of failing services rendered inline in alerts. */
const ERRORED_PREVIEW_MAX = 5;

function isExcluded(name: string): boolean {
  return EXCLUDE_SERVICES.has(name);
}

/**
 * Extract the lowercased hostname from a URL string. Returns null if the
 * URL is unparseable. Used by `pointsAtAimock` for hostname-based matching
 * so path differences (`/v1` suffix on `OPENAI_BASE_URL` vs bare origin on
 * `AIMOCK_URL`) don't cause false mismatches.
 */
function extractHostname(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Candidate env var names that may point a service at aimock. A service is
 * "wired" if ANY of these resolves to the aimock hostname.
 *
 *   - `OPENAI_BASE_URL`: used by the vast majority of services (OpenAI SDK
 *     convention, typically set to `<aimock>/v1`).
 *   - `ANTHROPIC_BASE_URL`: used by claude-sdk services (set to the bare
 *     aimock origin, no `/v1`).
 *   - `GOOGLE_GEMINI_BASE_URL`: used by google-adk services (bare origin).
 */
const CANDIDATE_ENV_VARS = [
  "OPENAI_BASE_URL",
  "ANTHROPIC_BASE_URL",
  "GOOGLE_GEMINI_BASE_URL",
] as const;

/**
 * Tri-state match against the aimock base URL.
 *   - `"match"`: env var definitely points at aimock.
 *   - `"mismatch"`: env var is set to something else, or is missing entirely.
 *   - `"sealed"`: at least one of the candidate env vars is the sealed
 *     sentinel and none of the others is a confirmed match — we can't decide,
 *     so the service goes to the `sealed` bucket rather than being flagged
 *     as drift.
 *
 * Matching is **hostname-based**: a candidate value matches aimock if its
 * parsed hostname equals the aimock URL's hostname (case-insensitive). This
 * tolerates the `/v1` path suffix that `OPENAI_BASE_URL` carries by
 * convention — the path is irrelevant for determining whether traffic routes
 * through the aimock proxy. Query strings, fragments, and default ports are
 * also ignored since hostname extraction discards them.
 *
 * Ordering rationale: a confirmed match on ANY candidate env var wins, even
 * if another candidate is sealed. This mirrors the original "OR" semantics —
 * a service that exposes `ANTHROPIC_BASE_URL=aimock` and has a sealed
 * `OPENAI_BASE_URL` is unambiguously wired.
 */
function pointsAtAimock(
  env: Record<string, string | undefined>,
  aimockUrl: string,
): "match" | "mismatch" | "sealed" {
  const targetHost = extractHostname(aimockUrl);
  // Defense-in-depth: the probe's `run` has already validated `aimockUrl`
  // with `new URL` and short-circuited on failure, so `targetHost` should
  // never be null here. If it somehow is (e.g. a future caller invokes
  // `pointsAtAimock` directly), return "mismatch" rather than silently
  // matching — but this path is unreachable via the probe pipeline today.
  if (targetHost === null) return "mismatch";
  let anySealed = false;
  for (const varName of CANDIDATE_ENV_VARS) {
    const raw = env[varName];
    if (raw === SEALED_SENTINEL) {
      anySealed = true;
      continue;
    }
    if (extractHostname(raw) === targetHost) return "match";
  }
  return anySealed ? "sealed" : "mismatch";
}

/**
 * Spec §6.4: every LLM-calling showcase service MUST have its traffic
 * routed through showcase-aimock via OPENAI_BASE_URL,
 * ANTHROPIC_BASE_URL, or GOOGLE_GEMINI_BASE_URL. Fires on drift.
 *
 * Signal contract (sorted output is part of the contract — templates rely
 * on stable ordering for diff comparisons):
 *   - `wired` / `unwired` / `sealed` / `errored`: lexically sorted by name.
 *   - A single service's env-fetch failure is isolated to the `errored`
 *     bucket and does NOT reject the whole probe.
 *   - Sealed env values (Railway-masked `*****`) land in `sealed` and do
 *     NOT trip red — only `unwired` or `errored` mean red.
 *
 * See the top-of-file "Cross-cluster surface contract" comment for the
 * `set_errored` trigger wiring owned by Cluster 1 (schema + flags) and
 * Cluster 6 (YAML). The probe side exposes every field they need.
 */
export const aimockWiringProbe: Probe<AimockWiringInput, AimockWiringSignal> = {
  dimension: "aimock_wiring",
  async run(
    input: AimockWiringInput,
    ctx: ProbeContext,
  ): Promise<ProbeResult<AimockWiringSignal>> {
    // HF13-C1: parse the config URL ONCE at probe start. If it fails,
    // `extractHostname` returns null → `pointsAtAimock` returns "mismatch"
    // → every service lands in `unwired` → probe goes red with "all
    // services drifted". That paged operators when the actual failure was
    // a config typo in AIMOCK_BASE_URL. Short-circuit here with a
    // dedicated probeErrored signal and skip per-service iteration so
    // Slack renders the errored branch, not the drift branch.
    //
    // We validate with `new URL` rather than relying on `extractHostname`
    // alone because a null return from hostname extraction is also a
    // legitimate value for per-service env vars (a service without the
    // var set). Parse+throw gives us a clean boot-time guard.
    let aimockUrlValid = true;
    try {
      // eslint-disable-next-line no-new
      new URL(input.aimockUrl);
    } catch {
      aimockUrlValid = false;
    }
    if (!aimockUrlValid) {
      const errorDesc = `aimockUrl parse failed: ${input.aimockUrl}`;
      const configEntry = { name: "<config>", errorDesc };
      const signal: AimockWiringSignal = {
        unwired: [],
        wired: [],
        sealed: [],
        errored: [configEntry],
        erroredPreview: [`${configEntry.name}: ${configEntry.errorDesc}`],
        sealedPreview: [],
        unwiredCount: 0,
        wiredCount: 0,
        erroredCount: 1,
        sealedCount: 0,
        unwiredNoun: "services",
        hasErrored: true,
        hasSealed: false,
        probeErrored: true,
        probeErrorDesc: errorDesc,
        configError: true,
      };
      return {
        key: "aimock_wiring:global",
        state: "red",
        signal,
        observedAt: ctx.now().toISOString(),
      };
    }

    const all = await input.listServices();
    // Dedupe by name. Check exclusion BEFORE adding to `seen` so excluded
    // services don't poison the seen-set for later non-excluded duplicates.
    const seen = new Set<string>();
    const services: string[] = [];
    for (const s of all) {
      if (isExcluded(s.name)) continue;
      if (seen.has(s.name)) continue;
      seen.add(s.name);
      services.push(s.name);
    }

    const unwired: string[] = [];
    const wired: string[] = [];
    const sealed: string[] = [];
    const errored: { name: string; errorDesc: string }[] = [];
    for (const name of services) {
      let env: Record<string, string | undefined>;
      try {
        env = await input.getServiceEnv(name);
      } catch (err) {
        const errorDesc = err instanceof Error ? err.message : String(err);
        errored.push({ name, errorDesc });
        continue;
      }
      const verdict = pointsAtAimock(env, input.aimockUrl);
      if (verdict === "match") {
        wired.push(name);
      } else if (verdict === "sealed") {
        // Sealed env → can't decide. Neither pass nor fail; templates can
        // surface this as an informational aside via `signal.sealed`.
        sealed.push(name);
      } else {
        unwired.push(name);
      }
    }
    unwired.sort();
    wired.sort();
    sealed.sort();
    errored.sort((a, b) => a.name.localeCompare(b.name));

    const previewBase = errored
      .slice(0, ERRORED_PREVIEW_MAX)
      .map((e) => `${e.name}: ${e.errorDesc}`);
    const remaining = errored.length - previewBase.length;
    const erroredPreview =
      remaining > 0 ? [...previewBase, `(+${remaining} more)`] : previewBase;

    const sealedPreviewBase = sealed.slice(0, ERRORED_PREVIEW_MAX);
    const sealedRemaining = sealed.length - sealedPreviewBase.length;
    const sealedPreview =
      sealedRemaining > 0
        ? [...sealedPreviewBase, `(+${sealedRemaining} more)`]
        : sealedPreviewBase;

    // Pluralization is keyed to `unwiredCount` — the only value templates
    // render alongside `unwiredNoun`. count=1 → "service", anything else →
    // "services" (count=0 is fine; templates guard on count>0 before
    // rendering the phrase).
    const signal: AimockWiringSignal = {
      unwired,
      wired,
      sealed,
      errored,
      erroredPreview,
      sealedPreview,
      unwiredCount: unwired.length,
      wiredCount: wired.length,
      erroredCount: errored.length,
      sealedCount: sealed.length,
      unwiredNoun: unwired.length === 1 ? "service" : "services",
      hasErrored: errored.length > 0,
      hasSealed: sealed.length > 0,
      // HF13-C1: always emit these on the happy path so templates and
      // downstream consumers can rely on the fields existing. Per-service
      // env-fetch failures live in `errored` (not `probeErrored`) — the
      // latter is reserved for probe-wide misconfiguration.
      probeErrored: false,
      probeErrorDesc: "",
      configError: false,
    };
    // Red state: any unwired or any errored. Sealed bucket does NOT trip red
    // — a correctly-configured service with a sealed env var must not be
    // flagged as drift just because Railway masks its value.
    return {
      key: "aimock_wiring:global",
      state: unwired.length === 0 && errored.length === 0 ? "green" : "red",
      signal,
      observedAt: ctx.now().toISOString(),
    };
  },
};
