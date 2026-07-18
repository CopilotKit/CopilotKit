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
 * Infra service names we do NOT check for aimock wiring. The aimock service
 * itself has no upstream to route through, and shell/pocketbase/harness/
 * harness-workers/dashboard/docs/dojo/webhooks are pure infra with no LLM
 * callers (so they have no `*_BASE_URL` overrides and could only ever be
 * counted as unwired).
 *
 * Most entries are stored in their `showcase-`-prefixed form. The exclusion
 * check (`isExcluded`) matches a bare deployed name (e.g. `harness`, `shell`,
 * `aimock`) by PREPENDING `showcase-` to it and testing that prefixed form
 * against the set — so the bare name resolves to the same canonical entry as
 * the prefixed form (`showcase-harness`, …). This is load-bearing: actual
 * deployed Railway service names in the production project are BARE — without
 * the prepend, every bare infra service would have been counted as unwired
 * and the probe would have stayed red forever. `harness-workers` has no
 * `showcase-` legacy form, so it is stored bare — `isExcluded` checks the
 * literal name first, so this matches correctly.
 *
 * Match is still effectively EXACT (not a prefix match): a hypothetical
 * `showcase-aimock-pinger-mock-for-test` is tested literally and, prepended,
 * as `showcase-showcase-aimock-pinger-mock-for-test` — neither is in the set,
 * so it would correctly surface as unwired. Keep this list in sync with the
 * Railway service roster whenever new infra services are added.
 *
 * NOTE: starters (`starter-*`) are NOT excluded — they route through aimock
 * exactly like the `showcase-*` backends and are checked as ordinary
 * LLM-calling services. See `isExcluded`.
 */
const EXCLUDE_SERVICES: ReadonlySet<string> = new Set([
  "showcase-aimock",
  "showcase-shell",
  "showcase-shell-dashboard",
  "showcase-dashboard",
  "showcase-shell-docs",
  "showcase-docs",
  "showcase-shell-dojo",
  "showcase-dojo",
  "showcase-pocketbase",
  "showcase-harness",
  "harness-workers",
  "showcase-webhooks",
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
  // Starters route through aimock identically to the showcase-* backends
  // (OPENAI_BASE_URL / ANTHROPIC_BASE_URL / GOOGLE_GEMINI_BASE_URL point at
  // aimock), so they are checked like any other LLM-calling service — NOT
  // excluded here. Only the pure-infra services in EXCLUDE_SERVICES are skipped.

  // Match either the literal name or its `showcase-`-prefixed form. Railway
  // service names in the production project are BARE (`harness`, `shell`,
  // `aimock`, `harness-workers`, …) while some EXCLUDE_SERVICES entries are
  // keyed by the `showcase-`-prefixed form for historical reasons (the legacy
  // local-dev project named services with that prefix). Comparing both forms
  // keeps the set robust to either naming convention without forcing operators
  // to maintain two parallel sets that can drift.
  if (EXCLUDE_SERVICES.has(name)) return true;
  return EXCLUDE_SERVICES.has(`showcase-${name}`);
}

/**
 * Default TCP port for a URL protocol, so an implicit URL (`http://h`) and its
 * explicit form (`http://h:80`) compare equal. Returns the empty string for
 * protocols we don't special-case; two such URLs still compare equal to each
 * other by their (also-empty) `URL.port`.
 */
function defaultPortForProtocol(protocol: string): string {
  switch (protocol) {
    case "https:":
      return "443";
    case "http:":
      return "80";
    default:
      return "";
  }
}

/**
 * Extract the lowercased hostname AND effective port from a URL string.
 * Returns null if the URL is unparseable. Used by `pointsAtAimock` for
 * host+port matching so path differences (`/v1` suffix on `OPENAI_BASE_URL`
 * vs bare origin on `AIMOCK_URL`), query strings, and fragments don't cause
 * false mismatches — but a wrong/missing port DOES (internal aimock serves
 * only on :4010, so a service on the right host but the wrong port is not
 * actually routed through aimock).
 *
 * The "effective port" collapses default ports: an empty `URL.port` (implicit
 * default) is replaced with the protocol's default (`:80` for http, `:443`
 * for https), so `http://h` ≡ `http://h:80` on both sides of the comparison.
 * The expected port is derived from the probe's configured `aimockUrl` — the
 * matcher hardcodes no port (the live cron passes
 * `http://showcase-aimock.railway.internal:4010`).
 */
function extractHostPort(
  raw: string | undefined,
): { host: string; port: string } | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const port = u.port !== "" ? u.port : defaultPortForProtocol(u.protocol);
    return { host: u.hostname.toLowerCase(), port };
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
 *   - `"mismatch"`: at least one candidate is a CONFIRMED non-aimock value
 *     (set, non-sentinel, non-empty, and does not match the aimock target),
 *     OR every candidate is missing/unset (missing == not wired).
 *   - `"sealed"`: the only signal is a sealed sentinel — no confirmed match
 *     and no confirmed mismatch, so we can't decide and route the service to
 *     the `sealed` bucket rather than flagging drift.
 *
 * Matching is **host+port based**: a candidate value matches aimock if its
 * parsed hostname AND effective port both equal the aimock URL's. Host compare
 * is case-insensitive. This tolerates the `/v1` path suffix that
 * `OPENAI_BASE_URL` carries by convention, plus query strings and fragments —
 * those are irrelevant to whether traffic routes through the aimock proxy. But
 * the port is NOT ignored: internal aimock serves only on :4010, so a service
 * on the right host but a wrong/missing port is genuine drift. Default ports
 * collapse (`http://h` ≡ `http://h:80`, `https://h` ≡ `https://h:443`); the
 * expected port is derived from the configured `aimockUrl` (no port hardcoded).
 *
 * Precedence: match > mismatch(confirmed) > sealed > mismatch(all-missing).
 *   1. A confirmed match on ANY candidate wins over everything — a service
 *      exposing `ANTHROPIC_BASE_URL=aimock` with a sealed `OPENAI_BASE_URL`
 *      is unambiguously wired.
 *   2. A CONFIRMED mismatch (a set, non-sentinel candidate pointing elsewhere)
 *      beats a sealed sibling: provable drift (e.g. a var on real
 *      api.openai.com) must NOT be masked as "can't decide". Bucketing that as
 *      sealed would hide a service escaping aimock.
 *   3. If the only signal is sealed (no confirmed match/mismatch) → sealed.
 *   4. All-missing/unset → mismatch (nothing wires the service to aimock).
 */
function pointsAtAimock(
  env: Record<string, string | undefined>,
  aimockUrl: string,
): "match" | "mismatch" | "sealed" {
  const target = extractHostPort(aimockUrl);
  // Defense-in-depth: the probe's `run` has already validated `aimockUrl`
  // with `new URL` and short-circuited on failure, so `target` should never
  // be null here. If it somehow is (e.g. a future caller invokes
  // `pointsAtAimock` directly), return "mismatch" rather than silently
  // matching — but this path is unreachable via the probe pipeline today.
  if (target === null) return "mismatch";
  let anySealed = false;
  let anyConfirmedMismatch = false;
  for (const varName of CANDIDATE_ENV_VARS) {
    const raw = env[varName];
    // Missing / empty contributes no signal — treated like the var being
    // absent (which, if nothing else fires, lands in mismatch(all-missing)).
    if (raw === undefined || raw === "") continue;
    if (raw === SEALED_SENTINEL) {
      anySealed = true;
      continue;
    }
    const cand = extractHostPort(raw);
    if (
      cand !== null &&
      cand.host === target.host &&
      cand.port === target.port
    ) {
      return "match"; // (1) confirmed match wins over everything
    }
    // Set, non-sentinel, non-empty, and does not match → confirmed drift.
    // (An unparseable value is also confirmed non-aimock.)
    anyConfirmedMismatch = true;
  }
  if (anyConfirmedMismatch) return "mismatch"; // (2) confirmed drift beats sealed
  if (anySealed) return "sealed"; // (3) only signal is opaque
  return "mismatch"; // (4) all-missing / unset
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
