import type { Probe, ProbeContext, ProbeResult } from "../types/index.js";

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
   * Template-friendly preview: up to `ERRORED_PREVIEW_MAX` failing services
   * rendered as "name: errorDesc" lines. Saves operators a log-dive for the
   * common case where one Railway API hiccup trips a single service.
   * Truncated with "(+N more)" when erroredCount exceeds the preview cap.
   */
  erroredPreview: string[];
  unwiredCount: number;
  wiredCount: number;
  erroredCount: number;
  unwiredNoun: string;
  /**
   * Truthy when `errored` is non-empty — derived flag for templates that
   * need to render a distinct "lookup failed" branch without counting.
   */
  hasErrored: boolean;
}

/** Maximum number of failing services rendered inline in alerts. */
const ERRORED_PREVIEW_MAX = 5;

function isExcluded(name: string): boolean {
  return EXCLUDE_SERVICES.has(name);
}

/**
 * Normalize a URL for equality compare: lowercase hostname, strip trailing
 * slash on the path, drop query string and fragment, normalize default ports
 * (:80 for http, :443 for https). Returns null if parsing fails — callers
 * should treat unparseable URLs as "not aimock".
 *
 * Query/fragment are dropped so `https://aimock/v1?env=prod` still compares
 * equal to `https://aimock/v1`. Ports collapse to the default when explicit
 * (`https://host:443/v1` == `https://host/v1`).
 *
 * NOTE: Pathname case is preserved (NOT lowercased). URL paths are
 * case-sensitive per RFC 3986 §6.2.2.1, so `/v1` and `/V1` are different
 * resources. If operators configure `OPENAI_BASE_URL=…/V1` but aimock runs
 * at `…/v1`, the probe will correctly flag the service as unwired.
 */
function normalizeUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    u.hostname = u.hostname.toLowerCase();
    // Drop query string and fragment — these never affect routing to the
    // aimock upstream and an accidental `?env=prod` must not surface as drift.
    u.search = "";
    u.hash = "";
    // Normalize default ports so `:80` / `:443` collapse to the implicit form.
    if (
      (u.protocol === "http:" && u.port === "80") ||
      (u.protocol === "https:" && u.port === "443")
    ) {
      u.port = "";
    }
    // Strip a single trailing slash on the pathname (but not the root '/' itself).
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.replace(/\/+$/, "");
    }
    // Drop any trailing slash on the stringified URL to normalize
    // `https://host/` vs `https://host`.
    let out = u.toString();
    if (out.endsWith("/") && u.pathname === "/") {
      out = out.slice(0, -1);
    }
    return out;
  } catch {
    return null;
  }
}

function pointsAtAimock(
  env: Record<string, string | undefined>,
  aimockUrl: string,
): boolean {
  const target = normalizeUrl(aimockUrl);
  if (target === null) return false;
  const openai = normalizeUrl(env.OPENAI_BASE_URL);
  const anthropic = normalizeUrl(env.ANTHROPIC_BASE_URL);
  return openai === target || anthropic === target;
}

/**
 * Spec §6.4: every LLM-calling showcase service MUST have its traffic
 * routed through showcase-aimock via OPENAI_BASE_URL (or
 * ANTHROPIC_BASE_URL for the claude-sdk pattern). Fires on drift.
 *
 * Signal contract (sorted output is part of the contract — templates rely
 * on stable ordering for diff comparisons):
 *   - `wired` / `unwired` / `errored`: lexically sorted by name.
 *   - A single service's env-fetch failure is isolated to the `errored`
 *     bucket and does NOT reject the whole probe. State is red if either
 *     `unwired` or `errored` is non-empty.
 *
 * TODO (cross-cluster — rule schema + deriveSignalFlags live in Cluster 1):
 * An errored-only result (unwired=[], errored=[...]) currently turns state
 * red but does NOT trip `set_drifted` in deriveSignalFlags (which only keys
 * off `signal.unwired`). Cluster 1 needs to:
 *   1. Add `set_errored` to StringTriggerEnum in src/rules/schema.ts, AND
 *   2. Derive it in deriveSignalFlags via `signal.errored?.length > 0`
 *      (using hasErrored on this signal), AND
 *   3. Update aimock-wiring-drift.yml to declare `set_errored` alongside
 *      `set_drifted` / `red_to_green` and render an errored branch using
 *      `signal.erroredPreview`.
 * Without that, `hasErrored` / `erroredPreview` are available to templates
 * but the rule itself won't fire on a pure-errored state.
 */
export const aimockWiringProbe: Probe<AimockWiringInput, AimockWiringSignal> = {
  dimension: "aimock_wiring",
  async run(
    input: AimockWiringInput,
    ctx: ProbeContext,
  ): Promise<ProbeResult<AimockWiringSignal>> {
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
      if (pointsAtAimock(env, input.aimockUrl)) {
        wired.push(name);
      } else {
        unwired.push(name);
      }
    }
    unwired.sort();
    wired.sort();
    errored.sort((a, b) => a.name.localeCompare(b.name));

    const previewBase = errored
      .slice(0, ERRORED_PREVIEW_MAX)
      .map((e) => `${e.name}: ${e.errorDesc}`);
    const remaining = errored.length - previewBase.length;
    const erroredPreview =
      remaining > 0 ? [...previewBase, `(+${remaining} more)`] : previewBase;

    const signal: AimockWiringSignal = {
      unwired,
      wired,
      errored,
      erroredPreview,
      unwiredCount: unwired.length,
      wiredCount: wired.length,
      erroredCount: errored.length,
      unwiredNoun: unwired.length === 1 ? "service" : "services",
      hasErrored: errored.length > 0,
    };
    return {
      key: "aimock_wiring:global",
      state: unwired.length === 0 && errored.length === 0 ? "green" : "red",
      signal,
      observedAt: ctx.now().toISOString(),
    };
  },
};
